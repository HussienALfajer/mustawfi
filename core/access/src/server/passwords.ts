import { hash, type Algorithm } from "@node-rs/argon2";
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
