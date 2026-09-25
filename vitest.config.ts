import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["apps/*", "core/*", "modules/*", "packages/*", "tools/*"],
  },
});
