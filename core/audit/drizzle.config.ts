/**
 * drizzle-kit config for `core_audit`; paths are relative to the repository root, so run
 * `tools/drizzle/node_modules/.bin/drizzle-kit generate --config core/audit/drizzle.config.ts`
 * from there.
 */
export default {
  dialect: "postgresql",
  casing: "snake_case",
  schema: "./core/audit/src/server/schema.ts",
  out: "./core/audit/migrations",
};
