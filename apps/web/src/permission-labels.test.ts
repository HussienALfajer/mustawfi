import {
  accessMessages,
  limitLabelKey,
  moduleNamespace,
  permissionLabelKey,
} from "@mustawfi/core-access/client";
import { accessModule } from "@mustawfi/core-access/server";
import { auditMessages } from "@mustawfi/core-audit/client";
import { auditModule } from "@mustawfi/core-audit/server";
import { configModule } from "@mustawfi/core-config/server";
import { organizationMessages } from "@mustawfi/core-organization/client";
import { organizationModule } from "@mustawfi/core-organization/server";
import { syncModule } from "@mustawfi/core-sync/server";
import { tenancyMessages } from "@mustawfi/core-tenancy/client";
import { tenancyModule } from "@mustawfi/core-tenancy/server";
import { inventoryMessages } from "@mustawfi/inventory/client";
import { inventoryModule } from "@mustawfi/inventory/server";
import { salesMessages } from "@mustawfi/sales/client";
import { salesModule } from "@mustawfi/sales/server";
import { describe, expect, it } from "vitest";

/**
 * The modules this client composes, with their i18n namespaces. A module that declares a
 * permission or limit and is missing here fails the test below, because its namespace has no
 * messages.
 */
const MODULES = [
  configModule,
  tenancyModule,
  auditModule,
  accessModule,
  syncModule,
  organizationModule,
  inventoryModule,
  salesModule,
];

const NAMESPACES: Readonly<Record<string, unknown>> = {
  access: accessMessages,
  audit: auditMessages,
  organization: organizationMessages,
  tenancy: tenancyMessages,
  inventory: inventoryMessages,
  sales: salesMessages,
};

function lookup(ns: string, key: string): unknown {
  let node: unknown = NAMESPACES[ns];
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

describe("permission labels", () => {
  it("give every declared permission and limit an Arabic label in its module's namespace", () => {
    const missing: string[] = [];
    for (const module of MODULES) {
      const declared = [
        ...(module.permissions ?? []).map((p) => permissionLabelKey(p.id)),
        ...(module.limits ?? []).map((l) => limitLabelKey(l.id)),
      ];
      if (declared.length === 0) continue;
      const ns = moduleNamespace(module.id);
      if (typeof lookup(ns, "moduleName") !== "string") missing.push(`${ns}:moduleName`);
      for (const label of declared) {
        expect(label.ns, `${label.key} is declared by ${module.id}`).toBe(ns);
        const text = lookup(label.ns, label.key);
        if (typeof text !== "string" || !/[؀-ۿ]/.test(text)) {
          missing.push(`${label.ns}:${label.key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("map an id to its module's namespace and key", () => {
    expect(permissionLabelKey("access.users.view")).toEqual({
      ns: "access",
      key: "permission.users.view",
    });
    expect(permissionLabelKey("audit.view")).toEqual({ ns: "audit", key: "permission.view" });
    expect(limitLabelKey("sales.discount.maxPercent")).toEqual({
      ns: "sales",
      key: "limit.discount.maxPercent",
    });
    expect(moduleNamespace("core.organization")).toBe("organization");
    expect(moduleNamespace("sales")).toBe("sales");
  });
});
