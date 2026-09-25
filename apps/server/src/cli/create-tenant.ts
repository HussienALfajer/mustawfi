import { parseArgs } from "node:util";
import { openTenantDatabase } from "@mustawfi/core-tenancy/server";
import { cryptoRandom, systemClock, uuidV7Generator } from "@mustawfi/kernel";
import { z } from "zod";
import { createTenantInputSchema, createTenantWithOwner } from "../tenants/create-tenant.ts";

const USAGE = `usage: DATABASE_URL=<mustawfi_app url> pnpm --filter @mustawfi/server tenant:create \\
  --name <tenant name> --base-currency <ISO 4217 code> \\
  --owner-name <name> --owner-login <login>  < password-on-stdin`;

export interface CommandIo {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The owner's password, piped in so it stays out of the shell history and process list. */
  readonly stdin: AsyncIterable<string | Uint8Array>;
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
}

async function readPassword(stdin: CommandIo["stdin"]): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stdin) {
    text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
  }
  return (text + decoder.decode()).replace(/\r?\n$/, "");
}

/**
 * `tenant:create`: creates a tenant with its hidden default branch, base currency, and owner.
 * Prints the new ids as JSON and returns the exit code: 0 done, 1 refused, 2 bad usage.
 */
export async function createTenantCommand(io: CommandIo): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...io.argv],
      options: {
        name: { type: "string" },
        "base-currency": { type: "string" },
        "owner-name": { type: "string" },
        "owner-login": { type: "string" },
      },
      strict: true,
    }));
  } catch (error) {
    io.stderr.write(`${(error as Error).message}\n${USAGE}\n`);
    return 2;
  }
  const databaseUrl = io.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl === "") {
    io.stderr.write(`DATABASE_URL is not set\n${USAGE}\n`);
    return 2;
  }

  const input = createTenantInputSchema.safeParse({
    name: values.name,
    baseCurrency: values["base-currency"],
    ownerName: values["owner-name"],
    ownerLogin: values["owner-login"],
    ownerPassword: await readPassword(io.stdin),
  });
  if (!input.success) {
    io.stderr.write(`${z.prettifyError(input.error)}\n${USAGE}\n`);
    return 1;
  }

  const tenants = await openTenantDatabase({ connectionString: databaseUrl, maxConnections: 1 });
  try {
    const created = await createTenantWithOwner(tenants, input.data, {
      clock: systemClock,
      newId: uuidV7Generator({ clock: systemClock, random: cryptoRandom }),
    });
    io.stdout.write(`${JSON.stringify(created)}\n`);
    return 0;
  } finally {
    await tenants.close();
  }
}

if (import.meta.main && process.stdin.isTTY) {
  // A typed password would be echoed; pipe it in instead.
  process.stderr.write(`the owner's password must be piped in on stdin\n${USAGE}\n`);
  process.exitCode = 2;
} else if (import.meta.main) {
  process.exitCode = await createTenantCommand({
    argv: process.argv.slice(2),
    env: process.env,
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
