import type { BundlePartDecoder } from "@mustawfi/core-config/client";
import {
  ORGANIZATION_BUNDLE_PART,
  type OrganizationPart,
  organizationPartSchema,
} from "../shared/index.ts";

/**
 * The device's reading of the bundle's `organization` part: well-formed, with exactly one
 * default department (rule 28), which documents fall back to (rule 32).
 */
export const organizationBundlePart: BundlePartDecoder<OrganizationPart> = {
  name: ORGANIZATION_BUNDLE_PART,
  decode(value) {
    const part = organizationPartSchema.parse(value);
    if (part.departments.filter((department) => department.isDefault).length !== 1) {
      throw new Error("the part does not have exactly one default department");
    }
    return part;
  },
};
