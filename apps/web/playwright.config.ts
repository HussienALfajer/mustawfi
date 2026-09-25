import { defineConfig, devices } from "@playwright/test";
import { E2E_API_PORT } from "./e2e/environment.ts";

const WEB_PORT = 4173;

/**
 * End-to-end journeys (ADR-0026): the built web app on `vite preview`, proxying `/api` to a
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
    command: `pnpm exec vite build && pnpm exec vite preview --port ${String(WEB_PORT)} --strictPort`,
    url: `http://localhost:${String(WEB_PORT)}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { MUSTAWFI_API_URL: `http://127.0.0.1:${String(E2E_API_PORT)}` },
  },
});
