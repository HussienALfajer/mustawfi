/** The port the end-to-end API server listens on; `vite preview` proxies `/api` to it. */
export const E2E_API_PORT = 3199;

/** The store the global setup creates, handed to the tests through the environment. */
export interface E2eStore {
  readonly storeCode: string;
  readonly login: string;
  readonly password: string;
  /** The API server's database as `mustawfi_app`, for the server CLIs a journey runs. */
  readonly databaseUrl: string;
}

export const E2E_STORE_ENV = "MUSTAWFI_E2E_STORE";

export function e2eStore(): E2eStore {
  const value = process.env[E2E_STORE_ENV];
  if (value === undefined)
    throw new Error("run through `playwright test`: the global setup is missing");
  return JSON.parse(value) as E2eStore;
}
