import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    globalSetup: ["@mustawfi/testing/postgres-global-setup"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
