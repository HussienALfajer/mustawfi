import { accessModule } from "@mustawfi/core-access/server";
import { auditModule } from "@mustawfi/core-audit/server";
import { currencyModule } from "@mustawfi/core-currency/server";
import { organizationModule } from "@mustawfi/core-organization/server";
import { inventoryModule } from "@mustawfi/inventory/server";
import { salesModule } from "@mustawfi/sales/server";
import { describe, expect, it } from "vitest";
import { shellMessages } from "./messages.ts";
import { mayOpen, type NavPath, SCREENS, startScreen } from "./screens.ts";

const DECLARED = new Set(
  [
    accessModule,
    auditModule,
    currencyModule,
    organizationModule,
    inventoryModule,
    salesModule,
  ].flatMap((module) => (module.permissions ?? []).map((permission) => permission.id)),
);

/** What the templates' roles hold (`core-foundation` *Permissions*). */
const SECTION_CASHIER = new Set(["inventory.products.view", "sales.invoice.create"]);
const ACCOUNTANT = new Set([
  "access.users.view",
  "access.users.unlock",
  "audit.view",
  "currency.rate.set",
  "inventory.products.view",
  "inventory.products.manage",
  "sales.invoices.view",
]);

describe("the navigation's screens", () => {
  it("each need a permission a module declares, or none, and have a title", () => {
    for (const [path, screen] of Object.entries(SCREENS)) {
      if (screen.permission !== null) {
        expect(DECLARED, `${path} needs ${screen.permission}`).toContain(screen.permission);
      }
      const key = screen.title.replace(/^pages\./, "") as keyof typeof shellMessages.pages;
      expect(shellMessages.pages[key], `${path}'s title`).toMatch(/[؀-ۿ]/);
    }
  });

  it("open by the role's permissions: a section cashier opens no administration screen", () => {
    const open = (permissions: ReadonlySet<string>) =>
      (Object.keys(SCREENS) as NavPath[]).filter((screen) => mayOpen(screen, permissions));
    expect(open(SECTION_CASHIER)).toEqual(["/pos", "/products", "/device", "/printer"]);
    expect(open(ACCOUNTANT)).toEqual([
      "/invoices",
      "/rates",
      "/products",
      "/admin/users",
      "/admin/roles",
      "/admin/audit",
      "/device",
      "/printer",
    ]);
  });

  it("start at the products, or at the first screen the role opens", () => {
    expect(startScreen(SECTION_CASHIER)).toBe("/products");
    expect(startScreen(ACCOUNTANT)).toBe("/products");
    expect(startScreen(new Set(["audit.view", "organization.profile.edit"]))).toBe(
      "/admin/profile",
    );
    expect(startScreen(new Set(["sales.invoice.create"]))).toBe("/pos");
    expect(startScreen(new Set(["currency.rate.set"]))).toBe("/rates");
    expect(startScreen(new Set())).toBe("/device");
  });
});
