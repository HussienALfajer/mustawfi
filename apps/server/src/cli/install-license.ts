import { parseArgs } from "node:util";
import { openTenantDatabase } from "@mustawfi/core-tenancy/server";
import { LicenseRefusedError } from "@mustawfi/core-tenancy/shared";
import { cryptoRandom, systemClock, uuidV7Generator } from "@mustawfi/kernel";
import { installTenantLicense, UnknownStoreError } from "../tenants/install-license.ts";
import { licenseKeysFromEnv } from "./license-keys.ts";

const USAGE = `usage: DATABASE_URL=<mustawfi_app url> LICENSE_PUBLIC_KEYS=<kid:key,…> \
  pnpm --filter @mustawfi/server license:install --store <store code> --license <license JWS>`;

export interface CommandIo {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
}

/**
 * `license:install` (ADR-0030): installs a renewed or changed license for an existing store,
 * after verifying its signature, its tenant, its validity, and that it is newer than the
 * installed one. Prints the installed license's id and claims as JSON and returns the exit
 * code: 0 done, 1 refused, 2 bad usage.
 */
export async function installLicenseCommand(io: CommandIo): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...io.argv],
      options: { store: { type: "string" }, license: { type: "string" } },
      strict: true,
    }));
  } catch (error) {
    io.stderr.write(`${(error as Error).message}\n${USAGE}\n`);
    return 2;
  }
  const usage = (message: string) => {
    io.stderr.write(`${message}
${USAGE}
`);
    return 2;
  };
  const databaseUrl = io.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl === "") return usage("DATABASE_URL is not set");
  const licenseKeys = licenseKeysFromEnv(io.env);
  if (typeof licenseKeys === "string") return usage(licenseKeys);
  const { store, license } = values;
  if (store === undefined || license === undefined) {
    return usage("--store and --license are required");
  }

  const tenants = await openTenantDatabase({ connectionString: databaseUrl, maxConnections: 1 });
  try {
    const installed = await installTenantLicense(
      tenants,
      { storeCode: store, license },
      {
        clock: systemClock,
        newId: uuidV7Generator({ clock: systemClock, random: cryptoRandom }),
        licenseKeys,
      },
    );
    io.stdout.write(
      `${JSON.stringify({ id: installed.id, kid: installed.kid, ...installed.claims })}\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof LicenseRefusedError || error instanceof UnknownStoreError) {
      io.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  } finally {
    await tenants.close();
  }
}

if (import.meta.main) {
  process.exitCode = await installLicenseCommand({
    argv: process.argv.slice(2),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
