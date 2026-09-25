import { type LicensePublicKeys, licensePublicKeysSchema } from "@mustawfi/core-tenancy/shared";
import { z } from "zod";

/**
 * The public license keys a CLI trusts, from `LICENSE_PUBLIC_KEYS` (`kid:x` pairs separated by
 * commas, as `license:keygen` prints them). There is no built-in default (`core-foundation`
 * rule 1): without the variable, nothing is installed. Returns an error message when missing
 * or malformed.
 */
export function licenseKeysFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): LicensePublicKeys | string {
  const value = env["LICENSE_PUBLIC_KEYS"];
  if (value === undefined || value.trim() === "") return "LICENSE_PUBLIC_KEYS is not set";
  const parsed = licensePublicKeysSchema.safeParse(value);
  return parsed.success ? parsed.data : `LICENSE_PUBLIC_KEYS: ${z.prettifyError(parsed.error)}`;
}
