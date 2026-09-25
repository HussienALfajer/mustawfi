import { recordAudit } from "@mustawfi/core-audit/server";
import { flagOperation, type ReceivedOperation } from "@mustawfi/core-sync/server";
import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import type { IdGenerator } from "@mustawfi/kernel";
import { and, eq } from "drizzle-orm";
import { type DocumentNumber, formatDocumentNumber } from "../shared/index.ts";
import { documentSequences } from "./schema.ts";

/** The numbers a document skipped: from `first` to `last`, `count` of them. */
export interface NumberGap {
  readonly docCode: string;
  readonly first: string;
  readonly last: string;
  readonly count: number;
  /** The number that revealed the gap. */
  readonly number: string;
}

export interface TrackedDocument {
  /** The document's number, read with `parseDocumentNumber`; its prefix is the device's. */
  readonly number: DocumentNumber;
  /** The document, named in the gap's audit entry: `sales.invoice` and its id. */
  readonly entity: { readonly type: string; readonly id: string };
}

/**
 * Records a received document's number in the server's view of its device's numbering
 * (`core-foundation` rule 31), in `tx`, the sync operation's transaction. The document is
 * accepted whatever its sequence: a jump past the device's last one for that code plus one
 * flags the operation `numberGap` and audits `organization.numbering.gap` with the missing
 * range. A sequence at or below the last one (filling an earlier gap) leaves the view as it
 * is; a repeat never gets here, as its module refuses it as a duplicate first (ADR-0020).
 */
export async function trackDocumentNumber(
  tx: TenantTransaction,
  operation: ReceivedOperation,
  document: TrackedDocument,
  dependencies: { readonly newId: IdGenerator },
): Promise<NumberGap | null> {
  const { prefix, docCode, seq } = document.number;
  if (prefix !== operation.device.prefix) {
    throw new TypeError(`${prefix} is not the prefix of device ${operation.device.id}`);
  }
  const where = and(
    eq(documentSequences.deviceId, operation.device.id),
    eq(documentSequences.docCode, docCode),
  );
  const [row] = await tx
    .select({ lastSeq: documentSequences.lastSeq })
    .from(documentSequences)
    .where(where)
    .for("update");
  const previous = row?.lastSeq ?? 0;
  if (row === undefined) {
    await tx.insert(documentSequences).values({
      id: dependencies.newId(),
      tenantId: operation.tenantId,
      branchId: operation.branchId,
      createdAt: operation.receivedAt,
      createdBy: operation.userId,
      deviceId: operation.device.id,
      docCode,
      lastSeq: seq,
      updatedAt: operation.receivedAt,
    });
  } else if (seq > previous) {
    await tx
      .update(documentSequences)
      .set({ lastSeq: seq, updatedAt: operation.receivedAt })
      .where(where);
  }
  if (seq <= previous + 1) return null;

  const gap: NumberGap = {
    docCode,
    first: formatDocumentNumber(prefix, docCode, previous + 1),
    last: formatDocumentNumber(prefix, docCode, seq - 1),
    count: seq - previous - 1,
    number: formatDocumentNumber(prefix, docCode, seq),
  };
  await flagOperation(tx, operation, { code: "numberGap", detail: { ...gap } }, dependencies);
  await recordAudit(tx, {
    id: dependencies.newId(),
    tenantId: operation.tenantId,
    branchId: operation.branchId,
    occurredAt: operation.receivedAt,
    userId: operation.userId,
    deviceId: operation.device.id,
    action: "organization.numbering.gap",
    entity: document.entity,
    after: { ...gap },
  });
  return gap;
}
