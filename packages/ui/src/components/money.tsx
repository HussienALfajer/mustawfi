import { formatDecimal, useDigitShape } from "@mustawfi/i18n";
import type { Money as KernelMoney } from "@mustawfi/kernel";
import { useTranslation } from "react-i18next";
import { cx } from "./cx.ts";
import { UI_NAMESPACE } from "./messages.ts";

export interface MoneyProps {
  /** The kernel's exact `Money` — never a `number` (ADR-0018). */
  readonly value: KernelMoney;
  readonly className?: string;
}

/** The label shown for a currency: translated in the `ui` namespace, else its ISO code. */
export function useCurrencyLabel(): (code: string) => string {
  const { t } = useTranslation(UI_NAMESPACE);
  return (code) => t(`currency.${code}`, { defaultValue: code });
}

/**
 * An amount with its currency, exactly as the kernel holds it: padded to the currency's minor
 * units and never rounded here. The figures are an isolated left-to-right run with tabular
 * digits; a negative amount has a minus sign and the negative colour, never the colour alone.
 */
export function Money({ value, className }: MoneyProps) {
  const digits = useDigitShape();
  const currencyLabel = useCurrencyLabel();
  const text = formatDecimal(value.amount.toString(), {
    digits,
    minimumFractionDigits: value.currency.minorUnits,
  });
  return (
    <span
      data-currency={value.currency.code}
      className={cx(
        "inline-flex items-baseline gap-1 whitespace-nowrap tabular-nums",
        value.isNegative() && "text-text-negative",
        className,
      )}
    >
      <bdi dir="ltr">{text}</bdi>
      <span>{currencyLabel(value.currency.code)}</span>
    </span>
  );
}
