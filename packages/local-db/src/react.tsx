import { createContext, type ReactNode, useContext } from "react";
import { ALL_TABLES, type ChangedTables, type LocalDb } from "./local-db.ts";

const LocalDbContext = createContext<LocalDb | undefined>(undefined);

/** Hands the opened local database to the screens under it. */
export function LocalDbProvider(props: { readonly db: LocalDb; readonly children: ReactNode }) {
  return <LocalDbContext.Provider value={props.db}>{props.children}</LocalDbContext.Provider>;
}

/** The local database the app opened; screens read and write through module repositories. */
export function useLocalDb(): LocalDb {
  const db = useContext(LocalDbContext);
  if (db === undefined) throw new Error("useLocalDb outside LocalDbProvider");
  return db;
}

/**
 * The query `meta` that ties a TanStack Query to local tables (ADR-0023): when a commit
 * changes one of them, `touchesLocalTables` makes the app invalidate the query.
 */
export interface LocalQueryMeta extends Record<string, unknown> {
  readonly localTables: readonly string[];
}

/** Whether a query with `meta` reads one of the `changed` tables. */
export function touchesLocalTables(meta: unknown, changed: ChangedTables): boolean {
  const tables = (meta as Partial<LocalQueryMeta> | undefined)?.localTables;
  if (tables === undefined) return false;
  return changed.has(ALL_TABLES) || tables.some((table) => changed.has(table));
}
