import {
  createLocalDb,
  DURABILITY_PRAGMAS,
  type LocalDb,
  LocalDbError,
  type LocalValue,
  type SqliteConnection,
  type StatementResult,
} from "./local-db.ts";

/**
 * A value on the wire to the native core (`packages/local-db/native`): integers and reals as
 * strings — a JSON number would lose 64-bit integers, and JSON has no infinity — blobs as base64.
 */
export type WireValue = { i: string } | { r: string } | { t: string } | { b: string } | null;

/** The native core's protocol: the same for the Tauri command and the stdio test host. */
export type NativeRequest =
  | { readonly kind: "open"; readonly name: string }
  | { readonly kind: "run"; readonly sql: string; readonly params: readonly WireValue[] }
  | { readonly kind: "backup"; readonly keep: number; readonly minAgeMs?: number }
  | { readonly kind: "removeBackups" }
  | { readonly kind: "close" };

export type NativeResponse =
  | { readonly kind: "opened" }
  | {
      readonly kind: "ran";
      readonly columns: readonly string[];
      readonly rows: readonly (readonly WireValue[])[];
      readonly changes: number;
    }
  | { readonly kind: "backedUp"; readonly file: string | null }
  | { readonly kind: "backupsRemoved"; readonly removed: number }
  | { readonly kind: "closed" };

/** Sends one request to the native core; rejects with the core's error message. */
export type NativeTransport = (request: NativeRequest) => Promise<NativeResponse>;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const REAL_TEXT: Readonly<Record<string, number>> = {
  inf: Infinity,
  "-inf": -Infinity,
  NaN: NaN,
};

export function encodeWireValue(value: LocalValue): WireValue {
  if (value === null) return null;
  if (typeof value === "bigint") return { i: value.toString() };
  if (typeof value === "number") return { r: String(value) };
  if (typeof value === "string") return { t: value };
  return { b: toBase64(value) };
}

export function decodeWireValue(value: WireValue): LocalValue {
  if (value === null) return null;
  if ("i" in value) return BigInt(value.i);
  if ("r" in value) return REAL_TEXT[value.r] ?? Number(value.r);
  if ("t" in value) return value.t;
  return fromBase64(value.b);
}

async function send(transport: NativeTransport, request: NativeRequest): Promise<NativeResponse> {
  try {
    return await transport(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new LocalDbError(message, { cause: error });
  }
}

function unexpected(response: NativeResponse): never {
  throw new LocalDbError(`the native local database answered ${response.kind} unexpectedly`);
}

/** How many copies of the database the device keeps (ADR-0019). */
export const LOCAL_BACKUPS_KEPT = 7;

export interface NativeLocalDb {
  readonly db: LocalDb;
  /**
   * Copies the database with `VACUUM INTO` into `backups/` beside it, keeping the newest
   * `LOCAL_BACKUPS_KEPT` (ADR-0019). With `minAgeMs`, only when the newest copy is older.
   * Resolves to the copy's file name, or `undefined` when skipped (too recent, or a
   * transaction was open — try again later).
   */
  backup(options?: { readonly minAgeMs?: number }): Promise<string | undefined>;
  /**
   * Deletes every backup of the database: a revoked device wipes its data, its copies included
   * (`core-foundation` rule 23). Resolves to how many were deleted.
   */
  removeBackups(): Promise<number>;
}

/**
 * The native adapter (ADR-0019): a real SQLite file owned by the native side — the Windows
 * shell's Rust core, or its stdio host in tests — reached one request at a time through
 * `transport`. The database opens in WAL with `synchronous = FULL`.
 */
export async function openNativeLocalDb(
  transport: NativeTransport,
  name: string,
): Promise<NativeLocalDb> {
  const opened = await send(transport, { kind: "open", name });
  if (opened.kind !== "opened") unexpected(opened);
  const connection: SqliteConnection = {
    async run(sql, params) {
      const response = await send(transport, {
        kind: "run",
        sql,
        params: params.map(encodeWireValue),
      });
      if (response.kind !== "ran") unexpected(response);
      return {
        columns: response.columns,
        rows: response.rows.map((row) => row.map(decodeWireValue)),
        changes: response.changes,
      } satisfies StatementResult;
    },
    async close() {
      const response = await send(transport, { kind: "close" });
      if (response.kind !== "closed") unexpected(response);
    },
  };
  const journal = await connection.run("PRAGMA journal_mode = WAL", []);
  for (const pragma of DURABILITY_PRAGMAS) await connection.run(pragma, []);
  // SQLite keeps its old mode where WAL cannot work; the till still sells, but say so.
  if (journal.rows[0]?.[0] !== "wal") {
    console.warn("the local database is not in WAL mode", journal.rows[0]?.[0]);
  }
  return {
    db: createLocalDb(connection),
    async backup(options = {}) {
      const response = await send(transport, {
        kind: "backup",
        keep: LOCAL_BACKUPS_KEPT,
        ...(options.minAgeMs === undefined ? {} : { minAgeMs: options.minAgeMs }),
      });
      if (response.kind !== "backedUp") unexpected(response);
      return response.file ?? undefined;
    },
    async removeBackups() {
      const response = await send(transport, { kind: "removeBackups" });
      if (response.kind !== "backupsRemoved") unexpected(response);
      return response.removed;
    },
  };
}
