import { fc, test } from "@fast-check/vitest";
import { UNAMBIGUOUS_ALPHABET } from "@mustawfi/kernel";
import { describe, expect, it } from "vitest";
import { formatDocumentNumber, parseDocumentNumber } from "./numbering.ts";

const symbol = fc.constantFrom(...UNAMBIGUOUS_ALPHABET);
const prefix = fc.tuple(symbol, symbol).map(([a, b]) => a + b);
const docCode = fc
  .tuple(...Array.from({ length: 3 }, () => fc.constantFrom(..."ABCDEFGHIJKLMNOPQRSTUVWXYZ")))
  .map((letters) => letters.join(""));
const seq = fc.integer({ min: 1, max: 10 ** 15 - 1 });

describe("document numbers (core-foundation rule 30)", () => {
  it("are {prefix}-{docCode}-{seq:6}", () => {
    expect(formatDocumentNumber("K7", "INV", 123)).toBe("K7-INV-000123");
    expect(formatDocumentNumber("K7", "RET", 1_234_567)).toBe("K7-RET-1234567");
  });

  test.prop([prefix, docCode, seq])(
    "read back as the prefix, code, and sequence they were made of",
    (p, c, n) => {
      expect(parseDocumentNumber(formatDocumentNumber(p, c, n))).toEqual({
        prefix: p,
        docCode: c,
        seq: n,
      });
    },
  );

  test.prop([prefix, docCode, docCode, seq, seq])(
    "differ whenever the code or the sequence differs",
    (p, c, d, n, m) => {
      fc.pre(c !== d || n !== m);
      expect(formatDocumentNumber(p, c, n)).not.toBe(formatDocumentNumber(p, d, m));
    },
  );

  it.each([
    "K7-INV-12",
    "K7-INV-0000123",
    "K7-INV-000000",
    "k7-INV-000123",
    "K0-INV-000123",
    "K7-inv-000123",
    "K7-IN-000123",
    "K7-INVO-000123",
    " K7-INV-000123",
    "K7-INV-000123 ",
  ])("refuse %j, which is not a number in its canonical form", (text) => {
    expect(parseDocumentNumber(text)).toBeUndefined();
  });

  it.each([
    ["a prefix outside the alphabet", () => formatDocumentNumber("I1", "INV", 1)],
    ["a lower-case code", () => formatDocumentNumber("K7", "inv", 1)],
    ["a two-letter code", () => formatDocumentNumber("K7", "IN", 1)],
    ["a zero sequence", () => formatDocumentNumber("K7", "INV", 0)],
    ["a fractional sequence", () => formatDocumentNumber("K7", "INV", 1.5)],
    ["a sequence of sixteen digits", () => formatDocumentNumber("K7", "INV", 10 ** 15)],
  ])("cannot be made from %s", (_, make) => {
    expect(make).toThrow();
  });
});
