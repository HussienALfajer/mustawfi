import { generateKeyPairSync } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { E2E_API_PORT, E2E_BUNDLE_KEY_ENV, E2E_LICENSE_KEY_ENV } from "./e2e/environment.ts";

const WEB_PORT = 4173;

/**
 * The run's signing keys, made once in the runner's process and handed to its workers, the web
 * build, and the global setup through the environment: the app is built with the public keys
 * (ADR-0021) before the global setup starts the server with the bundle key and issues the
 * store's license, so neither can be made there. Never written to the repository.
 */
function runKey(env: string, kid: string): { readonly kid: string; readonly x: string } {
  process.env[env] ??= JSON.stringify({
    ...generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" }),
    kid,
  });
  return JSON.parse(process.env[env]) as { kid: string; x: string };
}

const bundleKey = runKey(E2E_BUNDLE_KEY_ENV, "e2e-bundle");
const licenseKey = runKey(E2E_LICENSE_KEY_ENV, "test");
const vite = "node node_modules/vite/bin/vite.js";

/**
 * End-to-end journeys (ADR-0026): the web app built with the run's public keys, on `vite preview`, proxying `/api` to a
 * real server on a real PostgreSQL 18 that `e2e/global-setup.ts` starts. `*.e2e.ts` keeps
 * these files out of Vitest.
 */
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  workers: 1,
  forbidOnly: process.env["CI"] !== undefined,
  retries: 0,
  timeout: 30_000,
  reporter: "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${String(WEB_PORT)}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Vite itself, not through pnpm: pnpm starts it outside the process group Playwright stops
    // at the end, and the orphan kept the run waiting forever on Linux (CI). It builds first,
    // with the run's public keys.
    command: `${vite} build && ${vite} preview --port ${String(WEB_PORT)} --strictPort`,
    url: `http://localhost:${String(WEB_PORT)}`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      MUSTAWFI_API_URL: `http://127.0.0.1:${String(E2E_API_PORT)}`,
      VITE_BUNDLE_PUBLIC_KEYS: `${bundleKey.kid}:${bundleKey.x}`,
      VITE_LICENSE_PUBLIC_KEYS: `${licenseKey.kid}:${licenseKey.x}`,
    },
  },
});
