import type { PermissionCatalogue } from "@mustawfi/core-config/shared";
import { describe, expect, it } from "vitest";
import { accessGrant, type RoleAccess } from "./grant.ts";

const REPAIRS = "01a0d90e-0000-7000-8000-000000000001";
const ACCESSORIES = "01a0d90e-0000-7000-8000-000000000002";

const catalogue: PermissionCatalogue = {
  permissions: new Map([
    [
      "sales.invoice.create",
      { id: "sales.invoice.create", moduleId: "sales", scoped: true, grants: [] },
    ],
    [
      "access.users.manage",
      { id: "access.users.manage", moduleId: "core.access", scoped: false, grants: [] },
    ],
    ["audit.view", { id: "audit.view", moduleId: "core.audit", scoped: false, grants: [] }],
  ]),
  limits: new Map([
    [
      "sales.discount.maxPercent",
      { id: "sales.discount.maxPercent", moduleId: "sales", kind: "percent", grants: {} },
    ],
    [
      "sales.credit.maxAmount",
      { id: "sales.credit.maxAmount", moduleId: "sales", kind: "amount", grants: {} },
    ],
  ]),
};

const cashier: RoleAccess = {
  isOwner: false,
  permissions: ["sales.invoice.create", "access.users.manage", "repairs.job.close"],
  limits: { "sales.discount.maxPercent": "10" },
  departmentScope: "listed",
  departments: [REPAIRS],
};

const owner: RoleAccess = {
  isOwner: true,
  permissions: [],
  limits: {},
  departmentScope: "all",
  departments: [],
};

describe("accessGrant (core-foundation rules 14–16)", () => {
  it("holds a scoped permission only in the scope's departments", () => {
    const grant = accessGrant(catalogue, cashier);
    expect(grant.can("sales.invoice.create", REPAIRS)).toBe(true);
    expect(grant.can("sales.invoice.create", ACCESSORIES)).toBe(false);
    const everywhere = accessGrant(catalogue, { ...cashier, departmentScope: "all" });
    expect(everywhere.can("sales.invoice.create", ACCESSORIES)).toBe(true);
  });

  it("holds an unscoped permission whatever the scope, even an empty one", () => {
    const grant = accessGrant(catalogue, { ...cashier, departments: [] });
    expect(grant.can("access.users.manage")).toBe(true);
    expect(grant.can("sales.invoice.create", REPAIRS)).toBe(false);
  });

  it("does not hold a permission the role lacks", () => {
    expect(accessGrant(catalogue, cashier).can("audit.view")).toBe(false);
  });

  it("gives the owner every permission, in every department, without limits", () => {
    const grant = accessGrant(catalogue, owner);
    for (const permission of ["audit.view", "access.users.manage"]) {
      expect(grant.can(permission)).toBe(true);
    }
    expect(grant.can("sales.invoice.create", ACCESSORIES)).toBe(true);
    expect(grant.limitFor("sales.discount.maxPercent")).toEqual({ unlimited: true });
    expect(grant.permissions).toEqual([
      "access.users.manage",
      "audit.view",
      "sales.invoice.create",
    ]);
  });

  it("lists only declared permissions the role holds", () => {
    // `repairs.job.close` belongs to a module this catalogue does not have.
    expect(accessGrant(catalogue, cashier).permissions).toEqual([
      "access.users.manage",
      "sales.invoice.create",
    ]);
  });

  it("reads a role's limit, and zero for a limit the role has no value for", () => {
    const grant = accessGrant(catalogue, cashier);
    expect(grant.limitFor("sales.discount.maxPercent")).toEqual({ unlimited: false, value: "10" });
    expect(grant.limitFor("sales.credit.maxAmount")).toEqual({ unlimited: false, value: "0" });
  });

  it("refuses to check what no module declares, and a scoped permission without a department", () => {
    for (const access of [cashier, owner]) {
      const grant = accessGrant(catalogue, access);
      expect(() => grant.can("repairs.job.close")).toThrow(TypeError);
      expect(() => grant.limitFor("sales.discount.max")).toThrow(TypeError);
      expect(() => grant.can("sales.invoice.create")).toThrow(TypeError);
    }
  });
});
