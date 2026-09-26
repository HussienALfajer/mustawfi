import { limitLabelKey, moduleNamespace, permissionLabelKey } from "@mustawfi/core-access/client";
import { accessModule } from "@mustawfi/core-access/server";
import { auditModule } from "@mustawfi/core-audit/server";
import { configModule } from "@mustawfi/core-config/server";
import { organizationModule } from "@mustawfi/core-organization/server";
import { syncModule } from "@mustawfi/core-sync/server";
import { tenancyModule } from "@mustawfi/core-tenancy/server";
import { inventoryModule } from "@mustawfi/inventory/server";
import { salesModule } from "@mustawfi/sales/server";
import { describe, expect, it } from "vitest";
import { moduleMessage } from "./module-messages.ts";

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
      if (typeof moduleMessage(ns, "moduleName") !== "string") missing.push(`${ns}:moduleName`);
      for (const label of declared) {
        expect(label.ns, `${label.key} is declared by ${module.id}`).toBe(ns);
        const text = moduleMessage(label.ns, label.key);
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
