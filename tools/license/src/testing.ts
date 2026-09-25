import type { LicenseClaims, LicensePublicKeys } from "@mustawfi/core-tenancy/shared";
import { cryptoRandom, systemClock, uuidV7Generator } from "@mustawfi/kernel";
import {
  generateLicenseKeyPair,
  issueLicense,
  type LicenseKeyPair,
  licenseClaimsFor,
  type LicenseTermsInput,
} from "./license.ts";

/**
 * The test license key (`core-foundation` rule 1): generated once per test process, never
 * written to disk, and never in a production key list — a server trusts it only when a test
 * passes `testLicenseKeys()` (or `testLicensePublicKeys()` to a CLI) as its configuration.
 */
export const TEST_LICENSE_KID = "test";

let testPair: Promise<LicenseKeyPair> | undefined;

/** The test key pair of this process. */
export function testLicenseKeyPair(): Promise<LicenseKeyPair> {
  testPair ??= generateLicenseKeyPair(TEST_LICENSE_KID);
  return testPair;
}

/** The public key set that trusts the test key, as a server's configuration would hold it. */
export async function testLicenseKeys(): Promise<LicensePublicKeys> {
  const { privateKey } = await testLicenseKeyPair();
  return { [privateKey.kid]: privateKey.x };
}

/** `LICENSE_PUBLIC_KEYS` for a CLI or server process that must trust the test key. */
export async function testLicensePublicKeys(): Promise<string> {
  return (await testLicenseKeyPair()).publicKey;
}

const newTenantId = uuidV7Generator({ clock: systemClock, random: cryptoRandom });

export interface TestLicense {
  readonly jws: string;
  readonly claims: LicenseClaims;
}

/**
 * A license signed with the test key: plan `phonesPro` for a new tenant id, issued now, unless
 * the options say otherwise.
 */
export async function issueTestLicense(
  options: Partial<LicenseTermsInput> = {},
): Promise<TestLicense> {
  const claims = licenseClaimsFor({
    tenant: newTenantId(),
    plan: "phonesPro",
    issuedAt: systemClock.now(),
    ...options,
  });
  const { privateKey } = await testLicenseKeyPair();
  return { jws: await issueLicense(claims, privateKey), claims };
}
