import { parseArgs } from "node:util";
import { issueResetCode, ResetCodeRefused } from "@mustawfi/core-access/server";
import { openTenantDatabase } from "@mustawfi/core-tenancy/server";
import { cryptoRandom, systemClock, uuidV7Generator } from "@mustawfi/kernel";
import type { CommandIo } from "./install-license.ts";

const USAGE = `usage: DATABASE_URL=<mustawfi_app url> \
  pnpm --filter @mustawfi/server access:reset-code --store <store code> --login <owner login> --staff <your name>`;

/**
 * `access:reset-code` (`core-foundation` rule 27, flow 3): Vertex support issues a one-time
 * code with which an owner sets a new password. Prints `{ code, expiresAt, userId }` as JSON
 * and returns the exit code: 0 done, 1 refused (unknown store or login, not an active owner),
 * 2 bad usage. The code works once, for thirty minutes, and the issue is audited as support.
 */
export async function resetCodeCommand(io: CommandIo): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...io.argv],
      options: {
        store: { type: "string" },
        login: { type: "string" },
        staff: { type: "string" },
      },
      strict: true,
    }));
  } catch (error) {
    io.stderr.write(`${(error as Error).message}\n${USAGE}\n`);
    return 2;
  }
  const usage = (message: string) => {
    io.stderr.write(`${message}\n${USAGE}\n`);
    return 2;
  };
  const databaseUrl = io.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl === "") return usage("DATABASE_URL is not set");
  const { store, login, staff } = values;
  if (store === undefined || login === undefined || staff === undefined) {
    return usage("--store, --login, and --staff are required");
  }

  const tenants = await openTenantDatabase({ connectionString: databaseUrl, maxConnections: 1 });
  try {
    const issued = await issueResetCode(
      tenants,
      { storeCode: store, login, staff },
      {
        clock: systemClock,
        newId: uuidV7Generator({ clock: systemClock, random: cryptoRandom }),
        random: cryptoRandom,
      },
    );
    io.stdout.write(
      `${JSON.stringify({
        code: issued.code,
        expiresAt: issued.expiresAt.toISOString(),
        userId: issued.userId,
      })}\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof ResetCodeRefused) {
      io.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  } finally {
    await tenants.close();
  }
}

if (import.meta.main) {
  process.exitCode = await resetCodeCommand({
    argv: process.argv.slice(2),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
