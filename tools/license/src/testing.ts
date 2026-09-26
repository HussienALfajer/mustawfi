import type { LicenseClaims, LicensePublicKeys } from "@mustawfi/core-tenancy/shared";
import { cryptoRandom, systemClock, uuidV7Generator } from "@mustawfi/kernel";
import {
  generateLicenseKeyPair,
  issueLicense,
  type LicenseKeyPair,
  licenseClaimsFor,
  licensePrivateKeySchema,
  type LicenseTermsInput,
} from "./license.ts";

/**
 * The test license key (`core-foundation` rule 1): generated once per test process, never
 * written to disk, and never in a production key list — a server trusts it only when a test
 * passes `testLicenseKeys()` (or `testLicensePublicKeys()` to a CLI) as its configuration.
 */
export const TEST_LICENSE_KID = "test";

/**
 * Where a test run that spans processes hands its test key down: the end-to-end run builds the
 * web app with the public key before its global setup issues the store's license, so the
 * Playwright config makes the key and every process of the run reads it from here.
 */
export const TEST_LICENSE_KEY_ENV = "MUSTAWFI_TEST_LICENSE_KEY";

let testPair: Promise<LicenseKeyPair> | undefined;

/** The test key pair of this process (or of the run, from `TEST_LICENSE_KEY_ENV`). */
export function testLicenseKeyPair(): Promise<LicenseKeyPair> {
  const handed = process.env[TEST_LICENSE_KEY_ENV];
  testPair ??=
    handed === undefined
      ? generateLicenseKeyPair(TEST_LICENSE_KID)
      : Promise.resolve(keyPairOf(handed));
  return testPair;
}

function keyPairOf(json: string): LicenseKeyPair {
  const privateKey = licensePrivateKeySchema.parse(JSON.parse(json));
  return { privateKey, publicKey: `${privateKey.kid}:${privateKey.x}` };
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
