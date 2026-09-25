import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  APP_ROLE,
  connectionString,
  createRoles,
  OWNER_ROLE,
  POSTGRES_IMAGE,
  type PostgresServer,
} from "@mustawfi/testing/postgres-server";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { E2E_API_PORT, E2E_STORE_ENV, type E2eStore } from "./environment.ts";

const serverDir = resolve(import.meta.dirname, "../../server");
const DATABASE = "mustawfi_e2e";

/** Runs a server CLI to completion and returns its standard output. */
function runCli(script: string, args: string[], env: Record<string, string>, stdin = "") {
  return new Promise<string>((done, fail) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: serverDir,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", fail);
    child.on("close", (code) => {
      if (code === 0) done(stdout);
      else fail(new Error(`${script} exited with ${String(code)}:\n${stderr}`));
    });
    child.stdin.end(stdin);
  });
}

async function waitForHealth(server: ChildProcess, output: () => string): Promise<void> {
  const deadline = performance.now() + 30_000;
  while (performance.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`the API server exited:\n${output()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${String(E2E_API_PORT)}/api/v1/health`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((wake) => setTimeout(wake, 200));
  }
  throw new Error(`the API server did not become healthy:\n${output()}`);
}

/**
 * Starts PostgreSQL 18 with the roles of ADR-0017, migrates as `mustawfi_owner`, creates a
 * store with the `tenant:create` CLI, and starts the API server as `mustawfi_app` — the same
 * commands a deployment runs.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
  const postgres: PostgresServer = {
    host: container.getHost(),
    port: container.getPort(),
    superuser: { user: container.getUsername(), password: container.getPassword() },
    owner: { user: OWNER_ROLE, password: "owner-e2e-password" },
    app: { user: APP_ROLE, password: "app-e2e-password" },
  };
  let server: ChildProcess | undefined;
  const teardown = async () => {
    server?.kill();
    await container.stop();
  };

  try {
    const superuser = new pg.Client(connectionString(postgres, postgres.superuser, "postgres"));
    await superuser.connect();
    try {
      await createRoles(superuser, postgres);
      await superuser.query(`CREATE DATABASE ${DATABASE} OWNER ${OWNER_ROLE}`);
      await superuser.query(`REVOKE ALL ON DATABASE ${DATABASE} FROM PUBLIC`);
      await superuser.query(`GRANT CONNECT ON DATABASE ${DATABASE} TO ${APP_ROLE}`);
    } finally {
      await superuser.end();
    }
    const ownerUrl = connectionString(postgres, postgres.owner, DATABASE);
    const appUrl = connectionString(postgres, postgres.app, DATABASE);

    await runCli("src/cli/migrate.ts", [], { DATABASE_OWNER_URL: ownerUrl });
    const store: Omit<E2eStore, "storeCode"> = {
      login: "owner",
      password: "correct horse battery staple",
    };
    const created = await runCli(
      "src/cli/create-tenant.ts",
      [
        "--name",
        "متجر الاختبار",
        "--base-currency",
        "SYP",
        "--owner-name",
        "سامر",
        "--owner-login",
        store.login,
      ],
      { DATABASE_URL: appUrl },
      `${store.password}\n`,
    );
    const { storeCode } = JSON.parse(created) as { storeCode: string };
    process.env[E2E_STORE_ENV] = JSON.stringify({ ...store, storeCode } satisfies E2eStore);

    let output = "";
    server = spawn(process.execPath, ["src/main.ts"], {
      cwd: serverDir,
      env: {
        ...process.env,
        DATABASE_URL: appUrl,
        HOST: "127.0.0.1",
        PORT: String(E2E_API_PORT),
      },
    });
    server.stdout?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    server.stderr?.on("data", (chunk: Buffer) => (output += chunk.toString()));
    await waitForHealth(server, () => output);
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}
