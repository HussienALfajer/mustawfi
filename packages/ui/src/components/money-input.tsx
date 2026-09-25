import { parseDecimalInput } from "@mustawfi/i18n";
import { type Currency, Decimal, Money as KernelMoney } from "@mustawfi/kernel";
import type { Ref } from "react";
import { Input, Radio, RadioGroup, TextField } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { cx, FOCUS_RING } from "./cx.ts";
import { FieldHelp, FieldLabel, INPUT_CLASS } from "./field.tsx";
import { UI_NAMESPACE } from "./messages.ts";
import { useCurrencyLabel } from "./money.tsx";

/** Why typed text is not an acceptable amount; each has a message in the `ui` namespace. */
export type MoneyInputProblem = "required" | "notANumber" | "tooPrecise" | "negative";

export interface ReadMoneyOptions {
  /** Most decimal places accepted; the currency's minor units by default. Unit prices take more. */
  readonly scale?: number;
  readonly allowNegative?: boolean;
}

export type ReadMoneyResult =
  | { readonly money: KernelMoney; readonly problem?: undefined }
  | { readonly money?: undefined; readonly problem: MoneyInputProblem };

/**
 * Reads the text of an amount field as exact `Money` in `currency`, never through a float:
 * Western or Arabic-Indic digits, `.` or `٫`, grouping marks ignored.
 */
export function readMoneyInput(
  text: string,
  currency: Currency,
  options: ReadMoneyOptions = {},
): ReadMoneyResult {
  if (text.trim() === "") return { problem: "required" };
  const canonical = parseDecimalInput(text);
  if (canonical === undefined) return { problem: "notANumber" };
  const amount = Decimal.of(canonical);
  if (amount.scale() > (options.scale ?? currency.minorUnits)) return { problem: "tooPrecise" };
  if (amount.isNegative() && options.allowNegative !== true) return { problem: "negative" };
  return { money: KernelMoney.of(amount, currency) };
}

export interface MoneyInputProps {
  readonly label: string;
  /** The text as typed; read it with `readMoneyInput`. */
  readonly amount: string;
  readonly onAmountChange: (text: string) => void;
  readonly currency: Currency;
  /** When there is more than one, the field offers them next to the amount (dollarization). */
  readonly currencies?: readonly Currency[];
  readonly onCurrencyChange?: (currency: Currency) => void;
  /** The problem to show; `scale` fills the `tooPrecise` message. */
  readonly problem?: MoneyInputProblem | undefined;
  readonly scale?: number;
  readonly name?: string;
  readonly autoFocus?: boolean;
  readonly onBlur?: () => void;
  readonly inputRef?: Ref<HTMLInputElement>;
}

/**
 * An amount field on the kernel's `Money`: text in, `readMoneyInput` out, no `number` anywhere.
 * The figures are typed left to right; the currency choice is a radio group (arrow keys).
 */
export function MoneyInput({
  label,
  amount,
  onAmountChange,
  currency,
  currencies = [currency],
  onCurrencyChange,
  problem,
  scale,
  name,
  autoFocus,
  onBlur,
  inputRef,
}: MoneyInputProps) {
  const { t } = useTranslation(UI_NAMESPACE);
  const currencyLabel = useCurrencyLabel();
  const choosesCurrency = currencies.length > 1;
  const errorMessage =
    problem === undefined
      ? undefined
      : t(`moneyInput.${problem}`, { scale: scale ?? currency.minorUnits });
  return (
    <div className="flex flex-col gap-1">
      <TextField
        value={amount}
        onChange={onAmountChange}
        {...(name === undefined ? {} : { name })}
        {...(autoFocus === undefined ? {} : { autoFocus })}
        {...(onBlur === undefined ? {} : { onBlur })}
        inputMode="decimal"
        validationBehavior="aria"
        isInvalid={problem !== undefined}
        className="flex flex-col gap-1"
      >
        <FieldLabel>{label}</FieldLabel>
        <div className="flex items-stretch gap-2">
          <Input
            ref={inputRef}
            dir="ltr"
            autoComplete="off"
            className={cx(INPUT_CLASS, "text-end tabular-nums")}
          />
          {choosesCurrency ? null : (
            <span className="flex items-center text-density text-text-secondary">
              {currencyLabel(currency.code)}
            </span>
          )}
        </div>
        <FieldHelp errorMessage={errorMessage} />
      </TextField>
      {choosesCurrency ? (
        <RadioGroup
          aria-label={t("moneyInput.currency")}
          orientation="horizontal"
          value={currency.code}
          onChange={(code) => {
            const chosen = currencies.find((option) => option.code === code);
            if (chosen !== undefined) onCurrencyChange?.(chosen);
          }}
          className="flex gap-2"
        >
          {currencies.map((option) => (
            <Radio
              key={option.code}
              value={option.code}
              className={cx(
                "flex min-h-control min-w-control cursor-default items-center justify-center rounded-sm border border-field-border bg-surface px-pad-inline text-density text-text data-[selected]:border-accent data-[selected]:bg-selected data-[selected]:font-semibold data-[selected]:text-text-accent",
                FOCUS_RING,
              )}
            >
              {currencyLabel(option.code)}
            </Radio>
          ))}
        </RadioGroup>
      ) : null}
    </div>
  );
}
