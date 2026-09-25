import { describe, expect, it } from "vitest";
import { createI18n } from "./instance.ts";
import { formatDecimal, parseDecimalInput, toWesternDigits } from "./numbers.ts";

describe("formatDecimal", () => {
  it("formats canonical text exactly, with grouping, in Western digits by default", () => {
    expect(formatDecimal("1234567.5", { minimumFractionDigits: 2 })).toBe("1,234,567.50");
    expect(formatDecimal("0.123456")).toBe("0.123456");
    // Intl marks the minus left-to-right so it stays before the digits in Arabic text.
    expect(formatDecimal("-12")).toBe("‎-12");
  });

  it("keeps digits a float would lose", () => {
    expect(formatDecimal("12345678901234567.89")).toBe("12,345,678,901,234,567.89");
  });

  it("draws Arabic-Indic digits and separators when asked", () => {
    expect(formatDecimal("1234.5", { digits: "arab", minimumFractionDigits: 2 })).toBe("١٬٢٣٤٫٥٠");
  });

  it("refuses text that is not canonical", () => {
    expect(() => formatDecimal("1e3")).toThrow(RangeError);
    expect(() => formatDecimal("01")).toThrow(RangeError);
  });
});

describe("parseDecimalInput", () => {
  it.each([
    ["12", "12"],
    ["12.50", "12.50"],
    [" 1,250.5 ", "1250.5"],
    ["١٢٣٫٤٥", "123.45"],
    ["۱۲۳", "123"],
    ["١٬٢٥٠", "1250"],
    [".5", "0.5"],
    ["5.", "5"],
    ["007", "7"],
    ["-3.25", "-3.25"],
    ["−3", "-3"],
    ["-0", "0"],
    ["‏12‎", "12"],
  ])("reads %j as %j", (input, expected) => {
    expect(parseDecimalInput(input)).toBe(expected);
  });

  it.each([
    "",
    " ",
    ".",
    "-",
    "1.2.3",
    "12a",
    "1e3",
    "--1",
    "0x10",
    "Infinity",
    // A decimal comma must not be read as grouping (it would be ten times the amount).
    "12,5",
    "1,25",
    "1,2345",
    ",125",
    "1,000.5,0",
  ])("refuses %j", (input) => {
    expect(parseDecimalInput(input)).toBeUndefined();
  });

  it("maps both Arabic-Indic digit ranges to Western digits", () => {
    expect(toWesternDigits("٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789 0123456789");
  });
});

describe("createI18n", () => {
  it("renders ICU messages with the six Arabic plural forms", () => {
    const i18n = createI18n({
      test: {
        items:
          "{count, plural, zero {لا منتجات} one {منتج واحد} two {منتجان} few {# منتجات} many {# منتجًا} other {# منتج}}",
      },
    });
    const t = i18n.getFixedT("ar", "test");
    expect([0, 1, 2, 3, 11, 100].map((count) => t("items", { count }))).toEqual([
      "لا منتجات",
      "منتج واحد",
      "منتجان",
      "3 منتجات",
      "11 منتجًا",
      "100 منتج",
    ]);
  });

  it("shows the key of a missing message instead of another language", () => {
    const t = createI18n({ test: {} }).getFixedT("ar", "test");
    expect(t("missing.key")).toBe("missing.key");
  });
});
