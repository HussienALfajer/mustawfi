import { describe, expect, it } from "vitest";
import {
  formatPhone,
  isE164,
  parsePhone,
  phoneCallingCode,
  phoneNumberSchema,
  phoneParts,
} from "./phone.ts";

describe("phone numbers", () => {
  it("reads national numbers as Syrian and keeps international ones", () => {
    expect(parsePhone("0944 123 456")).toBe("+963944123456");
    expect(parsePhone("944123456")).toBe("+963944123456");
    expect(parsePhone("0944-123-456")).toBe("+963944123456");
    expect(parsePhone("011 222 3344")).toBe("+963112223344");
    expect(parsePhone("00963944123456")).toBe("+963944123456");
    expect(parsePhone("+961 3 123 456")).toBe("+9613123456");
    expect(parsePhone("03 123 456", "LB")).toBe("+9613123456");
    // An international number wins over the country it is read in.
    expect(parsePhone("+963 944 123 456", "LB")).toBe("+963944123456");
  });

  it("refuses what is not a real number", () => {
    expect(parsePhone("1234")).toBeUndefined();
    expect(parsePhone("0944 123")).toBeUndefined();
    expect(parsePhone("+963 1")).toBeUndefined();
    expect(parsePhone("phone")).toBeUndefined();
    expect(parsePhone("")).toBeUndefined();
    expect(parsePhone(`0944123456${" ".repeat(40)}`)).toBeUndefined();
  });

  it("stores E.164 and shows it grouped", () => {
    expect(isE164("+963944123456")).toBe(true);
    expect(isE164("0944123456")).toBe(false);
    expect(formatPhone("+963944123456")).toBe("+963 944 123 456");
    expect(formatPhone("+963112223344")).toBe("+963 11 222 3344");
    // Text that does not parse is shown as it is, so nothing stored is hidden.
    expect(formatPhone("12")).toBe("12");
  });

  it("splits a stored number into its region and national form for editing", () => {
    expect(phoneParts("+963944123456")).toEqual({ country: "SY", national: "0944 123 456" });
    expect(phoneParts("+9613123456")).toEqual({ country: "LB", national: "03 123 456" });
    expect(phoneParts("+9631234")).toBeUndefined();
    expect(phoneCallingCode("SY")).toBe("963");
  });

  it("parses to E.164 in the shared schema and refuses the rest", () => {
    expect(phoneNumberSchema.parse(" 0944 123 456 ")).toBe("+963944123456");
    expect(phoneNumberSchema.safeParse("1234").success).toBe(false);
    expect(phoneNumberSchema.safeParse("x".repeat(41)).success).toBe(false);
  });
});
