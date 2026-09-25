import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { licenseKeyIdSchema } from "@mustawfi/core-tenancy/shared";
import { generateLicenseKeyPair } from "../license.ts";
import { type CommandIo, processIo } from "./io.ts";

const USAGE = `usage: pnpm --filter @mustawfi/tools-license license:keygen --kid <key id> --out <private key file>`;

/**
 * `license:keygen`: writes a new Ed25519 license private key (JWK) to a new file readable by its
 * owner only, and prints the public key entry for the tenant server's `LICENSE_PUBLIC_KEYS`.
 * Returns the exit code: 0 done, 1 refused, 2 bad usage.
 */
export async function keygenCommand(io: CommandIo): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...io.argv],
      options: { kid: { type: "string" }, out: { type: "string" } },
      strict: true,
    }));
  } catch (error) {
    io.stderr.write(`${(error as Error).message}\n${USAGE}\n`);
    return 2;
  }
  const kid = licenseKeyIdSchema.safeParse(values.kid);
  if (!kid.success || values.out === undefined || values.out === "") {
    io.stderr.write(
      `a key id (letters, digits, dots, dashes) and an output file are required\n${USAGE}\n`,
    );
    return 2;
  }

  const pair = await generateLicenseKeyPair(kid.data);
  try {
    // `wx`: never overwrite an existing key.
    await writeFile(values.out, `${JSON.stringify(pair.privateKey)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    io.stderr.write(`cannot write ${values.out}: ${(error as Error).message}\n`);
    return 1;
  }
  io.stdout.write(`${pair.publicKey}\n`);
  return 0;
}

if (import.meta.main) process.exitCode = await keygenCommand(processIo());
