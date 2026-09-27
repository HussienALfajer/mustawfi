import { describe, expect, it } from "vitest";
import { storeCodeFieldSchema } from "./store-code-field.ts";

describe("storeCodeFieldSchema", () => {
  const problem = (typed: string) =>
    storeCodeFieldSchema.safeParse(typed).error?.issues.map((issue) => issue.message);

  it("takes a store code as people type it", () => {
    for (const typed of ["N7GBHU", " n7gbhu ", "n7g-bhu"]) expect(problem(typed)).toBeUndefined();
  });

  it("says a missing code is required and a mistyped one has the wrong shape", () => {
    expect(problem("  ")?.[0]).toBe("required");
    for (const typed of ["n7g", "N7GBHU1", "N7GBH0", "رمز"]) {
      expect(problem(typed)).toEqual(["storeCodeShape"]);
    }
  });
});
