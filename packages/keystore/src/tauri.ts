import { invoke } from "@tauri-apps/api/core";
import type { SecretName, SecureStore } from "./index.ts";

/** One request of the `secure_store` command (`packages/keystore/native`, `Request`). */
export type SecureStoreRequest =
  | { readonly kind: "get"; readonly name: SecretName }
  | { readonly kind: "set"; readonly name: SecretName; readonly value: string }
  | { readonly kind: "delete"; readonly name: SecretName };

export type SecureStoreInvoke = (request: SecureStoreRequest) => Promise<string | null>;

/** A `SecureStore` over the `secure_store` protocol. */
export function secureStoreOver(send: SecureStoreInvoke): SecureStore {
  return {
    get: async (name) => (await send({ kind: "get", name })) ?? undefined,
    set: async (name, value) => {
      await send({ kind: "set", name, value });
    },
    delete: async (name) => {
      await send({ kind: "delete", name });
    },
  };
}

/** The Windows shell's `secure_store` command (`apps/desktop/src-tauri`): Credential Manager. */
export const tauriSecureStore: SecureStore = secureStoreOver((request) =>
  invoke<string | null>("secure_store", { request }),
);
