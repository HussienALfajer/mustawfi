/**
 * drizzle-kit config for the fixture; paths are relative to the repository root, so run
 * `tools/drizzle/node_modules/.bin/drizzle-kit generate --config <this file>` from there.
 */
export default {
  dialect: "postgresql",
  casing: "snake_case",
  schema: "./apps/server/src/db/test-fixtures/rls-fixture/schema.ts",
  out: "./apps/server/src/db/test-fixtures/rls-fixture/migrations",
};
