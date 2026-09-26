/**
 * The secrets a native shell keeps in the OS secure store (ADR-0022) rather than in the local
 * database file: the device credential, and the bearer token of the session held on the device.
 */
export type SecretName = "deviceCredential" | "sessionToken";

/**
 * The OS secure store of a native shell: Windows Credential Manager in the Windows app
 * (`./tauri`). The browser has none; it keeps its session in an `HttpOnly` cookie.
 */
export interface SecureStore {
  /** The secret, or `undefined` when the store holds none by that name. */
  get(name: SecretName): Promise<string | undefined>;
  /** Creates or replaces the secret. */
  set(name: SecretName, value: string): Promise<void>;
  /** Removes the secret; removing one that is not there is not an error. */
  delete(name: SecretName): Promise<void>;
}

/** A store in memory, standing in for the OS one in tests. `secrets` shows what it holds. */
export function memorySecureStore(): SecureStore & { readonly secrets: Map<SecretName, string> } {
  const secrets = new Map<SecretName, string>();
  return {
    secrets,
    get: (name) => Promise.resolve(secrets.get(name)),
    set: (name, value) => {
      secrets.set(name, value);
      return Promise.resolve();
    },
    delete: (name) => {
      secrets.delete(name);
      return Promise.resolve();
    },
  };
}
