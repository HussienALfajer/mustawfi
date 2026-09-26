import { argon2Verify } from "hash-wasm";
import type { PinCheck } from "./local-sign-in.ts";

/**
 * Checks a PIN against the bundle's Argon2id verifier on the device (ADR-0022), with `hash-wasm`
 * (WebAssembly, the same code in the browser and the Windows app's WebView2). The verifier is the
 * server's PHC string, so its parameters travel with it: the server's defaults (19 MiB, two
 * passes, one lane) take about 35–80 ms on the development machine (`core-foundation` slice 15
 * notes). A malformed verifier never matches.
 */
export const checkPinWithArgon2: PinCheck = async (verifier, pin) => {
  try {
    return await argon2Verify({ password: pin, hash: verifier });
  } catch {
    return false;
  }
};
