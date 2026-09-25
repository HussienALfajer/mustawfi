import type pg from "pg";

/**
 * The tenant policy of ADR-0017 as PostgreSQL deparses it. `nullif` turns the empty string a
 * pooled connection keeps after a transaction-local `set_config` back into NULL, so a missing
 * context matches no row instead of failing the `::uuid` cast.
 */
export const TENANT_POLICY_EXPRESSION =
  "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)";

export interface CatalogProblem {
  /** `schema.table` */
  readonly table: string;
  readonly problem: string;
}

export interface RlsCatalog {
  /** Every table the check covered, as `schema.table`, sorted by code unit like `Array#sort`. */
  readonly tables: string[];
  readonly problems: CatalogProblem[];
}

interface TableRow {
  table: string;
  kind: string;
  rls_enabled: boolean;
  rls_forced: boolean;
  tenant_id: string | null;
  branch_id: string | null;
  policies: {
    name: string;
    permissive: boolean;
    command: string;
    using: string | null;
    check: string | null;
  }[];
}

/**
 * Checks every table outside the system schemas and the migrations bookkeeping against
 * ADR-0017: `tenant_id` and `branch_id` as `uuid not null`, row-level security enabled and
 * forced, the tenant policy for all commands, and no other permissive policy (permissive
 * policies are OR-ed, so any other one widens access). Materialized views and foreign tables
 * cannot carry row-level security, so any in a module schema is a problem.
 */
export async function inspectRlsCatalog(client: pg.Client): Promise<RlsCatalog> {
  const { rows } = await client.query<TableRow>(`
    select n.nspname || '.' || c.relname as table,
      c.relkind as kind,
      c.relrowsecurity as rls_enabled,
      c.relforcerowsecurity as rls_forced,
      (select format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' not null' else '' end
       from pg_attribute a
       where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped) as tenant_id,
      (select format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' not null' else '' end
       from pg_attribute a
       where a.attrelid = c.oid and a.attname = 'branch_id' and not a.attisdropped) as branch_id,
      coalesce((
        select json_agg(json_build_object(
          'name', p.polname,
          'permissive', p.polpermissive,
          'command', p.polcmd,
          'using', pg_get_expr(p.polqual, p.polrelid),
          'check', pg_get_expr(p.polwithcheck, p.polrelid)) order by p.polname)
        from pg_policy p where p.polrelid = c.oid), '[]') as policies
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p', 'm', 'f')
      and n.nspname not in ('information_schema', 'mustawfi_migrations')
      and n.nspname not like 'pg\\_%'
    order by 1`);
  rows.sort((x, y) => (x.table < y.table ? -1 : x.table > y.table ? 1 : 0));

  const problems: CatalogProblem[] = [];
  for (const row of rows) {
    const report = (problem: string) => problems.push({ table: row.table, problem });
    if (row.kind === "m" || row.kind === "f") {
      report("materialized views and foreign tables cannot enforce row-level security");
      continue;
    }
    if (row.tenant_id !== "uuid not null") report("tenant_id must be uuid not null");
    if (row.branch_id !== "uuid not null") report("branch_id must be uuid not null");
    if (!row.rls_enabled) report("row-level security is not enabled");
    if (!row.rls_forced) report("row-level security is not forced");

    const isTenantPolicy = (p: TableRow["policies"][number]) =>
      p.permissive &&
      p.command === "*" &&
      p.using === TENANT_POLICY_EXPRESSION &&
      p.check === TENANT_POLICY_EXPRESSION;
    if (!row.policies.some(isTenantPolicy)) {
      report("no permissive policy for all commands with the tenant USING and WITH CHECK");
    }
    for (const policy of row.policies) {
      if (policy.permissive && !isTenantPolicy(policy)) {
        report(`permissive policy ${policy.name} is not the tenant policy and widens it`);
      }
    }
  }
  return { tables: rows.map((r) => r.table), problems };
}
