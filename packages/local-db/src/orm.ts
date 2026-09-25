import { customType } from "drizzle-orm/sqlite-core";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import type { LocalExecutor, LocalValue } from "./local-db.ts";

/**
 * Drizzle over a `LocalDb` executor (ADR-0019: Drizzle's `sqlite-proxy` on top), so modules
 * write local queries the way they write server queries. Inside a transaction, build it on
 * the transaction's executor: `localOrm(tx)`.
 */
export function localOrm(executor: LocalExecutor): SqliteRemoteDatabase {
  return drizzle(async (sql, params, method) => {
    const result = await executor.run(sql, params as LocalValue[]);
    if (method === "run") return { rows: [] };
    // `get` expects the first row itself, not a list of rows.
    return { rows: method === "get" ? (result.rows[0] as unknown[]) : (result.rows as unknown[]) };
  });
}

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  throw new TypeError(`expected an INTEGER, got ${typeof value}`);
}

/**
 * An `INTEGER` read as a `bigint`: scaled amounts and quantities (ADR-0018), converted to
 * `Decimal` in the module's repository with `Decimal.fromScaledInteger` and back with
 * `toScaledInteger`.
 */
export const int64 = customType<{ data: bigint; driverData: bigint }>({
  dataType: () => "integer",
  fromDriver: asBigInt,
});

/** An `INTEGER` that is a count or a sequence number, read as a safe `number`. */
export const safeInteger = customType<{ data: number; driverData: bigint }>({
  dataType: () => "integer",
  fromDriver(value) {
    const integer = asBigInt(value);
    if (integer > BigInt(Number.MAX_SAFE_INTEGER) || integer < BigInt(Number.MIN_SAFE_INTEGER)) {
      throw new RangeError(`${integer.toString()} is not a safe integer`);
    }
    return Number(integer);
  },
  toDriver: (value) => BigInt(value),
});
