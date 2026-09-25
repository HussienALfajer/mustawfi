import type { ReactNode, Ref } from "react";
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from "react-aria-components";
import { cx, FOCUS_RING } from "./cx.ts";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export interface ButtonProps extends Omit<AriaButtonProps, "className" | "children" | "style"> {
  readonly variant?: ButtonVariant;
  readonly className?: string;
  readonly children: ReactNode;
  readonly ref?: Ref<HTMLButtonElement>;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-button-primary-bg text-button-primary-text data-[hovered]:bg-button-primary-bg-hover data-[pressed]:bg-button-primary-bg-hover",
  secondary:
    "border border-field-border bg-surface text-text data-[hovered]:bg-sunken data-[pressed]:bg-selected",
  /** A destructive action: always labelled in words, never an icon alone (ADR-0024). */
  danger:
    "border border-field-border bg-surface text-text-negative data-[hovered]:bg-negative-tint data-[pressed]:bg-negative-tint",
  quiet: "bg-transparent text-text-accent data-[hovered]:bg-selected data-[pressed]:bg-selected",
};

/**
 * A button on React Aria (press, keyboard, focus-visible). At least one control height on
 * each side, so `touch` density gives every button a 48 px target.
 */
export function Button({ variant = "primary", className, children, ...props }: ButtonProps) {
  return (
    <AriaButton
      {...props}
      className={cx(
        "inline-flex min-h-control min-w-control cursor-default items-center justify-center gap-2 rounded-md px-pad-inline text-density font-medium whitespace-nowrap transition-colors select-none data-[pending]:opacity-80",
        VARIANTS[variant],
        FOCUS_RING,
        className,
      )}
    >
      {children}
    </AriaButton>
  );
}
