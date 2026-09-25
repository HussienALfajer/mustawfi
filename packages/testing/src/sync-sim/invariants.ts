import { Decimal } from "@mustawfi/kernel";

/** Where a device's outbox entry for a document stands (`core.sync`'s outbox states). */
export type SimOutboxState = "pending" | "accepted" | "duplicate" | "rejected";

export interface DeviceInvoice {
  readonly id: string;
  readonly number: string;
  /** Canonical decimal text. */
  readonly total: string;
  readonly syncState: SimOutboxState | undefined;
  readonly rejectionCode: string | null;
}

/** What one device holds once the run has converged. */
export interface DeviceSnapshot {
  readonly name: string;
  readonly deviceId: string;
  readonly prefix: string;
  readonly invoices: readonly DeviceInvoice[];
  readonly productIds: readonly string[];
}

export interface ServerInvoice {
  readonly id: string;
  readonly number: string;
  readonly deviceId: string;
  readonly total: string;
  readonly lines: readonly { readonly productId: string; readonly quantity: string }[];
}

/** A journal entry with the sums of its lines. */
export interface ServerEntry {
  readonly id: string;
  /** The document it posts. */
  readonly sourceId: string;
  readonly debit: string;
  readonly credit: string;
}

/** What the server holds for the simulated store. */
export interface ServerSnapshot {
  readonly invoices: readonly ServerInvoice[];
  /** Every journal entry of the store. */
  readonly entries: readonly ServerEntry[];
  readonly productIds: readonly string[];
  readonly stock: readonly { readonly productId: string; readonly onHand: string }[];
  /** The server's view of each device's numbering: the last sequence per document code. */
  readonly sequences: readonly {
    readonly deviceId: string;
    readonly docCode: string;
    readonly lastSeq: number;
  }[];
  /** The operation flags the server wrote. */
  readonly operationFlags: readonly { readonly opId: string; readonly code: string }[];
}

export interface ConvergenceInput {
  readonly devices: readonly DeviceSnapshot[];
  readonly server: ServerSnapshot;
  /** Stock the run put on hand per product, outside sales. */
  readonly received: ReadonlyMap<string, Decimal>;
}

const NUMBER = /^(.+)-[A-Z]+-(\d{6})$/;

function duplicatesOf(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) (seen.has(value) ? repeated : seen).add(value);
  return [...repeated];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a);
  return left.size === new Set(b).size && b.every((value) => left.has(value));
}

/**
 * What a converged run must show (ADR-0026, ADR-0020): every sale a device made is on the
 * server exactly once, with its number and total; no invoice appears that no device made;
 * each device's numbers run from 1 without gaps, the server tracked each device's last invoice
 * number, and no operation was flagged; every invoice with a total posts one balanced
 * entry for that total and the ledger balances; stock on hand is what was received minus what
 * was sold; and every device holds every product. Returns the problems found, empty when the
 * run converged.
 */
