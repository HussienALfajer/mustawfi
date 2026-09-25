import { fc } from "@fast-check/vitest";
import { ProblemError } from "@mustawfi/core-config/server";
import {
  type Account,
  type JournalLineInput,
  postJournalEntry,
  systemAccounts,
} from "@mustawfi/core-ledger/server";
import { ledgerProblemCodes } from "@mustawfi/core-ledger/shared";
import {
  openTenantDatabase,
  type TenantDatabase,
  type TenantTransaction,
} from "@mustawfi/core-tenancy/server";
import {
  cryptoRandom,
  Currency,
  Decimal,
  manualClock,
  Money,
  uuidV7Generator,
} from "@mustawfi/kernel";
import { createTestDatabase, sqlState, type TestDatabase } from "@mustawfi/testing";
import { sql } from "drizzle-orm";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./db/migrate.ts";
import { migrationSets } from "./db/migration-sets.ts";
import { createTenantWithOwner, type CreatedTenant } from "./tenants/create-tenant.ts";

const SYP = Currency.of("SYP", 2);
const clock = manualClock(new Date("2026-09-25T08:00:00.000Z"));
const newId = uuidV7Generator({ clock, random: cryptoRandom });
const dependencies = { clock, newId, random: cryptoRandom };
const departmentId = newId();

let database: TestDatabase;
let tenants: TenantDatabase;
let superuser: pg.Client;
let store: CreatedTenant;
let other: CreatedTenant;
type AccountKey = "cash" | "salesRevenue" | "roundingDifferences";
let accounts: Record<AccountKey, Account>;

function newTenant(name: string): Promise<CreatedTenant> {
  return createTenantWithOwner(
    tenants,
    {
      name,
      baseCurrency: "SYP",
      ownerName: "أحمد",
      ownerLogin: "ahmad",
      ownerPassword: "correct horse battery staple",
    },
    dependencies,
  );
}

const inStore = <T>(fn: (tx: TenantTransaction) => Promise<T>) =>
  tenants.withTenant({ tenantId: store.tenantId, userId: store.ownerId }, fn);

/** Inserts written straight to the ledger tables, past `postJournalEntry`. */
const entryValues = (entryId: string) => sql`
  insert into core_ledger.journal_entries
    (id, tenant_id, branch_id, created_at, created_by, accounting_date, currency, source_type, source_id)
  values (${entryId}, ${store.tenantId}, ${store.branchId}, now(), ${store.ownerId}, '2026-09-25', 'SYP', 'sales.invoice', ${newId()})`;
const lineValues = (
  entryId: string,
  lineNo: number,
  accountId: string,
  dr: string,
  cr: string,
) => sql`
  insert into core_ledger.journal_lines
    (id, tenant_id, branch_id, created_at, created_by, journal_entry_id, line_no, account_id, department_id, currency, debit, credit)
  values (${newId()}, ${store.tenantId}, ${store.branchId}, now(), ${store.ownerId}, ${entryId}, ${lineNo}, ${accountId}, ${departmentId}, 'SYP', ${dr}, ${cr})`;

function post(lines: readonly JournalLineInput[], tenant: CreatedTenant = store) {
  return tenants.withTenant({ tenantId: tenant.tenantId, userId: tenant.ownerId }, (tx) =>
    postJournalEntry(
      tx,
      {
        id: newId(),
        tenantId: tenant.tenantId,
        branchId: tenant.branchId,
        accountingDate: "2026-09-25",
        postedAt: clock.now(),
        postedBy: tenant.ownerId,
        source: { type: "sales.invoice", id: newId() },
        lines,
      },
      dependencies,
    ),
  );
}

const syp = (text: string) => Money.of(text, SYP);
const debit = (account: Account, amount: Money): JournalLineInput => ({
  accountId: account.id,
  side: "debit",
  amount,
  departmentId,
});
const credit = (account: Account, amount: Money): JournalLineInput => ({
  ...debit(account, amount),
  side: "credit",
});

async function refusal(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ProblemError) return error.code;
    return sqlState(error) ?? String(error);
  }
  return undefined;
}

