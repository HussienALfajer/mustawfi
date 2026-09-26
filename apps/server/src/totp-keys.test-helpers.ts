import { randomBytes } from "node:crypto";
import { parseTotpKeys, type TotpKeyRing } from "@mustawfi/core-access/server";

/** A TOTP key ring made once per test process and never written to disk. */
export const testTotpKeys: TotpKeyRing = parseTotpKeys(
  `test:${randomBytes(32).toString("base64url")}`,
);
