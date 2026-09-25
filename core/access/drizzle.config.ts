/**
 * drizzle-kit config for `core_access`; paths are relative to the repository root, so run
 * `tools/drizzle/node_modules/.bin/drizzle-kit generate --config core/access/drizzle.config.ts`
 * from there.
 */
export default {
  dialect: "postgresql",
  casing: "snake_case",
  schema: "./core/access/src/server/schema.ts",
  out: "./core/access/migrations",
};
