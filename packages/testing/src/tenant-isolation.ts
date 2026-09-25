import { sql, type SQL } from "drizzle-orm";
import type pg from "pg";
import { expect } from "vitest";

export interface QueryOutcome {
  readonly rows: Record<string, unknown>[];
  readonly rowCount: number | null;
}

export type Execute = (query: SQL) => Promise<QueryOutcome>;

export interface IsolationSubject {
  /** `schema.table`, already seeded with rows of both tenants. */
  readonly table: string;
  /** Tenant A (the actor) and tenant B (the target). */
  readonly tenants: readonly [string, string];
  /** Runs `fn` as the application does: inside `withTenant` for `tenantId`. */
  runAs<T>(tenantId: string, fn: (execute: Execute) => Promise<T>): Promise<T>;
  /** Superuser connection to the same database: the ground truth, past RLS. */
  readonly superuser: pg.Client;
  /** A plain `mustawfi_app` connection, for the checks without any tenant context. */
  readonly app: pg.Client;
}

type Attempt = { readonly rowCount: number } | { readonly refused: string };

/** Thrown to roll an attempt back once its outcome is recorded. */
class Rollback extends Error {}

/** The SQLSTATE of a database error, looking through driver and ORM wrappers. */
export function sqlState(error: unknown): string | undefined {
  for (let e = error; e instanceof Error; e = e.cause) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
  }
  return undefined;
}

/** `42501`: permission denied, or a row-level security `WITH CHECK` violation. */
const INSUFFICIENT_PRIVILEGE = "42501";

/**
 * Runs `statement` as `tenantId` and always rolls back. Returns the affected row count, or
 * the refusal when the database refuses it on privilege or policy grounds.
 */
async function attempt(
  subject: IsolationSubject,
  tenantId: string,
  statement: SQL,
): Promise<Attempt> {
  let outcome: Attempt | undefined;
  try {
    await subject.runAs(tenantId, async (execute) => {
      const result = await execute(statement);
      outcome = { rowCount: result.rowCount ?? 0 };
      throw new Rollback();
    });
  } catch (error) {
    if (error instanceof Rollback && outcome !== undefined) return outcome;
    const code = sqlState(error);
    if (code === INSUFFICIENT_PRIVILEGE) return { refused: code };
    throw error;
  }
  throw new Error("runAs returned without running its callback");
}

/**
 * ADR-0017's isolation test for one table: as tenant A, B's rows cannot be read, counted,
 * changed, deleted, or written; and without a tenant context — even on a connection that
 * carried one before — nothing is visible and nothing can be inserted.
 */
export async function assertTenantIsolation(subject: IsolationSubject): Promise<void> {
  const { superuser, app, table } = subject;
  const [a, b] = subject.tenants;
  const [schema, name] = table.split(".") as [string, string];
  const target = sql`${sql.identifier(schema)}.${sql.identifier(name)}`;
  const quoted = `${superuser.escapeIdentifier(schema)}.${superuser.escapeIdentifier(name)}`;

  const truth = async (tenantId: string) => {
    const { rows } = await superuser.query<{ n: number }>(
      `select count(*)::int as n from ${quoted} where tenant_id = $1`,
      [tenantId],
    );
    return rows[0]?.n ?? 0;
  };
  const sampleRow = async (tenantId: string) => {
    const { rows } = await superuser.query<{ row: Record<string, unknown> }>(
      `select to_jsonb(t) as row from ${quoted} t where tenant_id = $1 limit 1`,
      [tenantId],
    );
    const row = rows[0]?.row;
    if (row === undefined) throw new Error(`${table}: no seeded row for tenant ${tenantId}`);
    return row;
  };
  /** An insert of a copy of `row`; a fresh `id` keeps the primary key out of the way. */
  const insertCopy = (row: Record<string, unknown>) => {
    const copy =
      "id" in row
        ? sql`${JSON.stringify(row)}::jsonb || jsonb_build_object('id', gen_random_uuid())`
        : sql`${JSON.stringify(row)}::jsonb`;
    return sql`insert into ${target} select * from jsonb_populate_record(null::${target}, ${copy})`;
  };

  const countA = await truth(a);
  const countB = await truth(b);
  expect(countA, `${table}: seed rows for tenant A`).toBeGreaterThan(0);
  expect(countB, `${table}: seed rows for tenant B`).toBeGreaterThan(0);
  const rowOfA = await sampleRow(a);
  const rowOfB = await sampleRow(b);

  // Read and count.
  const seen = await subject.runAs(a, async (execute) => {
    const all = await execute(
      sql`select count(*)::int as n, (count(*) filter (where tenant_id <> ${a}))::int as foreign_rows from ${target}`,
    );
    const aimed = await execute(
      sql`select count(*)::int as n from ${target} where tenant_id = ${b}`,
    );
    return { ...all.rows[0], aimedAtB: aimed.rows[0]?.n };
  });
  expect(seen, `${table}: tenant A reads and counts only its own rows`).toEqual({
    n: countA,
    foreign_rows: 0,
    aimedAtB: 0,
  });

  // Change and delete: aimed at B they touch nothing; unaimed they touch only A's rows.
  const changes = {
    updateB: await attempt(
      subject,
      a,
      sql`update ${target} set tenant_id = tenant_id where tenant_id = ${b}`,
    ),
    deleteB: await attempt(subject, a, sql`delete from ${target} where tenant_id = ${b}`),
    updateAll: await attempt(subject, a, sql`update ${target} set tenant_id = tenant_id`),
    deleteAll: await attempt(subject, a, sql`delete from ${target}`),
  };
  for (const [change, outcome] of Object.entries(changes)) {
    if ("refused" in outcome) continue;
    expect(outcome.rowCount, `${table}: ${change} as tenant A`).toBe(
      change.endsWith("B") ? 0 : countA,
    );
  }

  // Write into B: neither a new row of B nor moving a row of A to B.
  expect(
    await attempt(subject, a, insertCopy(rowOfB)),
    `${table}: tenant A inserts a row of tenant B`,
  ).toEqual({ refused: INSUFFICIENT_PRIVILEGE });
  expect(
    await attempt(subject, a, sql`update ${target} set tenant_id = ${b}`),
    `${table}: tenant A moves its rows to tenant B`,
  ).toEqual({ refused: INSUFFICIENT_PRIVILEGE });

  expect(await truth(a), `${table}: tenant A's rows after the attempts`).toBe(countA);
  expect(await truth(b), `${table}: tenant B's rows after the attempts`).toBe(countB);

  // No context, on a connection whose earlier transaction had one.
  await app.query("begin");
  await app.query("select set_config('app.tenant_id', $1, true)", [a]);
  await app.query("commit");
  const { rows } = await app.query<{ n: number }>(`select count(*)::int as n from ${quoted}`);
  expect(rows[0]?.n, `${table}: rows visible without a tenant context`).toBe(0);
  // Inside a transaction that is rolled back, so a regression cannot leave a stray row.
  await app.query("begin");
  const insertWithoutContext = await app
    .query(
      `insert into ${quoted} select * from jsonb_populate_record(null::${quoted}, $1::jsonb${"id" in rowOfA ? " || jsonb_build_object('id', gen_random_uuid())" : ""})`,
      [JSON.stringify(rowOfA)],
    )
    .then(
      () => "inserted",
      (error: unknown) => sqlState(error),
    );
  await app.query("rollback");
  expect(insertWithoutContext, `${table}: insert without a tenant context`).toBe(
    INSUFFICIENT_PRIVILEGE,
  );
}
