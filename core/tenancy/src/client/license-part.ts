import type { BundlePartDecoder } from "@mustawfi/core-config/client";
import { z } from "zod";
import {
  LICENSE_BUNDLE_PART,
  type LicensePublicKeys,
  type VerifiedLicense,
  verifyLicense,
} from "../shared/index.ts";

/**
 * The device's reading of the bundle's `license` part: the license JWS, verified with the
 * license public keys the app ships with — not only through the bundle's signature, so a leaked
 * bundle key cannot forge a license (ADR-0021) — and issued for this device's tenant.
 */
export function licenseBundlePart(keys: LicensePublicKeys): BundlePartDecoder<VerifiedLicense> {
  return {
    name: LICENSE_BUNDLE_PART,
    async decode(value, device) {
      const license = await verifyLicense(z.string().parse(value), keys);
      if (license.claims.tenant !== device.tenantId) {
        throw new Error("the license names another tenant");
      }
      return license;
    },
  };
}
