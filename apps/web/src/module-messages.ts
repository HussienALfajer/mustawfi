import { ACCESS_NAMESPACE, accessMessages } from "@mustawfi/core-access/client";
import { AUDIT_NAMESPACE, auditMessages } from "@mustawfi/core-audit/client";
import { LEDGER_NAMESPACE, ledgerMessages } from "@mustawfi/core-ledger/client";
import { ORGANIZATION_NAMESPACE, organizationMessages } from "@mustawfi/core-organization/client";
import { SYNC_NAMESPACE, syncMessages } from "@mustawfi/core-sync/client";
import { TENANCY_NAMESPACE, tenancyMessages } from "@mustawfi/core-tenancy/client";
import type { Messages } from "@mustawfi/i18n";
import { INVENTORY_NAMESPACE, inventoryMessages } from "@mustawfi/inventory/client";
import { SALES_NAMESPACE, salesMessages } from "@mustawfi/sales/client";

/**
 * The i18n namespace of each module this client composes (ADR-0023: one per module, named after
 * the module's id without `core.`), where its screens' text and the labels of its permissions,
 * limits, and audit actions live.
 */
export const MODULE_MESSAGES: Readonly<Record<string, Messages>> = {
  [ACCESS_NAMESPACE]: accessMessages,
  [TENANCY_NAMESPACE]: tenancyMessages,
  [AUDIT_NAMESPACE]: auditMessages,
  [LEDGER_NAMESPACE]: ledgerMessages,
  [ORGANIZATION_NAMESPACE]: organizationMessages,
  [INVENTORY_NAMESPACE]: inventoryMessages,
  [SYNC_NAMESPACE]: syncMessages,
  [SALES_NAMESPACE]: salesMessages,
};

/** The message at `key` (dotted) in namespace `ns`, if there is one. */
export function moduleMessage(ns: string, key: string): unknown {
  let node: unknown = MODULE_MESSAGES[ns];
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}
