import { z } from "zod";

/** A UUID as the kernel writes it: lowercase, as ids are compared and stored (ADR-0016). */
export const syncIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "a lowercase UUID");

/** What an operation does, `module.subject.verb` in dotted camelCase (`sales.invoice.post`). */
export const operationTypeSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/, "an operation type is dotted camelCase");

/** A JSON object: an operation's payload, or what the server answered it with. */
export type SyncValues = { readonly [key: string]: SyncValue };
export type SyncValue =
  string | number | boolean | null | readonly SyncValue[] | { readonly [key: string]: SyncValue };

const jsonObjectSchema = z.record(z.string(), z.unknown());

/**
 * One outbox entry (ADR-0020). `deviceSeq` counts the device's operations from 1 without
 * gaps; `createdAt` is the device's clock. The payload is checked by the operation's handler.
 */
export const syncOperationSchema = z.object({
  opId: syncIdSchema,
  deviceId: syncIdSchema,
  deviceSeq: z.int().min(1).max(Number.MAX_SAFE_INTEGER),
  type: operationTypeSchema,
  payloadVersion: z.int().min(1).max(32_767),
  payload: jsonObjectSchema,
  /** Who performed it on the device. */
  userId: syncIdSchema,
  shiftId: syncIdSchema,
  createdAt: z.iso.datetime({ offset: true }),
});

export type SyncOperation = z.infer<typeof syncOperationSchema>;

/** The most operations one push carries. */
export const PUSH_BATCH_LIMIT = 100;

/** `POST /api/v1/sync/push`, authenticated with the device credential. */
export const pushRequestSchema = z.object({
  operations: z.array(syncOperationSchema).min(1).max(PUSH_BATCH_LIMIT),
});

const resultBase = { opId: syncIdSchema, deviceSeq: z.int() };

/**
 * The server's answer to one operation. `accepted`: recorded now. `duplicate`: recorded by an
 * earlier push, with the result stored then. `rejected`: it cannot be recorded (ADR-0020) —
 * the device keeps it in its *needs review* queue. A rejection is stored too, so pushing it
 * again returns the same rejection.
 */
export const operationResultSchema = z.discriminatedUnion("status", [
  z.object({ ...resultBase, status: z.literal("accepted"), result: jsonObjectSchema }),
  z.object({ ...resultBase, status: z.literal("duplicate"), result: jsonObjectSchema }),
  z.object({
    ...resultBase,
    status: z.literal("rejected"),
    code: z.string(),
    detail: z.string().optional(),
  }),
]);

export type OperationResult = z.infer<typeof operationResultSchema>;

export const pushResponseSchema = z.object({
  /** One per processed operation, in `deviceSeq` order. */
  results: z.array(operationResultSchema),
  /** The `deviceSeq` the server expects next from this device. */
  nextDeviceSeq: z.int().min(1),
  /**
   * Processing stopped at a gap in `deviceSeq`: the operations from `nextDeviceSeq` on were
   * not processed, and the device resends from there.
   */
  gap: z.boolean(),
  /**
   * The device is revoked (`core-foundation` rule 23): what it pushed was still accepted, and
   * flagged `deviceRevoked`. Once every operation it holds has an answer, it wipes its data.
   */
  revoked: z.boolean(),
});

export type PushResponse = z.infer<typeof pushResponseSchema>;

/**
 * Where a device is in its tenant's change log; opaque to the device. `"0"` is the start. At
 * most 15 digits, so it stays a safe integer.
 */
export const syncCursorSchema = z.string().regex(/^(0|[1-9]\d{0,14})$/, "a sync cursor");

export const PULL_PAGE_LIMIT = 200;

/** `GET /api/v1/sync/pull?cursor=&limit=`, authenticated with the device credential. */
export const pullQuerySchema = z.object({
  cursor: syncCursorSchema.default("0"),
  limit: z.coerce.number().int().min(1).max(1000).default(PULL_PAGE_LIMIT),
});

/** One change to data that flows down: the entity's full row, or `null` for a tombstone. */
export const syncChangeSchema = z.object({
  /** `inventory.product`… */
  entity: operationTypeSchema,
  id: syncIdSchema,
  row: jsonObjectSchema.nullable(),
});

export type SyncChange = z.infer<typeof syncChangeSchema>;

export const pullResponseSchema = z.object({
  /** In commit order. */
  changes: z.array(syncChangeSchema),
  /**
   * Saved by the device in the same local transaction that applies `changes`, and sent as
   * `cursor` on the next pull.
   */
  cursor: syncCursorSchema,
  /** More changes wait after this page. */
  more: z.boolean(),
});

export type PullResponse = z.infer<typeof pullResponseSchema>;

/** The refusals and rejections of `core.sync`; clients map each code to an Arabic message. */
export const syncProblemCodes = {
  /** A push carried an operation of another device (the whole push is refused). */
  wrongDevice: "sync.push.wrongDevice",
  /** No handler for the operation's type on this server. */
  unsupportedType: "sync.operation.unsupportedType",
  /** The operation's type is known, but not its payload version. */
  unsupportedVersion: "sync.operation.unsupportedVersion",
  /** The user the operation names is not a user of the device's store. */
  unknownUser: "sync.operation.unknownUser",
  /**
   * Another operation already holds this `deviceSeq`. Not stored (the sequence number is
   * taken), so it is answered again on every push.
   */
  seqTaken: "sync.operation.seqTaken",
} as const;

/**
 * What the server flags on an accepted operation of any document type, for the accountant
 * (ADR-0020, ADR-0030): the document is recorded as the device sent it, never refused.
 * `deviceRevoked`: pushed by a revoked device. `licenseReadOnly`: dated on a business day after
 * the store became read-only. `permissionMissing`: its user lacked the operation's permission.
 * `overrideNotAuthorized`: its supervisor override did not cover it. `numberGap`: its number
 * skipped numbers of its device and document code.
 */
export const operationFlagCodeSchema = z.enum([
  "deviceRevoked",
  "licenseReadOnly",
  "permissionMissing",
  "overrideNotAuthorized",
  "numberGap",
]);
export type OperationFlagCode = z.infer<typeof operationFlagCodeSchema>;
