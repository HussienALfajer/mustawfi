import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APP_ROLE,
  connectionString,
  createRoles,
  OWNER_ROLE,
  POSTGRES_IMAGE,
  type PostgresServer,
} from "@mustawfi/testing/postgres-server";
import { issueTestLicense, testLicensePublicKeys } from "@mustawfi/tools-license/testing";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { E2E_API_PORT, E2E_BUNDLE_KEY_ENV, E2E_STORE_ENV, type E2eStore } from "./environment.ts";
import { runCli, SERVER_DIR } from "./server-cli.ts";

const DATABASE = "mustawfi_e2e";

/**
 * Stops a child and waits for it: SIGTERM for a graceful close, SIGKILL after five seconds.
 * A child left running keeps its output pipes open, and the test run never ends.
 */
async function stopProcess(child: ChildProcess | undefined): Promise<void> {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((done) => child.once("exit", done));
  child.kill("SIGTERM");
  const force = setTimeout(() => child.kill("SIGKILL"), 5_000);
  await exited;
  clearTimeout(force);
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
 * store with the `tenant:create` CLI and a license signed by the test key, and starts the API server as `mustawfi_app` — the same
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
  // The key file sealing TOTP secrets, made for this run and removed with it.
  const secrets = mkdtempSync(join(tmpdir(), "mustawfi-e2e-"));
  const totpKeysFile = join(secrets, "totp.keys");
  // The bundle key the Playwright config made: the app was built with its public half.
  const bundleKeyFile = join(secrets, "bundle.key");
  const teardown = async () => {
    await stopProcess(server);
    await container.stop();
    rmSync(secrets, { recursive: true, force: true });
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
    await runCli("src/cli/totp-key.ts", ["--kid", "e2e", "--out", totpKeysFile], {});
    const bundleKey = process.env[E2E_BUNDLE_KEY_ENV];
    if (bundleKey === undefined) throw new Error("the Playwright config made no bundle key");
    writeFileSync(bundleKeyFile, bundleKey, { mode: 0o600 });
    const store: Omit<E2eStore, "storeCode"> = {
      login: "owner",
      password: "correct horse battery staple",
      databaseUrl: appUrl,
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
        "--license",
        // Journeys register the browser as a companion device, each in a fresh context.
        // Journeys add users and departments too, each their own.
        (await issueTestLicense({ limits: { companionDevices: 20, users: 20, departments: 20 } }))
          .jws,
      ],
      { DATABASE_URL: appUrl, LICENSE_PUBLIC_KEYS: await testLicensePublicKeys() },
      `${store.password}\n`,
    );
    const { storeCode } = JSON.parse(created) as { storeCode: string };
    process.env[E2E_STORE_ENV] = JSON.stringify({ ...store, storeCode } satisfies E2eStore);

    let output = "";
    server = spawn(process.execPath, ["src/main.ts"], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        DATABASE_URL: appUrl,
        HOST: "127.0.0.1",
        PORT: String(E2E_API_PORT),
        TOTP_KEYS_FILE: totpKeysFile,
        BUNDLE_KEY_FILE: bundleKeyFile,
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
