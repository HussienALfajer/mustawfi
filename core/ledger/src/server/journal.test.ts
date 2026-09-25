import { fc, test } from "@fast-check/vitest";
import { ProblemError } from "@mustawfi/core-config/server";
import { Currency, Decimal, Money } from "@mustawfi/kernel";
import { describe, expect, it } from "vitest";
import { ledgerProblemCodes } from "../shared/index.ts";
import { balancedTotal, type JournalLineInput } from "./journal.ts";

const SYP = Currency.of("SYP", 2);
const DEPARTMENT = "01920000-0000-7000-8000-000000000001";
const CASH = "01920000-0000-7000-8000-000000000002";
const REVENUE = "01920000-0000-7000-8000-000000000003";

const amount = (text: string, currency = SYP) => Money.of(text, currency);
const line = (side: "debit" | "credit", money: Money): JournalLineInput => ({
  accountId: side === "debit" ? CASH : REVENUE,
  side,
  amount: money,
  departmentId: DEPARTMENT,
});

/** A positive amount at the minor unit, up to 10¹² SYP. */
const ledgerAmount = fc
  .bigInt({ min: 1n, max: 10n ** 14n })
  .map((units) => Money.of(Decimal.fromScaledInteger(units, 2), SYP));

/**
 * A balanced entry: random debits, and credits that split their total by random weights —
 * zero parts dropped — shuffled together.
 */
const balancedLines = fc
  .tuple(
    fc.array(ledgerAmount, { minLength: 1, maxLength: 6 }),
    fc.array(fc.bigInt({ min: 1n, max: 1000n }), { minLength: 1, maxLength: 6 }),
  )
  .chain(([debits, weights]) => {
    const total = Money.sum(debits, SYP);
    const credits = total.allocate(weights.map((w) => Decimal.of(w))).filter((c) => !c.isZero());
    const lines = [
      ...debits.map((d) => line("debit", d)),
      ...credits.map((c) => line("credit", c)),
    ];
    return fc.shuffledSubarray(lines, { minLength: lines.length, maxLength: lines.length });
  });

function refusal(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof ProblemError) return error.code;
    throw error;
  }
  return undefined;
}

describe("balancedTotal", () => {
  test.prop([balancedLines])("accepts every balanced entry and returns its total", (lines) => {
    const debits = Money.sum(
      lines.filter((l) => l.side === "debit").map((l) => l.amount),
      SYP,
    );
    expect(balancedTotal(lines, "SYP").equals(debits)).toBe(true);
  });

  test.prop([balancedLines, fc.nat(), fc.boolean()])(
    "refuses an entry one minor unit off, on either side",
    (lines, pick, up) => {
      const index = pick % lines.length;
      const target = lines[index];
      if (target === undefined) throw new Error("no line");
      const cent = amount("0.01");
      // Lowering a one-cent line would make it zero, which is refused for another reason.
      const nudged =
        up || target.amount.equals(cent) ? target.amount.plus(cent) : target.amount.minus(cent);
      const broken = lines.map((l, i) => (i === index ? { ...l, amount: nudged } : l));
      expect(refusal(() => balancedTotal(broken, "SYP"))).toBe(ledgerProblemCodes.entryUnbalanced);
    },
  );

  it.each([
    ["a single line", [line("debit", amount("10"))]],
    ["no lines", []],
    ["a zero line", [line("debit", amount("0")), line("credit", amount("0"))]],
    ["a negative line", [line("debit", amount("-5")), line("credit", amount("-5"))]],
    [
      "an amount finer than the minor unit",
      [line("debit", amount("1.005")), line("credit", amount("1.005"))],
    ],
    [
      "a line in another currency",
      [
        line("debit", amount("10", Currency.of("USD", 2))),
        line("credit", amount("10", Currency.of("USD", 2))),
      ],
    ],
    [
      "lines whose currency disagrees on minor units",
      [line("debit", amount("10")), line("credit", amount("10", Currency.of("SYP", 0)))],
    ],
  ] satisfies [string, JournalLineInput[]][])("refuses %s as invalid", (_, lines) => {
    expect(refusal(() => balancedTotal(lines, "SYP"))).toBe(ledgerProblemCodes.entryInvalid);
  });
});
