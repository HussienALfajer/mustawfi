import { hash, verify, type Algorithm } from "@node-rs/argon2";
import { passwordSchema } from "../shared/index.ts";

/** `Algorithm.Argon2id`; the enum is `const`, which `verbatimModuleSyntax` cannot read. */
const ARGON2ID: Algorithm.Argon2id = 2;

/**
 * Hashes a password with Argon2id (ADR-0022) at the library's defaults — 19 MiB, two passes,
 * one lane, OWASP's minimum profile — and a random salt. Returns the PHC string.
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(passwordSchema.parse(password), { algorithm: ARGON2ID });
}

/** Whether `password` matches the PHC string `passwordHash`; a malformed hash never matches. */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let timingHash: Promise<string> | undefined;

/**
 * Spends the time of one real verification when there is no user to check, so the answer
 * takes as long for an unknown store or login as for a wrong password.
 */
export async function verifyNothing(password: string): Promise<void> {
  timingHash ??= hashPassword("a password no account has, for equal timing").catch(
    (error: unknown) => {
      timingHash = undefined;
      throw error;
    },
  );
  await verifyPassword(await timingHash, password);
}
