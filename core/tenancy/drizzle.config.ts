/**
 * drizzle-kit config for `core_tenancy`; paths are relative to the repository root, so run
 * `tools/drizzle/node_modules/.bin/drizzle-kit generate --config core/tenancy/drizzle.config.ts`
 * from there.
 */
export default {
  dialect: "postgresql",
  casing: "snake_case",
  schema: "./core/tenancy/src/server/schema.ts",
  out: "./core/tenancy/migrations",
};
