/**
 * drizzle-kit config for `inventory`; paths are relative to the repository root, so run
 * `tools/drizzle/node_modules/.bin/drizzle-kit generate --config modules/inventory/drizzle.config.ts`
 * from there.
 */
export default {
  dialect: "postgresql",
  casing: "snake_case",
  schema: "./modules/inventory/src/server/schema.ts",
  out: "./modules/inventory/migrations",
};
