/**
 * drizzle-kit config for `core_ledger`; paths are relative to the repository root, so run
 * `tools/drizzle/node_modules/.bin/drizzle-kit generate --config core/ledger/drizzle.config.ts`
 * from there.
 */
export default {
  dialect: "postgresql",
  casing: "snake_case",
  schema: "./core/ledger/src/server/schema.ts",
  out: "./core/ledger/migrations",
};
