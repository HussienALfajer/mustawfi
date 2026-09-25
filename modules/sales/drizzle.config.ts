/**
 * drizzle-kit config for `sales`; paths are relative to the repository root, so run
 * `tools/drizzle/node_modules/.bin/drizzle-kit generate --config modules/sales/drizzle.config.ts`
 * from there.
 */
export default {
  dialect: "postgresql",
  casing: "snake_case",
  schema: "./modules/sales/src/server/schema.ts",
  out: "./modules/sales/migrations",
};
