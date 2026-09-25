/**
 * drizzle-kit config for `core_organization`; paths are relative to the repository root, so run
 * `tools/drizzle/node_modules/.bin/drizzle-kit generate --config core/organization/drizzle.config.ts`
 * from there.
 */
export default {
  dialect: "postgresql",
  casing: "snake_case",
  schema: "./core/organization/src/server/schema.ts",
  out: "./core/organization/migrations",
};
