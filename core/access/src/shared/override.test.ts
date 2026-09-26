import { fc, test } from "@fast-check/vitest";
import type { LimitKind, PermissionCatalogue } from "@mustawfi/core-config/shared";
import { describe, expect, it } from "vitest";
import { type AccessGrant, accessGrant, type RoleAccess } from "./grant.ts";
import {
  type AccessPart,
  bundleUserAccess,
  catalogueFromView,
  catalogueView,
  grantCovers,
  supervisorOverrideSchema,
} from "./index.ts";

const REPAIRS = "01a0d90e-0000-7000-8000-000000000001";
const ACCESSORIES = "01a0d90e-0000-7000-8000-000000000002";

const catalogue: PermissionCatalogue = {
  permissions: new Map([
    [
      "sales.invoice.create",
      { id: "sales.invoice.create", moduleId: "sales", scoped: true, grants: [] },
    ],
    [
      "sales.invoice.credit",
      { id: "sales.invoice.credit", moduleId: "sales", scoped: true, grants: [] },
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

const supervisor: RoleAccess = {
  isOwner: false,
  permissions: ["sales.invoice.create", "audit.view"],
  limits: { "sales.discount.maxPercent": "15.5" },
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

const covers = (access: RoleAccess, request: Parameters<typeof grantCovers>[2]) =>
  grantCovers(catalogue, accessGrant(catalogue, access), request);

describe("grantCovers (core-foundation rule 18)", () => {
  it("covers a scoped action only in the role's departments", () => {
    const sale = { permission: "sales.invoice.create" };
    expect(covers(supervisor, { ...sale, departmentId: REPAIRS })).toBe(true);
    expect(covers(supervisor, { ...sale, departmentId: ACCESSORIES })).toBe(false);
    expect(
      covers({ ...supervisor, departmentScope: "all" }, { ...sale, departmentId: ACCESSORIES }),
    ).toBe(true);
    // A scoped action named without its department covers nothing, and never throws.
    expect(covers(owner, sale)).toBe(false);
  });

  it("covers an unscoped action wherever it is asked", () => {
    expect(covers(supervisor, { permission: "audit.view" })).toBe(true);
    expect(covers(supervisor, { permission: "audit.view", departmentId: ACCESSORIES })).toBe(true);
  });

  it("covers a value up to the role's limit, inclusive, whatever its spelling", () => {
    const discount = (value: string) => ({
      permission: "sales.invoice.create",
      departmentId: REPAIRS,
      limit: { id: "sales.discount.maxPercent", value },
    });
    expect(covers(supervisor, discount("15.5"))).toBe(true);
    expect(covers(supervisor, discount("15.5000"))).toBe(true);
    expect(covers(supervisor, discount("9"))).toBe(true);
    expect(covers(supervisor, discount("15.5001"))).toBe(false);
    expect(covers(supervisor, discount("100"))).toBe(false);
  });

  it("covers nothing beyond zero for a limit the role has no value for; the owner is unlimited", () => {
    const credit = (value: string) => ({
      permission: "sales.invoice.create",
      departmentId: REPAIRS,
      limit: { id: "sales.credit.maxAmount", value },
    });
    expect(covers(supervisor, credit("0"))).toBe(true);
    expect(covers(supervisor, credit("0.0001"))).toBe(false);
    expect(covers(owner, credit("9999999999999999.9999"))).toBe(true);
  });

  it("covers nothing undeclared or malformed, and never throws for it", () => {
    expect(covers(owner, { permission: "repairs.job.close" })).toBe(false);
    expect(
      covers(owner, {
        permission: "audit.view",
        limit: { id: "repairs.job.maxParts", value: "1" },
      }),
    ).toBe(false);
    expect(
      covers(owner, {
        permission: "audit.view",
        limit: { id: "sales.discount.maxPercent", value: "-1" },
      }),
    ).toBe(false);
  });

  it("needs the action as well as the value", () => {
    expect(
      covers(supervisor, {
        permission: "sales.invoice.credit",
        departmentId: REPAIRS,
        limit: { id: "sales.discount.maxPercent", value: "1" },
      }),
    ).toBe(false);
  });
});

describe("supervisorOverrideSchema", () => {
  it("takes an override as a device attaches it, and nothing else", () => {
    const override = {
      id: "01a0d90e-0000-7000-8000-0000000000a1",
      approverId: "01a0d90e-0000-7000-8000-0000000000b1",
      permission: "sales.invoice.create",
      departmentId: REPAIRS,
      limit: { id: "sales.discount.maxPercent", value: "12.5" },
      grantedAt: "2026-09-26T10:00:00.000Z",
    };
    expect(supervisorOverrideSchema.parse(override)).toEqual(override);
    expect(supervisorOverrideSchema.safeParse({ ...override, extra: true }).success).toBe(false);
    expect(
      supervisorOverrideSchema.safeParse({ ...override, limit: { id: "x", value: "1" } }).success,
    ).toBe(false);
  });
});

const idArbitrary = fc.constantFrom(
  "sales.invoice.create",
  "sales.invoice.credit",
  "audit.view",
  "access.users.manage",
  "repairs.job.close",
);
const limitArbitrary = fc.constantFrom(
  "sales.discount.maxPercent",
  "sales.credit.maxAmount",
  "repairs.job.maxParts",
);
const departmentArbitrary = fc.constantFrom(REPAIRS, ACCESSORIES);
const valueArbitrary = fc.oneof(
  fc.constantFrom("0", "10", "10.0000", "15.5"),
  fc.integer({ min: 0, max: 99_999 }).map((n) => (n / 100).toString()),
);

const catalogueArbitrary: fc.Arbitrary<PermissionCatalogue> = fc
  .record({
    permissions: fc.uniqueArray(fc.record({ id: idArbitrary, scoped: fc.boolean() }), {
      selector: (p) => p.id,
    }),
    limits: fc.uniqueArray(
      fc.record({
        id: limitArbitrary,
        kind: fc.constantFrom<LimitKind>("percent", "amount", "count"),
      }),
      { selector: (l) => l.id },
    ),
  })
  .map(({ permissions, limits }) => ({
    permissions: new Map(
      permissions.map((p) => [p.id, { ...p, moduleId: p.id.split(".")[0] ?? "", grants: [] }]),
    ),
    limits: new Map(
      limits.map((l) => [l.id, { ...l, moduleId: l.id.split(".")[0] ?? "", grants: {} }]),
    ),
  }));

const accessArbitrary: fc.Arbitrary<RoleAccess> = fc.record({
  isOwner: fc.boolean(),
  permissions: fc.uniqueArray(idArbitrary),
  limits: fc.dictionary(limitArbitrary, valueArbitrary),
  departmentScope: fc.constantFrom<"all" | "listed">("all", "listed"),
  departments: fc.uniqueArray(departmentArbitrary),
});

/** Every answer a grant gives over `catalogue`'s permissions and limits. */
function answers(grant: AccessGrant, over: PermissionCatalogue) {
  return {
    permissions: grant.permissions,
    can: [...over.permissions.values()].flatMap((permission) => [
      ...[REPAIRS, ACCESSORIES].map((department) => grant.can(permission.id, department)),
      ...(permission.scoped ? [] : [grant.can(permission.id)]),
    ]),
    limits: [...over.limits.keys()].map((limit) => grant.limitFor(limit)),
  };
}

describe("the client's resolution (core-foundation slice 16)", () => {
  test.prop([catalogueArbitrary, accessArbitrary])(
    "resolves against the catalogue's view exactly as against the catalogue",
    (declared, access) => {
      const viewed = catalogueFromView(catalogueView(declared));
      expect(answers(accessGrant(viewed, access), declared)).toEqual(
        answers(accessGrant(declared, access), declared),
      );
    },
  );

  test.prop([catalogueArbitrary, accessArbitrary])(
    "resolves a user of the bundle's access part as the server resolves their role and scope",
    (declared, access) => {
      // The part as the server builds it: the owner role lists every declared permission and no
      // limit; an editable one its own holdings; the user their scope's active departments.
      const roleId = "01a0d90e-0000-7000-8000-0000000000c1";
      const userId = "01a0d90e-0000-7000-8000-0000000000d1";
      const held = access.permissions.filter((p) => declared.permissions.has(p)).sort();
      const limits = Object.fromEntries(
        Object.entries(access.limits).filter(([id]) => declared.limits.has(id)),
      );
      const part: AccessPart = {
        catalogue: catalogueView(declared),
        roles: [
          {
            id: roleId,
            name: "الدور",
            isOwner: access.isOwner,
            permissions: access.isOwner ? [...declared.permissions.keys()].sort() : held,
            limits: access.isOwner ? {} : limits,
          },
        ],
        users: [
          {
            id: userId,
            name: "المستخدم",
            roleId,
            departmentScope: access.departmentScope,
            departments: access.departmentScope === "listed" ? [...access.departments] : [],
            pinVerifier: null,
            pinChangedAt: null,
          },
        ],
      };
      const onDevice = bundleUserAccess(part, userId);
      if (onDevice === undefined) throw new Error("the user is not in the part");
      const onServer: RoleAccess = access.isOwner
        ? { ...owner, departmentScope: access.departmentScope }
        : {
            ...access,
            permissions: held,
            limits,
            departments: access.departmentScope === "listed" ? access.departments : [],
          };
      expect(answers(accessGrant(catalogueFromView(part.catalogue), onDevice), declared)).toEqual(
        answers(accessGrant(declared, onServer), declared),
      );
    },
  );

  it("allows nobody the part does not describe", () => {
    const part: AccessPart = {
      catalogue: catalogueView(catalogue),
      roles: [],
      users: [],
    };
    expect(bundleUserAccess(part, REPAIRS)).toBeUndefined();
  });
});
