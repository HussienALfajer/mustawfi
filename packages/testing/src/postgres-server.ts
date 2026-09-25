import type pg from "pg";

/** The pinned PostgreSQL 18 image for integration tests (ADR-0016, ADR-0026). */
export const POSTGRES_IMAGE = "postgres:18.6-alpine";

/** Owns the schemas and runs migrations; never used by a running app (ADR-0017). */
export const OWNER_ROLE = "mustawfi_owner";
/** The role running apps connect as: DML only, no `BYPASSRLS`, owns nothing (ADR-0017). */
export const APP_ROLE = "mustawfi_app";

export interface Credentials {
  readonly user: string;
  readonly password: string;
}

/** What the global setup hands to test files through Vitest's `provide`/`inject`. */
export interface PostgresServer {
  readonly host: string;
  readonly port: number;
  readonly superuser: Credentials;
  readonly owner: Credentials;
  readonly app: Credentials;
}

export function connectionString(
  server: PostgresServer,
  credentials: Credentials,
  database: string,
): string {
  const user = encodeURIComponent(credentials.user);
  const password = encodeURIComponent(credentials.password);
  return `postgres://${user}:${password}@${server.host}:${server.port}/${database}`;
}

/**
 * Creates the cluster roles of ADR-0017 on a fresh server. Production creates the same roles
 * in its provisioning step (`ops` unit).
 */
export async function createRoles(superuser: pg.Client, server: PostgresServer): Promise<void> {
  for (const role of [server.owner, server.app]) {
    await superuser.query(
      `CREATE ROLE ${superuser.escapeIdentifier(role.user)} LOGIN PASSWORD ${superuser.escapeLiteral(role.password)} ` +
        "NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS",
    );
  }
}
