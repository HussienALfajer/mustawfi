import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { defineModule, routePrefix, type ModuleManifest } from "./module.ts";
import { createModuleRegistry, ModuleRegistryError } from "./registry.ts";

const module = (id: string, dependsOn: string[] = [], extra: Partial<ModuleManifest> = {}) =>
  defineModule({ id, dependsOn, ...extra });

describe("module registry", () => {
  it("orders modules dependencies first and keeps registration order otherwise", () => {
    const registry = createModuleRegistry([
      module("sales", ["inventory", "core.ledger"]),
      module("inventory", ["core.tenancy"]),
      module("core.ledger", ["core.tenancy"]),
      module("core.tenancy"),
    ]);
    expect(registry.modules.map((m) => m.id)).toEqual([
      "core.tenancy",
      "inventory",
      "core.ledger",
      "sales",
    ]);
    expect(registry.enabled).toEqual(registry.modules);
  });

  it("refuses a dependency that is not registered", () => {
    expect(() => createModuleRegistry([module("sales", ["inventory"])])).toThrow(
      new ModuleRegistryError("module sales depends on inventory, which is not registered"),
    );
  });

  it("refuses an enabled module whose dependency is disabled", () => {
    const modules = [module("inventory"), module("sales", ["inventory"])];
    expect(() => createModuleRegistry(modules, { disabled: ["inventory"] })).toThrow(
      new ModuleRegistryError(
        "module sales is enabled but depends on inventory, which is disabled",
      ),
    );
  });

  it("disables a module nothing enabled depends on, and still migrates it", () => {
    const registry = createModuleRegistry(
      [module("inventory", [], { migrations: "/m/inventory" }), module("sales", ["inventory"])],
      { disabled: ["sales", "inventory"] },
    );
    expect(registry.enabled).toEqual([]);
    expect(registry.migrationSets).toEqual([{ moduleId: "inventory", dir: "/m/inventory" }]);
  });

  it("refuses disabling a module that is not registered", () => {
    expect(() => createModuleRegistry([module("inventory")], { disabled: ["sales"] })).toThrow(
      new ModuleRegistryError("cannot disable sales: it is not registered"),
    );
  });

  it("refuses a module registered twice", () => {
    expect(() => createModuleRegistry([module("inventory"), module("inventory")])).toThrow(
      new ModuleRegistryError("module inventory is registered twice"),
    );
  });

  it("refuses a dependency cycle", () => {
    expect(() =>
      createModuleRegistry([module("a", ["b"]), module("b", ["c"]), module("c", ["a"])]),
    ).toThrow(new ModuleRegistryError("dependency cycle: a → b → c → a"));
  });

  it("refuses an id that is not a module id", () => {
    expect(() => module("Sales")).toThrow(TypeError);
    expect(() => module("sales", ["core/ledger"])).toThrow(TypeError);
  });

  it("gives migration sets in dependency order", () => {
    const registry = createModuleRegistry([
      module("sales", ["core.tenancy"], { migrations: "/m/sales" }),
      module("core.config"),
      module("core.tenancy", ["core.config"], { migrations: "/m/tenancy" }),
    ]);
    expect(registry.migrationSets.map((s) => s.moduleId)).toEqual(["core.tenancy", "sales"]);
  });

  it("mounts only enabled modules, each under its prefix, with the host's context", async () => {
    const routes = (id: string) =>
      function (
        app: Parameters<NonNullable<ModuleManifest<string>["routes"]>>[0],
        context: string,
      ) {
        app.get("/whoami", () => ({ id, context }));
      };
    const registry = createModuleRegistry<string>(
      [
        defineModule<string>({ id: "core.tenancy", dependsOn: [], routes: routes("core.tenancy") }),
        defineModule<string>({ id: "reports", dependsOn: [], routes: routes("reports") }),
      ],
      { disabled: ["reports"] },
    );
    const app = Fastify();
    await registry.mount(app, "host context");
    const mounted = await app.inject({ method: "GET", url: "/api/v1/tenancy/whoami" });
    expect(mounted.json()).toEqual({ id: "core.tenancy", context: "host context" });
    const disabled = await app.inject({ method: "GET", url: `${routePrefix("reports")}/whoami` });
    expect(disabled.statusCode).toBe(404);
    await app.close();
  });

  describe("document codes (core-foundation rule 30)", () => {
    it("lists every declared code with its module, disabled modules included", () => {
      const registry = createModuleRegistry(
        [
          module("sales", [], { documentCodes: ["INV", "RET"] }),
          module("repairs", [], { documentCodes: ["RPR"] }),
        ],
        { disabled: ["repairs"] },
      );
      expect([...registry.documentCodes]).toEqual([
        ["INV", "sales"],
        ["RET", "sales"],
        ["RPR", "repairs"],
      ]);
    });

    it("refuses a code two modules declare, even when one of them is disabled", () => {
      const modules = [
        module("sales", [], { documentCodes: ["INV"] }),
        module("purchases", [], { documentCodes: ["INV"] }),
      ];
      const error = new ModuleRegistryError(
        "document code INV is declared by both sales and purchases",
      );
      expect(() => createModuleRegistry(modules)).toThrow(error);
      expect(() => createModuleRegistry(modules, { disabled: ["purchases"] })).toThrow(error);
    });

    it.each(["inv", "IN", "INVO", "IN1", "ÉTÉ", ""])(
      "refuses %j, which is not a document code",
      (code) => {
        expect(() => module("sales", [], { documentCodes: [code] })).toThrow(TypeError);
      },
    );

    it("refuses a module declaring a code twice", () => {
      expect(() => module("sales", [], { documentCodes: ["INV", "INV"] })).toThrow(
        new TypeError("module sales declares a document code twice"),
      );
    });
  });

  describe("permissions and limits (core-foundation rule 13)", () => {
    const inventory = () =>
      module("inventory", [], {
        permissions: [
          { id: "inventory.products.view", grants: ["accountant", "sectionCashier"] },
          { id: "inventory.stock.adjust", scoped: true },
        ],
        limits: [{ id: "inventory.adjust.maxCount", kind: "count", grants: { accountant: "5" } }],
      });

    it("catalogues every declaration with its module, disabled modules included", () => {
      const registry = createModuleRegistry(
        [inventory(), module("core.audit", [], { permissions: [{ id: "audit.view" }] })],
        { disabled: ["inventory"] },
      );
      expect([...registry.permissions.permissions.values()]).toEqual([
        {
          id: "inventory.products.view",
          moduleId: "inventory",
          scoped: false,
          grants: ["accountant", "sectionCashier"],
        },
        { id: "inventory.stock.adjust", moduleId: "inventory", scoped: true, grants: [] },
        { id: "audit.view", moduleId: "core.audit", scoped: false, grants: [] },
      ]);
      expect([...registry.permissions.limits.values()]).toEqual([
        {
          id: "inventory.adjust.maxCount",
          moduleId: "inventory",
          kind: "count",
          grants: { accountant: "5" },
        },
      ]);
    });

    it("refuses a permission or limit two modules declare", () => {
      // `core.sales` and `sales` share the prefix `sales.`.
      expect(() =>
        createModuleRegistry([
          module("sales", [], { permissions: [{ id: "sales.invoice.create" }] }),
          module("core.sales", [], { permissions: [{ id: "sales.invoice.create" }] }),
        ]),
      ).toThrow(
        new ModuleRegistryError(
          "permission sales.invoice.create is declared by both sales and core.sales",
        ),
      );
      expect(() =>
        createModuleRegistry([
          module("sales", [], { permissions: [{ id: "sales.discount.max" }] }),
          module("core.sales", [], { limits: [{ id: "sales.discount.max", kind: "percent" }] }),
        ]),
      ).toThrow(
        new ModuleRegistryError(
          "limit sales.discount.max is declared by both sales and core.sales",
        ),
      );
    });

    it("refuses a declaration repeated within one module", () => {
      expect(() =>
        module("inventory", [], {
          permissions: [{ id: "inventory.products.view" }, { id: "inventory.products.view" }],
        }),
      ).toThrow(
        new TypeError("module inventory declares permission inventory.products.view twice"),
      );
    });

    it("refuses a grant naming an unknown template, also from a manifest not built by defineModule", () => {
      const permission = { id: "inventory.products.view", grants: ["cashier"] } as never;
      expect(() => module("inventory", [], { permissions: [permission] })).toThrow(
        new TypeError(
          'permission inventory.products.view of module inventory names unknown template "cashier"',
        ),
      );
      const raw: ModuleManifest = { id: "inventory", dependsOn: [], permissions: [permission] };
      expect(() => createModuleRegistry([raw])).toThrow(ModuleRegistryError);
      const limit = { id: "inventory.adjust.max", kind: "count", grants: { owner: "1" } } as never;
      expect(() => module("inventory", [], { limits: [limit] })).toThrow(
        new TypeError(
          'limit inventory.adjust.max of module inventory names unknown template "owner"',
        ),
      );
    });

    it("refuses an id outside the module's prefix, a malformed id, kind, or value", () => {
      expect(() =>
        module("inventory", [], { permissions: [{ id: "sales.invoice.create" }] }),
      ).toThrow(
        new TypeError(
          'permission sales.invoice.create of module inventory must start with "inventory."',
        ),
      );
      expect(() => module("core.audit", [], { permissions: [{ id: "core.audit.view" }] })).toThrow(
        TypeError,
      );
      for (const id of ["inventory", "inventory.Products", "inventory.a.b.c.d", "inventory..x"]) {
        expect(() => module("inventory", [], { permissions: [{ id }] })).toThrow(TypeError);
      }
      expect(() =>
        module("inventory", [], { limits: [{ id: "inventory.max", kind: "ratio" as never }] }),
      ).toThrow(TypeError);
      for (const value of ["-1", "1.23456", "1e3", ""]) {
        expect(() =>
          module("inventory", [], {
            limits: [{ id: "inventory.max", kind: "count", grants: { accountant: value } }],
          }),
        ).toThrow(TypeError);
      }
    });
  });
});
