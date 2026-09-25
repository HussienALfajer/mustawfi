import { ProblemError } from "@mustawfi/core-config/server";
import {
  currentTenant,
  knownDepartments,
  type TenantTransaction,
} from "@mustawfi/core-tenancy/server";
import { Decimal, Money, type IdGenerator } from "@mustawfi/kernel";
import { and, asc, eq, inArray } from "drizzle-orm";
import { calendarDateSchema, ledgerProblemCodes, type JournalSide } from "../shared/index.ts";
import { accounts, journalEntries, journalLines } from "./schema.ts";

export interface JournalLineInput {
  readonly accountId: string;
  readonly side: JournalSide;
  /** Greater than zero, at its currency's minor unit, in the tenant's base currency. */
  readonly amount: Money;
  /** The profit center the line belongs to (ADR-0006). */
  readonly departmentId: string;
}

export interface JournalEntryInput {
  readonly id: string;
  /** Must be the tenant of the `withTenant` context the entry is posted in. */
  readonly tenantId: string;
  readonly branchId: string;
  /** `YYYY-MM-DD`: the day the entry counts in (ADR-0020). */
  readonly accountingDate: string;
  readonly postedAt: Date;
  /** The user behind the document. */
  readonly postedBy: string;
  /** The document the entry records: `sales.invoice` and its id. */
  readonly source: { readonly type: string; readonly id: string };
  readonly memo?: string;
  readonly lines: readonly JournalLineInput[];
}

export interface PostedJournalEntry {
  readonly id: string;
  readonly accountingDate: string;
  /** The sum of the debits, equal to the sum of the credits. */
  readonly total: Money;
  readonly lineIds: readonly string[];
}

const SOURCE_TYPE = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function invalid(detail: string): ProblemError {
  return new ProblemError(ledgerProblemCodes.entryInvalid, 422, {
    title: "The journal entry is not valid",
    detail,
  });
}

/**
 * Checks that `lines` form a balanced entry in `baseCurrency` (ADR-0006, ADR-0018): at least two
 * lines, every amount greater than zero, at the currency's minor unit, and in the base currency,
 * and the debits equal to the credits exactly. Returns that total. Nothing is rounded or
 * "fixed": a line that breaks a rule refuses the whole entry.
 */
export function balancedTotal(lines: readonly JournalLineInput[], baseCurrency: string): Money {
  const [first] = lines;
  if (first === undefined || lines.length < 2) throw invalid("an entry has at least two lines");
  const currency = first.amount.currency;
  lines.forEach((line, index) => {
    const at = `line ${String(index + 1)}`;
    if (line.amount.currency.code !== baseCurrency || !line.amount.currency.equals(currency)) {
      throw invalid(`${at} is in ${line.amount.currency.code}, not the base currency`);
    }
    if (!line.amount.isPositive()) throw invalid(`${at} is not greater than zero`);
    if (!line.amount.isAtMinorUnit()) {
      throw invalid(`${at} is finer than ${currency.code}'s minor unit`);
    }
  });
  const side = (s: JournalSide) =>
    Money.sum(
      lines.filter((line) => line.side === s).map((line) => line.amount),
      currency,
    );
  const debits = side("debit");
  const credits = side("credit");
  if (!debits.equals(credits)) {
    throw new ProblemError(ledgerProblemCodes.entryUnbalanced, 422, {
      title: "The journal entry does not balance",
      detail: `debits ${debits.toString()}, credits ${credits.toString()}`,
    });
  }
  return debits;
}

/**
 * Posts a balanced journal entry in `tx` — the one way any module writes to the ledger
 * (ADR-0006). Call it in the same transaction as the document it records, so both commit or
 * neither does. The entry is final once written: corrections are reversing entries.
 */
