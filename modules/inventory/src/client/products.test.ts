import { CURRENCY_CATALOG } from "@mustawfi/core-currency/shared";
import { describe, expect, it } from "vitest";
import { PRICE_CURRENCIES, priceCurrency } from "./products.ts";

describe("price currencies", () => {
  it("are the currency catalog's, with its minor units and strength ranks", () => {
    expect(
      PRICE_CURRENCIES.map((c) => ({
        code: c.code,
        minorUnits: c.minorUnits,
        strengthRank: c.strengthRank,
      })),
    ).toEqual(CURRENCY_CATALOG);
    expect(priceCurrency("TRY")).toBe(PRICE_CURRENCIES[2]);
  });

  it("keep a code outside the catalog with two minor units", () => {
    expect(priceCurrency("EUR")).toMatchObject({ code: "EUR", minorUnits: 2 });
  });
});
