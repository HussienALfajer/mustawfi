import { randomBytes } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";
import { APP_ROLE, OWNER_ROLE, connectionString, type PostgresServer } from "./postgres-server.ts";

declare module "vitest" {
  export interface ProvidedContext {
    postgres: PostgresServer;
  }
}

export type Role = "superuser" | "owner" | "app";

/** A database of its own for one test file, owned by `mustawfi_owner`. */
export interface TestDatabase {
  readonly name: string;
  /** Connection string for the database as the given role. */
  url(role: Role): string;
  /** Connects a single client; the caller ends it. */
  connect(role: Role): Promise<pg.Client>;
}

/**
 * Creates an empty database owned by `mustawfi_owner`, reachable by `mustawfi_app` only
 * through `CONNECT`. Migrations are the caller's to apply.
 */
export async function createTestDatabase(label: string): Promise<TestDatabase> {
  const server = inject("postgres");
  // PostgreSQL truncates names at 63 bytes; keep the random suffix whole.
  const prefix = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .slice(0, 40);
  const name = `${prefix}_${randomBytes(4).toString("hex")}`;
  const superuser = new pg.Client(connectionString(server, server.superuser, "postgres"));
  await superuser.connect();
  try {
    const db = superuser.escapeIdentifier(name);
    await superuser.query(`CREATE DATABASE ${db} OWNER ${superuser.escapeIdentifier(OWNER_ROLE)}`);
    await superuser.query(`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`);
    await superuser.query(
      `GRANT CONNECT ON DATABASE ${db} TO ${superuser.escapeIdentifier(APP_ROLE)}`,
    );
  } finally {
    await superuser.end();
  }

  const credentials = { superuser: server.superuser, owner: server.owner, app: server.app };
  const url = (role: Role) => connectionString(server, credentials[role], name);
  return {
    name,
    url,
    async connect(role) {
      const client = new pg.Client(url(role));
      await client.connect();
      return client;
    },
  };
}
