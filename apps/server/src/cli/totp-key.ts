import { readFile, rename, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { parseTotpKeys, TotpKeysInvalid } from "@mustawfi/core-access/server";
import { cryptoRandom, type RandomSource } from "@mustawfi/kernel";
import type { CommandIo } from "./install-license.ts";

const USAGE = `usage: pnpm --filter @mustawfi/server access:totp-key --kid <key id> --out <key file> [--rotate]`;

/** 256 bits for AES-256-GCM (`sealSecret`). */
const KEY_BYTES = 32;

/**
 * `access:totp-key` (`core-foundation` slice 10): writes the key file the server's
 * `TOTP_KEYS_FILE` names, readable by its owner only. Without `--rotate` it creates a new file
 * and never overwrites one. With `--rotate` it puts a new key first in an existing file — the
 * key new secrets are sealed with — and keeps the others, which still open what they sealed;
 * the file is replaced in one rename, so the server never reads half of it. The key itself is
 * never printed. Returns the exit code: 0 done, 1 refused, 2 bad usage.
 */
export async function totpKeyCommand(
  io: CommandIo,
  random: RandomSource = cryptoRandom,
): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: [...io.argv],
      options: {
        kid: { type: "string" },
        out: { type: "string" },
        rotate: { type: "boolean", default: false },
      },
      strict: true,
    }));
  } catch (error) {
    io.stderr.write(`${(error as Error).message}\n${USAGE}\n`);
    return 2;
  }
  const { kid, out, rotate } = values;
  if (kid === undefined || out === undefined || out === "") {
    io.stderr.write(`--kid and --out are required\n${USAGE}\n`);
    return 2;
  }
  const line = `${kid}:${Buffer.from(random.bytes(KEY_BYTES)).toString("base64url")}`;
  try {
    parseTotpKeys(line);
  } catch (error) {
    if (!(error instanceof TotpKeysInvalid)) throw error;
    io.stderr.write(`the key id must be 1–32 of A–Z a–z 0–9 _ -\n${USAGE}\n`);
    return 2;
  }

  if (!rotate) {
    try {
      // `wx`: never overwrite a key file; losing a key loses every secret it sealed.
      await writeFile(out, `${line}\n`, { flag: "wx", mode: 0o600 });
    } catch (error) {
      io.stderr.write(`cannot write ${out}: ${(error as Error).message}\n`);
      return 1;
    }
    io.stderr.write(`wrote ${out} with the key ${kid}; set TOTP_KEYS_FILE to it\n`);
    return 0;
  }

  let existing: string;
  try {
    existing = await readFile(out, "utf8");
  } catch (error) {
    io.stderr.write(`cannot read ${out}: ${(error as Error).message}\n`);
    return 1;
  }
  let ring;
  try {
    ring = parseTotpKeys(existing);
  } catch (error) {
    if (!(error instanceof TotpKeysInvalid)) throw error;
    io.stderr.write(`${out} is not a valid key file: ${error.message}\n`);
    return 1;
  }
  if (ring.keys.has(kid)) {
    io.stderr.write(`${out} already has a key ${kid}: choose a new key id\n`);
    return 1;
  }
  const next = `${out}.new`;
  try {
    await writeFile(next, `${line}\n${existing.endsWith("\n") ? existing : `${existing}\n`}`, {
      flag: "wx",
      mode: 0o600,
    });
    await rename(next, out);
  } catch (error) {
    io.stderr.write(`cannot replace ${out}: ${(error as Error).message}\n`);
    return 1;
  }
  io.stderr.write(
    `${kid} now seals new secrets; ${[...ring.keys.keys()].join(", ")} still open theirs. Restart the server to use it.\n`,
  );
  return 0;
}

if (import.meta.main) {
  process.exitCode = await totpKeyCommand({
    argv: process.argv.slice(2),
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
