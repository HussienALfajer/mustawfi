import { type PermissionCatalogue, problemCodeSchema } from "@mustawfi/core-config/shared";
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

/**
 * What the user an operation names must hold (`core-foundation` rule 17): a permission, with
 * the department it is checked in when the permission is scoped, or `device` for an operation
 * any user of a registered device may send (device audit events). A user without the
 * permission does not stop the operation: it is recorded and flagged `permissionMissing`.
 */
export type SyncOperationAccess =
  | "device"
  | {
      readonly permission: string;
      /**
       * The department of the operation, read from its unchecked payload; required for a scoped
       * permission. `undefined` for a payload without one: the handler rejects it as malformed.
       */
      readonly department?: (payload: Readonly<Record<string, unknown>>) => string | undefined;
    };

/** An operation type a module handles, with a handler per payload version it still accepts. */
export interface SyncOperationDefinition {
  readonly type: string;
  readonly access: SyncOperationAccess;
  /**
   * For an operation that records a document: its business date (`YYYY-MM-DD`), read from its
   * unchecked payload (`undefined` when it has none: the handler rejects it as malformed). A
   * document dated on a business day after the tenant's license became read-only is accepted
   * and flagged `licenseReadOnly` (`core-foundation` rule 5, ADR-0030). Operations that record
   * no document, such as device audit events, leave it out.
   */
  readonly businessDate?: (payload: Readonly<Record<string, unknown>>) => string | undefined;
  /**
   * For an operation whose document may carry supervisor overrides (`core-foundation` rule 18):
   * the list, read from its unchecked payload (`undefined` when it carries none). Each is
   * checked against its approver's role at ingest; one that does not cover what it approved
   * flags the operation `overrideNotAuthorized`, and one that does stands in for the seller's
   * missing permission.
   */
  readonly overrides?: (payload: Readonly<Record<string, unknown>>) => unknown;
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
  /** The permissions the operations' access is checked against. */
  readonly permissionCatalogue: PermissionCatalogue;
}

/**
 * Builds the table the push endpoint dispatches through. Refuses a type defined twice, a
 * malformed type, a type without any payload version, and a type whose access names a
 * permission `catalogue` does not declare or a scoped one without its department.
 */
export function createSyncOperationTable(
  definitions: readonly SyncOperationDefinition[],
  catalogue: PermissionCatalogue,
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
    const access = definition.access as SyncOperationAccess | undefined;
    if (access === undefined || (access !== "device" && typeof access !== "object")) {
      throw new TypeError(`sync operation ${definition.type} declares no access`);
    }
    if (access !== "device") {
      const declared = catalogue.permissions.get(access.permission);
      if (declared === undefined) {
        throw new TypeError(
          `sync operation ${definition.type} needs ${access.permission}, which no module declares`,
        );
      }
      if (declared.scoped && access.department === undefined) {
        throw new TypeError(
          `sync operation ${definition.type} needs the scoped ${access.permission}: say where its department is`,
        );
      }
    }
    byType.set(definition.type, definition);
  }
  return {
    types: [...byType.keys()],
    get: (type) => byType.get(type),
    permissionCatalogue: catalogue,
  };
}