async function ledgerCounts(tenantId: string) {
  const { rows } = await superuser.query<{ entries: number; lines: number }>(
    `select (select count(*)::int from core_ledger.journal_entries where tenant_id = $1) as entries,
            (select count(*)::int from core_ledger.journal_lines where tenant_id = $1) as lines`,
    [tenantId],
  );
  return rows[0];
}

/** Every entry of the tenant balances, has two lines or more, and the trial balance is zero. */
async function expectLedgerBalanced(tenantId: string) {
  const unbalanced = await superuser.query(
    `select e.id from core_ledger.journal_entries e
       left join core_ledger.journal_lines l on l.journal_entry_id = e.id
     where e.tenant_id = $1
     group by e.id
     having count(l.id) < 2 or coalesce(sum(l.debit), 0) <> coalesce(sum(l.credit), 0)`,
    [tenantId],
  );
  expect(unbalanced.rows).toEqual([]);
  const trial = await superuser.query<{ difference: string }>(
    `select coalesce(sum(debit), 0) - coalesce(sum(credit), 0) as difference
       from core_ledger.journal_lines where tenant_id = $1`,
    [tenantId],
  );
  expect(Decimal.of(trial.rows[0]?.difference ?? "x").isZero()).toBe(true);
}

beforeAll(async () => {
  database = await createTestDatabase("ledger");
  await applyMigrations(database.url("owner"), migrationSets);
  tenants = await openTenantDatabase({ connectionString: database.url("app") });
  superuser = await database.connect("superuser");
  store = await newTenant("متجر النور");
  other = await newTenant("متجر آخر");
  accounts = await inStore(systemAccounts);
});

afterAll(async () => {
  await superuser.end();
  await tenants.close();
});

describe("seeded accounts", () => {
  it("give each tenant its own cash, sales revenue, and rounding differences", async () => {
    const theirs = await tenants.withTenant({ tenantId: other.tenantId }, systemAccounts);
    expect(Object.keys(accounts).sort()).toEqual(["cash", "roundingDifferences", "salesRevenue"]);
    expect(accounts.cash).toMatchObject({ code: "1100", kind: "asset", systemKey: "cash" });
    expect(accounts.salesRevenue).toMatchObject({ code: "4100", kind: "revenue" });
    expect(accounts.roundingDifferences).toMatchObject({ code: "5900", kind: "expense" });
    for (const key of ["cash", "salesRevenue", "roundingDifferences"] as const) {
      expect(theirs[key].id).not.toBe(accounts[key].id);
      expect(theirs[key].code).toBe(accounts[key].code);
    }
  });
});

