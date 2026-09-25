/**
 * drizzle-kit config for `core_sync`; paths are relative to the repository root, so run
 * `tools/drizzle/node_modules/.bin/drizzle-kit generate --config core/sync/drizzle.config.ts`
 * from there.
 */
export default {
  dialect: "postgresql",
  casing: "snake_case",
  schema: "./core/sync/src/server/schema.ts",
  out: "./core/sync/migrations",
};
