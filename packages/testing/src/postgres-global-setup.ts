import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import type { TestProject } from "vitest/node";
import {
  APP_ROLE,
  OWNER_ROLE,
  POSTGRES_IMAGE,
  connectionString,
  createRoles,
  type PostgresServer,
} from "./postgres-server.ts";

/**
 * Vitest global setup: one PostgreSQL 18 container per test run, with the roles of ADR-0017.
 * Test files get the server through `inject("postgres")` and create their own databases.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const server: PostgresServer = {
    host: container.getHost(),
    port: container.getPort(),
    superuser: { user: container.getUsername(), password: container.getPassword() },
    owner: { user: OWNER_ROLE, password: "owner-test-password" },
    app: { user: APP_ROLE, password: "app-test-password" },
  };

  const superuser = new pg.Client(connectionString(server, server.superuser, "postgres"));
  try {
    await superuser.connect();
    await createRoles(superuser, server);
  } catch (error) {
    await container.stop();
    throw error;
  } finally {
    await superuser.end();
  }

  project.provide("postgres", server);
  return async () => {
    await container.stop();
  };
}