export function convergenceProblems(input: ConvergenceInput): string[] {
  const problems: string[] = [];
  const { server } = input;
  const serverInvoices = new Map(server.invoices.map((invoice) => [invoice.id, invoice]));

  for (const id of duplicatesOf(server.invoices.map((invoice) => invoice.id))) {
    problems.push(`invoice ${id} is on the server more than once`);
  }
  for (const number of duplicatesOf(server.invoices.map((invoice) => invoice.number))) {
    problems.push(`invoice number ${number} is on the server more than once`);
  }

  const made = new Set<string>();
  for (const device of input.devices) {
    const seqs: number[] = [];
    for (const invoice of device.invoices) {
      made.add(invoice.id);
      const where = `${device.name} ${invoice.number}`;
      if (invoice.syncState === "rejected") {
        problems.push(`${where} was rejected: ${invoice.rejectionCode ?? "no code"}`);
      } else if (invoice.syncState !== "accepted" && invoice.syncState !== "duplicate") {
        problems.push(`${where} is ${invoice.syncState ?? "missing from the outbox"}`);
      }
      const onServer = serverInvoices.get(invoice.id);
      if (onServer === undefined) {
        problems.push(`${where} is lost: not on the server`);
      } else {
        if (onServer.number !== invoice.number) {
          problems.push(`${where} is numbered ${onServer.number} on the server`);
        }
        if (onServer.deviceId !== device.deviceId) {
          problems.push(`${where} belongs to device ${onServer.deviceId} on the server`);
        }
        if (!Decimal.of(onServer.total).equals(Decimal.of(invoice.total))) {
          problems.push(`${where} totals ${onServer.total} on the server, ${invoice.total} here`);
        }
      }
      const match = NUMBER.exec(invoice.number);
      if (match?.[1] !== device.prefix) {
        problems.push(`${where} does not carry the prefix ${device.prefix}`);
      } else {
        seqs.push(Number.parseInt(match[2] ?? "", 10));
      }
    }
    seqs.sort((a, b) => a - b);
    const gapless = seqs.every((seq, index) => seq === index + 1);
    if (!gapless) {
      problems.push(`${device.name} numbers are not 1..${String(seqs.length)} without gaps`);
    }
    const tracked = server.sequences.find(
      (sequence) => sequence.deviceId === device.deviceId && sequence.docCode === "INV",
    );
    if ((tracked?.lastSeq ?? 0) !== seqs.length) {
      problems.push(
        `${device.name} made ${String(seqs.length)} invoices; the server's last number is ${String(tracked?.lastSeq ?? 0)}`,
      );
    }
    if (!sameSet(device.productIds, server.productIds)) {
      problems.push(
        `${device.name} holds ${String(device.productIds.length)} products, the server ${String(server.productIds.length)}`,
      );
    }
  }
  for (const flag of server.operationFlags) {
    problems.push(`operation ${flag.opId} was flagged ${flag.code}`);
  }
  for (const invoice of server.invoices) {
    if (!made.has(invoice.id))
      problems.push(`invoice ${invoice.number} on the server was never made`);
  }

  // The ledger: one balanced entry per invoice with a total, for that total.
  let debits = Decimal.ZERO;
  let credits = Decimal.ZERO;
  const entriesBySource = new Map<string, ServerEntry[]>();
  for (const entry of server.entries) {
    const debit = Decimal.of(entry.debit);
    const credit = Decimal.of(entry.credit);
    debits = debits.plus(debit);
    credits = credits.plus(credit);
    if (!debit.equals(credit)) {
      problems.push(`entry ${entry.id} is unbalanced: ${entry.debit} ≠ ${entry.credit}`);
    }
    entriesBySource.set(entry.sourceId, [...(entriesBySource.get(entry.sourceId) ?? []), entry]);
  }
  if (!debits.equals(credits)) {
    problems.push(
      `the ledger is unbalanced: debits ${debits.toString()}, credits ${credits.toString()}`,
    );
  }
  for (const invoice of server.invoices) {
    const entries = entriesBySource.get(invoice.id) ?? [];
    entriesBySource.delete(invoice.id);
    const total = Decimal.of(invoice.total);
    const expected = total.isZero() ? 0 : 1;
    if (entries.length !== expected) {
      problems.push(
        `invoice ${invoice.number} has ${String(entries.length)} entries, not ${String(expected)}`,
      );
    } else if (entries[0] !== undefined && !Decimal.of(entries[0].debit).equals(total)) {
      problems.push(`invoice ${invoice.number} posts ${entries[0].debit}, not ${invoice.total}`);
    }
  }
  for (const [sourceId, entries] of entriesBySource) {
    problems.push(`${String(entries.length)} entries post ${sourceId}, which is no invoice`);
  }

  // Stock: received minus sold, for every product anything happened to.
  const expected = new Map(input.received);
  for (const invoice of server.invoices) {
    for (const line of invoice.lines) {
      expected.set(
        line.productId,
        (expected.get(line.productId) ?? Decimal.ZERO).minus(Decimal.of(line.quantity)),
      );
    }
  }
  const onHand = new Map(server.stock.map((level) => [level.productId, Decimal.of(level.onHand)]));
  for (const productId of new Set([...expected.keys(), ...onHand.keys()])) {
    const want = expected.get(productId) ?? Decimal.ZERO;
    const have = onHand.get(productId) ?? Decimal.ZERO;
    if (!want.equals(have)) {
      problems.push(`product ${productId} has ${have.toString()} on hand, not ${want.toString()}`);
    }
  }
  return problems;
}