describe("postJournalEntry", () => {
  it("posts a cash sale with department and currency on each line", async () => {
    const posted = await post([
      debit(accounts.cash, syp("1250.50")),
      credit(accounts.salesRevenue, syp("1250.00")),
      credit(accounts.roundingDifferences, syp("0.50")),
    ]);
    expect(posted.total.equals(syp("1250.50"))).toBe(true);

    const entry = await superuser.query(
      `select tenant_id, branch_id, created_by, accounting_date::text, currency, source_type
         from core_ledger.journal_entries where id = $1`,
      [posted.id],
    );
    expect(entry.rows).toEqual([
      {
        tenant_id: store.tenantId,
        branch_id: store.branchId,
        created_by: store.ownerId,
        accounting_date: "2026-09-25",
        currency: "SYP",
        source_type: "sales.invoice",
      },
    ]);
    const lines = await superuser.query(
      `select line_no, account_id, department_id, currency, debit, credit
         from core_ledger.journal_lines where journal_entry_id = $1 order by line_no`,
      [posted.id],
    );
    expect(lines.rows).toEqual([
      {
        line_no: 1,
        account_id: accounts.cash.id,
        department_id: departmentId,
        currency: "SYP",
        debit: "1250.5000",
        credit: "0.0000",
      },
      {
        line_no: 2,
        account_id: accounts.salesRevenue.id,
        department_id: departmentId,
        currency: "SYP",
        debit: "0.0000",
        credit: "1250.0000",
      },
      {
        line_no: 3,
        account_id: accounts.roundingDifferences.id,
        department_id: departmentId,
        currency: "SYP",
        debit: "0.0000",
        credit: "0.5000",
      },
    ]);
  });

  it("refuses an unbalanced entry and writes nothing", async () => {
    const before = await ledgerCounts(store.tenantId);
    const code = await refusal(
      post([debit(accounts.cash, syp("100")), credit(accounts.salesRevenue, syp("99.99"))]),
    );
    expect(code).toBe(ledgerProblemCodes.entryUnbalanced);
    expect(await ledgerCounts(store.tenantId)).toEqual(before);
  });

  it("refuses a malformed department id as invalid, not as a database error", async () => {
    const lines = [debit(accounts.cash, syp("1")), credit(accounts.salesRevenue, syp("1"))];
    const code = await refusal(post(lines.map((l) => ({ ...l, departmentId: "not-a-uuid" }))));
    expect(code).toBe(ledgerProblemCodes.entryInvalid);
  });

  it("refuses a line in a currency other than the base currency", async () => {
    const usd = Money.of("10", Currency.of("USD", 2));
    const code = await refusal(
      post([debit(accounts.cash, usd), credit(accounts.salesRevenue, usd)]),
    );
    expect(code).toBe(ledgerProblemCodes.entryInvalid);
  });

  it("refuses a line naming another tenant's account, which the database refuses too", async () => {
    const theirs = await tenants.withTenant({ tenantId: other.tenantId }, systemAccounts);
    const lines = [debit(theirs.cash, syp("10")), credit(accounts.salesRevenue, syp("10"))];
    expect(await refusal(post(lines))).toBe(ledgerProblemCodes.entryInvalid);

    // Written straight to the tables, the tenant-scoped foreign key refuses it.
    const entryId = newId();
    const code = await refusal(
      inStore(async (tx) => {
        await tx.execute(entryValues(entryId));
        await tx.execute(lineValues(entryId, 1, theirs.cash.id, "10", "0"));
        await tx.execute(lineValues(entryId, 2, accounts.salesRevenue.id, "0", "10"));
      }),
    );
    expect(code).toBe("23503");
  });

  it("keeps debits equal to credits over random posting sequences", async () => {
    const account = fc.constantFrom<AccountKey>("cash", "salesRevenue", "roundingDifferences");
    const amount = fc
      .bigInt({ min: 1n, max: 10n ** 12n })
      .map((units) => Money.of(Decimal.fromScaledInteger(units, 2), SYP));
    /** A balanced entry, or — when `skew` is not zero — one that misses by `skew` cents. */
    const attempt = fc.record({
      debits: fc.array(fc.tuple(account, amount), { minLength: 1, maxLength: 4 }),
      creditTo: fc.array(fc.tuple(account, fc.bigInt({ min: 1n, max: 100n })), {
        minLength: 1,
        maxLength: 4,
      }),
      skew: fc.oneof({ weight: 3, arbitrary: fc.constant(0n) }, fc.bigInt({ min: -3n, max: 3n })),
    });

    await fc.assert(
      fc.asyncProperty(fc.array(attempt, { minLength: 1, maxLength: 6 }), async (attempts) => {
        const before = await ledgerCounts(store.tenantId);
        let accepted = 0;
        for (const { debits, creditTo, skew } of attempts) {
          const total = Money.sum(
            debits.map(([, a]) => a),
            SYP,
          );
          const shares = total.allocate(creditTo.map(([, w]) => Decimal.of(w)));
          const credits = shares.map((share, i) =>
            i === 0 ? share.plus(Money.of(Decimal.fromScaledInteger(skew, 2), SYP)) : share,
          );
          const lines = [
            ...debits.map(([key, a]) => debit(accounts[key], a)),
            ...credits
              .map((c, i) => credit(accounts[creditTo[i]?.[0] ?? "cash"], c))
              .filter((l) => !l.amount.isZero()),
          ];
          const code = await refusal(post(lines));
          // A balanced attempt is posted; a skewed one is refused before anything is written.
          if (skew === 0n) {
            expect(code).toBeUndefined();
            accepted += 1;
          } else {
            expect([ledgerProblemCodes.entryUnbalanced, ledgerProblemCodes.entryInvalid]).toContain(
              code,
            );
          }
        }
        expect((await ledgerCounts(store.tenantId))?.entries).toBe(
          (before?.entries ?? 0) + accepted,
        );
        await expectLedgerBalanced(store.tenantId);
      }),
      { numRuns: 20 },
    );
  });
});

