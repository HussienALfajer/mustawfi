import type { BundlePart } from "@mustawfi/core-config/server";
import { listDepartments, type TenantTransaction } from "@mustawfi/core-tenancy/server";
import { ORGANIZATION_BUNDLE_PART, type OrganizationPart } from "../shared/index.ts";
import { storeProfile } from "./store-profile.ts";

/** The bundle's `organization` part (ADR-0030): departments and the store profile. */
export const organizationBundlePart: BundlePart<TenantTransaction> = {
  name: ORGANIZATION_BUNDLE_PART,
  async build(tx): Promise<OrganizationPart> {
    return { departments: await listDepartments(tx), profile: await storeProfile(tx) };
  },
};
