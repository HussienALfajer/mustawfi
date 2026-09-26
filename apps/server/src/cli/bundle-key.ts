import { writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { signingKeyIdSchema } from "@mustawfi/core-config/shared";
import { exportJWK, generateKeyPair } from "jose";
import type { CommandIo } from "./install-license.ts";

const USAGE = `usage: pnpm --filter @mustawfi/server bundle:keygen --kid <key id> --out <key file>`;

/**
 * `bundle:keygen` (`core-foundation` slice 11): writes a new Ed25519 bundle key (a private JWK
 * with its key id) to a new file readable by its owner only — the file the server's
 * `BUNDLE_KEY_FILE` names — and prints the public entry, `kid:x`, that the apps are built with
 * (`VITE_BUNDLE_PUBLIC_KEYS`, ADR-0021). It never overwrites a file and never prints the private
 * key. Returns the exit code: 0 done, 1 refused, 2 bad usage.
 */
export async function bundleKeyCommand(io: CommandIo): Promise<number> {
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
  const kid = signingKeyIdSchema.safeParse(values.kid);
  if (!kid.success || values.out === undefined || values.out === "") {
    io.stderr.write(
      `a key id (letters, digits, dots, dashes) and an output file are required\n${USAGE}\n`,
    );
    return 2;
  }
  const { privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  const jwk = { ...(await exportJWK(privateKey)), kid: kid.data };
  try {
    // `wx`: never overwrite a key; the apps built with its public key would trust nothing else.
    await writeFile(values.out, `${JSON.stringify(jwk)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    io.stderr.write(`cannot write ${values.out}: ${(error as Error).message}\n`);
    return 1;
  }
  io.stdout.write(`${kid.data}:${String(jwk.x)}\n`);
  io.stderr.write(
    `wrote ${values.out}; set BUNDLE_KEY_FILE to it and build the apps with the printed entry in VITE_BUNDLE_PUBLIC_KEYS\n`,
  );
  return 0;
}

if (import.meta.main) {
  process.exitCode = await bundleKeyCommand({
    argv: process.argv.slice(2),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
