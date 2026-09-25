import { describe, expect, it } from "vitest";
import {
  createSyncOperationTable,
  OperationRejected,
  type SyncOperationHandler,
} from "./operations.ts";

const handler: SyncOperationHandler = () => Promise.resolve({});

describe("createSyncOperationTable", () => {
  it("finds each operation type's definition", () => {
    const table = createSyncOperationTable([
      { type: "sales.invoice.post", versions: { 1: handler, 2: handler } },
    ]);
    expect(table.types).toEqual(["sales.invoice.post"]);
    expect(Object.keys(table.get("sales.invoice.post")?.versions ?? {})).toEqual(["1", "2"]);
    expect(table.get("sales.invoice.void")).toBeUndefined();
  });

  it.each([
    [
      "a type defined twice",
      [
        { type: "sales.invoice.post", versions: { 1: handler } },
        { type: "sales.invoice.post", versions: { 1: handler } },
      ],
    ],
    ["a malformed type", [{ type: "Sales invoice", versions: { 1: handler } }]],
    ["a type without versions", [{ type: "sales.invoice.post", versions: {} }]],
    ["a version zero", [{ type: "sales.invoice.post", versions: { 0: handler } }]],
  ])("refuses %s", (_, definitions) => {
    expect(() => createSyncOperationTable(definitions)).toThrow();
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
