import type { PermissionCatalogue } from "@mustawfi/core-config/shared";
import { describe, expect, it } from "vitest";
import {
  createSyncOperationTable,
  OperationRejected,
  type SyncOperationDefinition,
  type SyncOperationHandler,
} from "./operations.ts";

const handler: SyncOperationHandler = () => Promise.resolve({});

const catalogue: PermissionCatalogue = {
  permissions: new Map([
    [
      "sales.invoice.create",
      { id: "sales.invoice.create", moduleId: "sales", scoped: true, grants: [] },
    ],
    ["sales.note.add", { id: "sales.note.add", moduleId: "sales", scoped: false, grants: [] }],
  ]),
  limits: new Map(),
};

const invoiceAccess = {
  permission: "sales.invoice.create",
  department: (payload: Readonly<Record<string, unknown>>) =>
    typeof payload["departmentId"] === "string" ? payload["departmentId"] : undefined,
};

describe("createSyncOperationTable", () => {
  it("finds each operation type's definition", () => {
    const table = createSyncOperationTable(
      [{ type: "sales.invoice.post", access: invoiceAccess, versions: { 1: handler, 2: handler } }],
      catalogue,
    );
    expect(table.types).toEqual(["sales.invoice.post"]);
    expect(Object.keys(table.get("sales.invoice.post")?.versions ?? {})).toEqual(["1", "2"]);
    expect(table.get("sales.invoice.void")).toBeUndefined();
    expect(table.permissionCatalogue).toBe(catalogue);
  });

  it("accepts an operation any user of a device may send, and an unscoped permission", () => {
    const table = createSyncOperationTable(
      [
        { type: "audit.entry.record", access: "device", versions: { 1: handler } },
        {
          type: "sales.note.add",
          access: { permission: "sales.note.add" },
          versions: { 1: handler },
        },
      ],
      catalogue,
    );
    expect(table.types).toEqual(["audit.entry.record", "sales.note.add"]);
  });

  it.each<[string, SyncOperationDefinition[]]>([
    [
      "a type defined twice",
      [
        { type: "sales.invoice.post", access: invoiceAccess, versions: { 1: handler } },
        { type: "sales.invoice.post", access: invoiceAccess, versions: { 1: handler } },
      ],
    ],
    [
      "a malformed type",
      [{ type: "Sales invoice", access: invoiceAccess, versions: { 1: handler } }],
    ],
    [
      "a type without versions",
      [{ type: "sales.invoice.post", access: invoiceAccess, versions: {} }],
    ],
    [
      "a version zero",
      [{ type: "sales.invoice.post", access: invoiceAccess, versions: { 0: handler } }],
    ],
    [
      "a type that declares no access (core-foundation rule 17)",
      [{ type: "sales.invoice.post", versions: { 1: handler } } as never],
    ],
    [
      "an undeclared permission",
      [
        {
          type: "sales.invoice.post",
          access: { permission: "sales.invoice.sell" },
          versions: { 1: handler },
        },
      ],
    ],
    [
      "a scoped permission without its department",
      [
        {
          type: "sales.invoice.post",
          access: { permission: "sales.invoice.create" },
          versions: { 1: handler },
        },
      ],
    ],
  ])("refuses %s", (_, definitions) => {
    expect(() => createSyncOperationTable(definitions, catalogue)).toThrow();
  });
});

describe("OperationRejected", () => {
  it("carries a problem code, and refuses one that is not", () => {
    expect(new OperationRejected("sales.invoice.invalid", "why")).toMatchObject({
      code: "sales.invoice.invalid",
      detail: "why",
    });
    expect(() => new OperationRejected("not a code")).toThrow();
  });
});
