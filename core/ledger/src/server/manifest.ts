import { fileURLToPath } from "node:url";
import { defineModule } from "@mustawfi/core-config/server";

/**
 * `core.ledger`: the tenant's one double-entry ledger (ADR-0006) — the chart of accounts and
 * posted journal entries. Other modules post through `postJournalEntry`; the accountant's
 * screens and routes come later.
 */
export const ledgerModule = defineModule({
  id: "core.ledger",
  dependsOn: ["core.config", "core.tenancy"],
  migrations: fileURLToPath(new URL("../../migrations", import.meta.url)),
});