export async function postJournalEntry(
  tx: TenantTransaction,
  entry: JournalEntryInput,
  dependencies: { readonly newId: IdGenerator },
): Promise<PostedJournalEntry> {
  if (!calendarDateSchema.safeParse(entry.accountingDate).success) {
    throw invalid(`"${entry.accountingDate}" is not a calendar date`);
  }
  if (!SOURCE_TYPE.test(entry.source.type)) {
    throw invalid(`"${entry.source.type}" is not a document type`);
  }
  const ids = [
    entry.id,
    entry.source.id,
    ...entry.lines.flatMap((l) => [l.accountId, l.departmentId]),
  ];
  if (!ids.every((id) => UUID.test(id))) throw invalid("an id is not a lowercase UUID");
  const tenant = await currentTenant(tx);
  if (tenant === undefined) throw new Error("posting outside a tenant");
  const total = balancedTotal(entry.lines, tenant.baseCurrency);

  const accountIds = [...new Set(entry.lines.map((line) => line.accountId))];
  const known = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(inArray(accounts.id, accountIds));
  if (known.length !== accountIds.length) throw invalid("a line names an unknown account");
  const departmentIds = entry.lines.map((line) => line.departmentId);
  const departments = await knownDepartments(tx, departmentIds);
  if (!departmentIds.every((id) => departments.has(id))) {
    throw invalid("a line names an unknown department");
  }

  const audit = {
    tenantId: entry.tenantId,
    branchId: entry.branchId,
    createdAt: entry.postedAt,
    createdBy: entry.postedBy,
  };
  await tx.insert(journalEntries).values({
    ...audit,
    id: entry.id,
    accountingDate: entry.accountingDate,
    currency: total.currency.code,
    sourceType: entry.source.type,
    sourceId: entry.source.id,
    memo: entry.memo ?? null,
  });
  const lines = entry.lines.map((line, index) => ({
    ...audit,
    id: dependencies.newId(),
    journalEntryId: entry.id,
    lineNo: index + 1,
    accountId: line.accountId,
    departmentId: line.departmentId,
    currency: line.amount.currency.code,
    debit: line.side === "debit" ? line.amount.amount.toString() : "0",
    credit: line.side === "credit" ? line.amount.amount.toString() : "0",
  }));
  await tx.insert(journalLines).values(lines);
  return {
    id: entry.id,
    accountingDate: entry.accountingDate,
    total,
    lineIds: lines.map((line) => line.id),
  };
}

/** A posted entry as read back, with its lines' accounts. Amounts are canonical decimals. */
export interface RecordedJournalEntry {
  readonly id: string;
  readonly accountingDate: string;
  readonly currency: string;
  readonly source: { readonly type: string; readonly id: string };
  readonly lines: readonly {
    readonly lineNo: number;
    readonly accountCode: string;
    readonly accountName: string;
    readonly departmentId: string;
    readonly debit: string;
    readonly credit: string;
  }[];
}

/**
 * The entries that record the documents `sourceIds` of `sourceType`, in `tx` (under RLS), for
 * the module that owns those documents to show them (flow 7 of the walking skeleton).
 */
export async function journalEntriesForSources(
  tx: TenantTransaction,
  sourceType: string,
  sourceIds: readonly string[],
): Promise<RecordedJournalEntry[]> {
  if (sourceIds.length === 0) return [];
  const rows = await tx
    .select({
      id: journalEntries.id,
      accountingDate: journalEntries.accountingDate,
      currency: journalEntries.currency,
      sourceId: journalEntries.sourceId,
      lineNo: journalLines.lineNo,
      accountCode: accounts.code,
      accountName: accounts.name,
      departmentId: journalLines.departmentId,
      debit: journalLines.debit,
      credit: journalLines.credit,
    })
    .from(journalEntries)
    .innerJoin(journalLines, eq(journalLines.journalEntryId, journalEntries.id))
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(
      and(
        eq(journalEntries.sourceType, sourceType),
        inArray(journalEntries.sourceId, [...sourceIds]),
      ),
    )
    .orderBy(asc(journalEntries.createdAt), asc(journalEntries.id), asc(journalLines.lineNo));
  const entries = new Map<
    string,
    RecordedJournalEntry & { lines: RecordedJournalEntry["lines"][number][] }
  >();
  for (const row of rows) {
    let entry = entries.get(row.id);
    if (entry === undefined) {
      entry = {
        id: row.id,
        accountingDate: row.accountingDate,
        currency: row.currency,
        source: { type: sourceType, id: row.sourceId },
        lines: [],
      };
      entries.set(row.id, entry);
    }
    entry.lines.push({
      lineNo: row.lineNo,
      accountCode: row.accountCode,
      accountName: row.accountName,
      departmentId: row.departmentId,
      debit: Decimal.of(row.debit).toString(),
      credit: Decimal.of(row.credit).toString(),
    });
  }
  return [...entries.values()];
}
