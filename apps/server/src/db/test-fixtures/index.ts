import { fileURLToPath } from "node:url";
import type { MigrationSet } from "../migrate.ts";

/** A tenant-owned table with forced RLS and the standard policy, for the isolation tests. */
export const rlsFixtureMigrations: MigrationSet = {
  moduleId: "test.rls-fixture",
  dir: fileURLToPath(new URL("./rls-fixture/migrations", import.meta.url)),
};
