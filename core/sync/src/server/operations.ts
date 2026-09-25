import { problemCodeSchema } from "@mustawfi/core-config/shared";
import type { TenantTransaction } from "@mustawfi/core-tenancy/server";
import type { Clock, IdGenerator } from "@mustawfi/kernel";
import { operationTypeSchema, type SyncValues } from "../shared/index.ts";

/** An operation as its handler receives it: checked envelope, unchecked payload. */
export interface ReceivedOperation {
  readonly opId: string;
  readonly deviceSeq: number;
  readonly type: string;
  readonly payloadVersion: number;
  /** As the device sent it; the handler parses it. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** The device's tenant: the tenant of the `withTenant` context the handler runs in. */
  readonly tenantId: string;
  /** The device's branch. */
  readonly branchId: string;
  readonly device: { readonly id: string; readonly prefix: string };
  /** A user of the tenant: checked before the handler runs. */
  readonly userId: string;
  readonly shiftId: string;
  /** The device's clock when the operation was created. */
  readonly createdAt: Date;
  /** The server's clock when it was received. */
  readonly receivedAt: Date;
}

export interface SyncHandlerDependencies {
  readonly clock: Clock;
  readonly newId: IdGenerator;
}

/**
 * Records one operation in `tx`, the operation's own transaction, and returns what the device
 * is answered with (stored, and answered again to a retry). It throws `OperationRejected` only
 * for what cannot be recorded — a malformed payload, a reference to nothing — never for a
 * business rule: a completed sale is recorded as the device recorded it and flagged
 * (ADR-0020). Anything else it throws is a failure: nothing is stored and the device retries.
 */
export type SyncOperationHandler = (
  tx: TenantTransaction,
  operation: ReceivedOperation,
  dependencies: SyncHandlerDependencies,
) => Promise<SyncValues>;

/** An operation type a module handles, with a handler per payload version it still accepts. */
export interface SyncOperationDefinition {
  readonly type: string;
  readonly versions: Readonly<Record<number, SyncOperationHandler>>;
}

/**
 * Thrown by a handler for an operation that cannot be recorded. The whole operation is rolled
 * back, then stored as rejected with `code`, so the device can show it for review.
 */
export class OperationRejected extends Error {
  override name = "OperationRejected";
  readonly code: string;
  readonly detail: string | undefined;

  constructor(code: string, detail?: string) {
    super(detail ?? code);
    this.code = problemCodeSchema.parse(code);
    this.detail = detail;
  }
}

/** The operation types this server handles, from its enabled modules. */
export interface SyncOperationTable {
  readonly types: readonly string[];
  get(type: string): SyncOperationDefinition | undefined;
}

/**
 * Builds the table the push endpoint dispatches through. Refuses a type defined twice, a
 * malformed type, or a type without any payload version.
 */
export function createSyncOperationTable(
  definitions: readonly SyncOperationDefinition[],
): SyncOperationTable {
  const byType = new Map<string, SyncOperationDefinition>();
  for (const definition of definitions) {
    operationTypeSchema.parse(definition.type);
    if (byType.has(definition.type)) {
      throw new TypeError(`sync operation ${definition.type} is defined twice`);
    }
    const versions = Object.keys(definition.versions);
    if (versions.length === 0 || !versions.every((v) => /^[1-9]\d*$/.test(v))) {
      throw new TypeError(`sync operation ${definition.type} needs payload versions from 1`);
    }
    byType.set(definition.type, definition);
  }
  return {
    types: [...byType.keys()],
    get: (type) => byType.get(type),
  };
}
