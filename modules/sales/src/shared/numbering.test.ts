import { fc, test } from "@fast-check/vitest";
import { UNAMBIGUOUS_ALPHABET } from "@mustawfi/kernel";
import { describe, expect, it } from "vitest";
import { formatInvoiceNumber, parseInvoiceNumber } from "./index.ts";

const symbol = fc.constantFrom(...UNAMBIGUOUS_ALPHABET);
const prefix = fc.tuple(symbol, symbol).map(([a, b]) => a + b);
const seq = fc.integer({ min: 1, max: 10 ** 15 - 1 });

describe("invoice numbers", () => {
  it("are {prefix}-INV-{seq:6}", () => {
    expect(formatInvoiceNumber("K7", 123)).toBe("K7-INV-000123");
    expect(formatInvoiceNumber("K7", 1_234_567)).toBe("K7-INV-1234567");
  });

  test.prop([prefix, seq])("read back as the prefix and sequence they were made of", (p, n) => {
    expect(parseInvoiceNumber(formatInvoiceNumber(p, n))).toEqual({ prefix: p, seq: n });
  });

  test.prop([prefix, seq, seq])("differ whenever the prefix or the sequence differs", (p, n, m) => {
    fc.pre(n !== m);
    expect(formatInvoiceNumber(p, n)).not.toBe(formatInvoiceNumber(p, m));
  });

  it.each([
    "K7-INV-12",
    "K7-INV-0000123",
    "K7-INV-000000",
    "k7-INV-000123",
    "K0-INV-000123",
    "K7-RET-000123",
    " K7-INV-000123",
  ])("refuse %j, which is not a number in its canonical form", (text) => {
    expect(parseInvoiceNumber(text)).toBeUndefined();
  });

  it.each([
    ["a prefix outside the alphabet", () => formatInvoiceNumber("I1", 1)],
    ["a zero sequence", () => formatInvoiceNumber("K7", 0)],
    ["a fractional sequence", () => formatInvoiceNumber("K7", 1.5)],
  ])("cannot be made from %s", (_, make) => {
    expect(make).toThrow();
  });
});
