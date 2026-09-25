import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { storeCodeSchema } from "../shared/index.ts";

/** Who is acting: the tenant always, the user and device when known (ADR-0017). */
export interface TenantContext {
  readonly tenantId: string;
  readonly userId?: string;
  readonly deviceId?: string;
}

/** The database handle inside `withTenant`: one transaction with the tenant context set. */
export type TenantTransaction = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];

export interface TenantDatabase {
  /**
   * Runs `fn` in one transaction whose `app.tenant_id` (and `app.user_id`, `app.device_id`)
   * are set transaction-locally, so the context ends at commit or rollback and never leaks
   * through a pooled connection. `fn` throwing rolls the transaction back.
   */
  withTenant<T>(context: TenantContext, fn: (tx: TenantTransaction) => Promise<T>): Promise<T>;
  /**
   * The tenant a store code names, for a sign-in that has no tenant context yet (ADR-0029);
   * `undefined` for a malformed or unknown code. The only read outside `withTenant`: it goes
   * through `core_tenancy.tenant_for_store_code`, which answers one exact code.
   */
  resolveStoreCode(storeCode: string): Promise<string | undefined>;
  close(): Promise<void>;
}

export interface TenantDatabaseOptions {
  /** A connection string for `mustawfi_app` — never the owner or a superuser. */
  readonly connectionString: string;
  readonly maxConnections?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function requireUuid(name: string, value: string): string {
  if (!UUID.test(value)) throw new TypeError(`${name} must be a lowercase UUID, got "${value}"`);
  return value;
}

/**
 * Refuses a role that could see past row-level security: a superuser, a role with
 * `BYPASSRLS`, a member of either, or the owner of a schema or of the database (ADR-0017).
 */
async function assertRestrictedRole(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{
    role: string;
    can_bypass: boolean;
    owns_schema: boolean;
    owns_database: boolean;
  }>(`
    select current_user as role,
      exists (
        select 1 from pg_roles r
        where (r.rolsuper or r.rolbypassrls) and pg_has_role(current_user, r.oid, 'MEMBER')
      ) as can_bypass,
      exists (
        select 1 from pg_namespace n
        where pg_has_role(current_user, n.nspowner, 'MEMBER')
          and n.nspname not in ('public', 'information_schema')
          and n.nspname not like 'pg\\_%'
      ) as owns_schema,
      exists (
        select 1 from pg_database d
        where d.datname = current_database() and pg_has_role(current_user, d.datdba, 'MEMBER')
      ) as owns_database`);
  const row = rows[0];
  if (row === undefined || row.can_bypass || row.owns_schema || row.owns_database) {
    throw new Error(
      `role "${row?.role ?? "?"}" can bypass row-level security or owns a schema or the database; ` +
        "running apps connect as mustawfi_app (ADR-0017)",
    );
  }
}

/**
 * Opens the tenant database. The pool stays inside: the only way to reach the database is
 * `withTenant` (ADR-0017).
 */
export async function openTenantDatabase(options: TenantDatabaseOptions): Promise<TenantDatabase> {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    ...(options.maxConnections === undefined ? {} : { max: options.maxConnections }),
  });
  try {
    await assertRestrictedRole(pool);
  } catch (error) {
    await pool.end();
    throw error;
  }
  const db = drizzle({ client: pool, casing: "snake_case" });

  return {
    async withTenant(context, fn) {
      const tenantId = requireUuid("tenantId", context.tenantId);
      const userId = context.userId === undefined ? "" : requireUuid("userId", context.userId);
      const deviceId =
        context.deviceId === undefined ? "" : requireUuid("deviceId", context.deviceId);
      return db.transaction(async (tx) => {
        await tx.execute(sql`select
          set_config('app.tenant_id', ${tenantId}, true),
          set_config('app.user_id', ${userId}, true),
          set_config('app.device_id', ${deviceId}, true)`);
        return fn(tx);
      });
    },
    async resolveStoreCode(storeCode) {
      const parsed = storeCodeSchema.safeParse(storeCode);
      if (!parsed.success) return undefined;
      const { rows } = await pool.query<{ tenant_id: string | null }>(
        "select core_tenancy.tenant_for_store_code($1) as tenant_id",
        [parsed.data],
      );
      return rows[0]?.tenant_id ?? undefined;
    },
    close: () => pool.end(),
  };
}
