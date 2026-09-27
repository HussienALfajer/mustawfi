import { describe, expect, it } from "vitest";
import { limitValueFitsKind } from "./permissions.ts";

describe("limitValueFitsKind (core-foundation rule 16, QA slice 26)", () => {
  it("keeps a percent within 0 to 100", () => {
    for (const value of ["0", "7.5", "05.5", "99.9999", "100", "0100.0000"]) {
      expect(limitValueFitsKind("percent", value), value).toBe(true);
    }
    for (const value of ["100.0001", "101", "0250"]) {
      expect(limitValueFitsKind("percent", value), value).toBe(false);
    }
  });

  it("keeps a count whole", () => {
    for (const value of ["0", "3", "12.0", "40.0000"]) {
      expect(limitValueFitsKind("count", value), value).toBe(true);
    }
    for (const value of ["2.5", "1.0001"]) {
      expect(limitValueFitsKind("count", value), value).toBe(false);
    }
  });

  it("takes any non-negative decimal as an amount, and nothing malformed of any kind", () => {
    expect(limitValueFitsKind("amount", "250000.75")).toBe(true);
    for (const kind of ["percent", "count", "amount"] as const) {
      for (const value of ["-1", "1e3", "", "1.23456"]) {
        expect(limitValueFitsKind(kind, value), `${kind} ${value}`).toBe(false);
      }
    }
  });
});
