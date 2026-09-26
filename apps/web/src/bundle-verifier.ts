import { accessBundlePart } from "@mustawfi/core-access/client";
import type { BundleVerifier } from "@mustawfi/core-config/client";
import { type PublicKeyRing, publicKeyRingSchema } from "@mustawfi/core-config/shared";
import { organizationBundlePart } from "@mustawfi/core-organization/client";
import { licenseBundlePart } from "@mustawfi/core-tenancy/client";
import { licensePublicKeysSchema } from "@mustawfi/core-tenancy/shared";

/**
 * The public keys this build trusts, set at build time (ADR-0021): the bundle keys that sign
 * configuration bundles and the license keys that sign licenses, each the current key and the
 * next. They ship inside the app — never fetched, never read from the local database — so a
 * device's own data cannot make it trust another key. A build without them trusts nothing: every
 * bundle is refused and, from slice 13, the device stays read-only.
 */
function keysOf(
  name: string,
  value: string | undefined,
  schema: typeof licensePublicKeysSchema,
): PublicKeyRing {
  const parsed = schema.safeParse(value ?? "");
  if (parsed.success) return parsed.data;
  console.error(`${name} is missing or malformed: this build trusts no such key`);
  return {};
}

let verifier: BundleVerifier | undefined;

/** How this app checks configuration bundles: the build's keys and every module's part. */
export function bundleVerifier(): BundleVerifier {
  verifier ??= {
    keys: keysOf(
      "VITE_BUNDLE_PUBLIC_KEYS",
      import.meta.env.VITE_BUNDLE_PUBLIC_KEYS,
      publicKeyRingSchema("bundle"),
    ),
    decoders: [
      licenseBundlePart(
        keysOf(
          "VITE_LICENSE_PUBLIC_KEYS",
          import.meta.env.VITE_LICENSE_PUBLIC_KEYS,
          licensePublicKeysSchema,
        ),
      ),
      accessBundlePart,
      organizationBundlePart,
    ],
  };
  return verifier;
}
