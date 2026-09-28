import { fc, test } from "@fast-check/vitest";
import { Decimal, ExchangeRate } from "@mustawfi/kernel";
import { describe, expect, it } from "vitest";
import {
  BASE_CURRENCY_CODES,
  catalogCurrencies,
  catalogCurrency,
  CURRENCY_CATALOG,
  CURRENCY_CODES,
  type CurrencyCode,
  DEFAULT_CASH_ROUNDING_STEPS,
  DEFAULT_CHANGE_CURRENCY,
  defaultTenantCurrencies,
  exchangeRateValueSchema,
  findCatalogCurrency,
  isValidCashRoundingStep,
  quotedPair,
} from "./catalog.ts";

const code = fc.constantFrom<CurrencyCode>(...CURRENCY_CODES);

describe("the currency catalog", () => {
  it("holds SYP, USD, and TRY with two minor units, ordered USD, TRY, SYP by strength", () => {
    expect(CURRENCY_CATALOG).toEqual([
      { code: "SYP", minorUnits: 2, strengthRank: 3 },
      { code: "USD", minorUnits: 2, strengthRank: 1 },
      { code: "TRY", minorUnits: 2, strengthRank: 2 },
    ]);
    expect(catalogCurrencies().map((c) => `${c.code}/${String(c.minorUnits)}`)).toEqual([
      "SYP/2",
      "USD/2",
      "TRY/2",
    ]);
    expect(findCatalogCurrency("EUR")).toBeUndefined();
    expect(findCatalogCurrency("USD")?.strengthRank).toBe(1);
  });

  it("quotes each pair per 1 unit of the stronger currency (ADR-0031)", () => {
    expect(quotedPair("SYP", "USD")).toEqual({ unitCurrency: "USD", quoteCurrency: "SYP" });
    expect(quotedPair("USD", "SYP")).toEqual({ unitCurrency: "USD", quoteCurrency: "SYP" });
    expect(quotedPair("SYP", "TRY")).toEqual({ unitCurrency: "TRY", quoteCurrency: "SYP" });
    expect(quotedPair("TRY", "USD")).toEqual({ unitCurrency: "USD", quoteCurrency: "TRY" });
    expect(() => quotedPair("USD", "USD")).toThrow(RangeError);
  });

  test.prop([code, code])(
    "the quoted pair is the one the kernel builds; the inverse is refused",
    (a, b) => {
      fc.pre(a !== b);
      const { unitCurrency, quoteCurrency } = quotedPair(a, b);
      const build = (unit: CurrencyCode, quote: CurrencyCode) =>
        ExchangeRate.of({
          unitCurrency: catalogCurrency(unit),
          quoteCurrency: catalogCurrency(quote),
          rate: "1.5",
        });
      expect(build(unitCurrency, quoteCurrency).unitCurrency.code).toBe(unitCurrency);
      expect(() => build(quoteCurrency, unitCurrency)).toThrow(RangeError);
    },
  );
});

describe("a new tenant's currencies", () => {
  it("enable the base and the other of SYP and USD, and leave TRY off", () => {
    expect(defaultTenantCurrencies("SYP")).toEqual([
      { code: "SYP", enabled: true, cashRoundingStep: "10" },
      { code: "USD", enabled: true, cashRoundingStep: "0.01" },
      { code: "TRY", enabled: false, cashRoundingStep: "1" },
    ]);
    expect(defaultTenantCurrencies("USD")).toEqual([
      { code: "SYP", enabled: true, cashRoundingStep: "10" },
      { code: "USD", enabled: true, cashRoundingStep: "0.01" },
      { code: "TRY", enabled: false, cashRoundingStep: "1" },
    ]);
  });

  it("give change in an enabled currency whatever the base (rule 3)", () => {
    for (const base of BASE_CURRENCY_CODES) {
      const change = defaultTenantCurrencies(base).find((c) => c.code === DEFAULT_CHANGE_CURRENCY);
      expect(change?.enabled).toBe(true);
    }
  });

  it("start with valid cash-rounding steps (rule 4)", () => {
    for (const currency of CURRENCY_CODES) {
      expect(
        isValidCashRoundingStep(currency, Decimal.of(DEFAULT_CASH_ROUNDING_STEPS[currency])),
      ).toBe(true);
    }
  });
});

describe("rule 4: a cash-rounding step", () => {
  it("is a positive multiple of the minor unit, at most 1000", () => {
    const valid = (text: string) => isValidCashRoundingStep("SYP", Decimal.of(text));
    expect(valid("0.01")).toBe(true);
    expect(valid("1000")).toBe(true);
    expect(valid("0")).toBe(false);
    expect(valid("-10")).toBe(false);
    expect(valid("0.005")).toBe(false);
    expect(valid("1000.01")).toBe(false);
  });
});

describe("rule 7: a rate on the wire", () => {
  it("is positive with at most 12 whole digits and 6 decimals", () => {
    const ok = (text: string) => exchangeRateValueSchema.safeParse(text).success;
    expect(ok("13000")).toBe(true);
    expect(ok("0.000001")).toBe(true);
    expect(ok("999999999999.999999")).toBe(true);
    expect(ok("1000000000000")).toBe(false);
    expect(ok("1.0000001")).toBe(false);
    expect(ok("0")).toBe(false);
    expect(ok("-5")).toBe(false);
    expect(ok("1e3")).toBe(false);
  });
});