describe("the database", () => {
  it.each([
    [
      "debits and credits that differ",
      [
        ["10", "0"],
        ["0", "9.99"],
      ],
    ],
    ["a single line", [["10", "0"]]],
    ["no lines", []],
  ] as const)("refuses at commit an entry written directly with %s", async (_, lines) => {
    const before = await ledgerCounts(store.tenantId);
    const code = await refusal(
      inStore(async (tx) => {
        const entryId = newId();
        await tx.execute(entryValues(entryId));
        for (const [i, [dr, cr]] of lines.entries()) {
          await tx.execute(lineValues(entryId, i + 1, accounts.cash.id, dr, cr));
        }
      }),
    );
    expect(code).toBe("23514");
    expect(await ledgerCounts(store.tenantId)).toEqual(before);
  });

  it("accepts a balanced entry written directly, so the check is not a blanket refusal", async () => {
    const entryId = newId();
    await inStore(async (tx) => {
      await tx.execute(entryValues(entryId));
      await tx.execute(lineValues(entryId, 1, accounts.cash.id, "10", "0"));
      await tx.execute(lineValues(entryId, 2, accounts.salesRevenue.id, "0", "10"));
    });
    await expectLedgerBalanced(store.tenantId);
  });

  describe("keeps posted entries immutable", () => {
    let entryId: string;
    beforeAll(async () => {
      entryId = (
        await post([debit(accounts.cash, syp("5")), credit(accounts.salesRevenue, syp("5"))])
      ).id;
    });

    // Built when the test runs: the entry and the accounts exist only after `beforeAll`.
    const statements = {
      "update an entry": () =>
        sql`update core_ledger.journal_entries set memo = 'changed' where id = ${entryId}`,
      "delete an entry": () => sql`delete from core_ledger.journal_entries where id = ${entryId}`,
      "update a line": () =>
        sql`update core_ledger.journal_lines set debit = debit * 2, credit = credit * 2 where journal_entry_id = ${entryId}`,
      "delete a line": () =>
        sql`delete from core_ledger.journal_lines where journal_entry_id = ${entryId}`,
      "update an account": () =>
        sql`update core_ledger.accounts set name = 'x' where id = ${accounts.cash.id}`,
      "delete an account": () =>
        sql`delete from core_ledger.accounts where id = ${accounts.cash.id}`,
    };

    it("refuses lines appended to it later, even a balanced pair", async () => {
      const code = await refusal(
        inStore(async (tx) => {
          await tx.execute(lineValues(entryId, 3, accounts.cash.id, "1000", "0"));
          await tx.execute(lineValues(entryId, 4, accounts.salesRevenue.id, "0", "1000"));
        }),
      );
      expect(code).toBe("42501");
    });

    it.each(Object.entries(statements))("refuses the app role: %s", async (_, statement) => {
      expect(await refusal(inStore((tx) => tx.execute(statement())))).toBe("42501");
    });

    it.each([
      ["update", "update core_ledger.journal_entries set memo = 'changed' where id = $1"],
      ["delete", "delete from core_ledger.journal_entries where id = $1"],
      ["update", "update core_ledger.journal_lines set debit = debit where journal_entry_id = $1"],
      ["delete", "delete from core_ledger.journal_lines where journal_entry_id = $1"],
    ])("refuses even a superuser: %s", async (_, statement) => {
      expect(await refusal(superuser.query(statement, [entryId]))).toBe("42501");
    });

    it.each(["journal_entries", "journal_lines"])("refuses to truncate %s", async (table) => {
      const owner = await database.connect("owner");
      try {
        expect(await refusal(owner.query(`truncate core_ledger.${table} cascade`))).toBe("42501");
      } finally {
        await owner.end();
      }
    });

    it("leaves the entry as it was posted", async () => {
      const { rows } = await superuser.query(
        "select memo, (select sum(debit) from core_ledger.journal_lines where journal_entry_id = $1) as debits from core_ledger.journal_entries where id = $1",
        [entryId],
      );
      expect(rows).toEqual([{ memo: null, debits: "5.0000" }]);
    });
  });
});
