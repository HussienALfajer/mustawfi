import { generateKeyPairSync } from "node:crypto";
import { type BundleSigningKey, parseBundleSigningKey } from "@mustawfi/core-config/server";

const { privateKey } = generateKeyPairSync("ed25519");

/** A bundle key made once per test process and never written to disk. */
export const testBundleKey: BundleSigningKey = await parseBundleSigningKey(
  JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: "test-bundle" }),
);
