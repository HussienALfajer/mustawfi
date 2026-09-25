import type { TenantDatabase } from "@mustawfi/core-tenancy/server";
import type { Clock, IdGenerator, RandomSource } from "@mustawfi/kernel";
import type { LicenseTermsInput } from "@mustawfi/tools-license";
import { issueTestLicense, testLicenseKeys } from "@mustawfi/tools-license/testing";
import {
  type CreatedTenant,
  type CreateTenantInput,
  createTenantWithOwner,
} from "./create-tenant.ts";

/**
 * `createTenantWithOwner` with a license signed by the test key and issued at the test's clock
 * (`core-foundation` slice 1: test setups create tenants with test-key licenses).
 */
export async function createLicensedTenant(
  tenants: TenantDatabase,
  input: Omit<CreateTenantInput, "license">,
  dependencies: {
    readonly clock: Clock;
    readonly newId: IdGenerator;
    readonly random: RandomSource;
  },
  terms: Partial<LicenseTermsInput> = {},
): Promise<CreatedTenant> {
  const { jws } = await issueTestLicense({ issuedAt: dependencies.clock.now(), ...terms });
  return createTenantWithOwner(
    tenants,
    { ...input, license: jws },
    { ...dependencies, licenseKeys: await testLicenseKeys() },
  );
}
