import { describe, expect, it } from "vitest";
import { isVisibleName, recordNameSchema } from "./names.ts";

describe("isVisibleName", () => {
  it("refuses a name of only spaces, bidi marks, zero-width, or control characters", () => {
    for (const blank of ["‏", "‎​", " ؜ ﻿", "‌‍", "\u0007"]) {
      expect(isVisibleName(blank), JSON.stringify(blank)).toBe(false);
      expect(recordNameSchema.safeParse(blank).success).toBe(false);
    }
  });

  it("takes any name with something to see, marks around it included", () => {
    for (const name of ["الصيانة", "‏الصيانة‏", "A", "٢", "قسم ٤"]) {
      expect(isVisibleName(name)).toBe(true);
    }
    expect(recordNameSchema.parse("  تحويل   الرصيد ")).toBe("تحويل الرصيد");
  });
});
