import type { ReactNode, Ref } from "react";
import { Button as AriaButton, type ButtonProps as AriaButtonProps } from "react-aria-components";
import { cx, FOCUS_RING } from "./cx.ts";
import { PRESSABLE } from "./interaction.ts";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export interface ButtonProps extends Omit<AriaButtonProps, "className" | "children" | "style"> {
  readonly variant?: ButtonVariant;
  readonly className?: string;
  readonly children: ReactNode;
  readonly ref?: Ref<HTMLButtonElement>;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-button-primary-bg text-button-primary-text data-[hovered]:bg-button-primary-bg-hover data-[pressed]:bg-button-primary-bg-pressed",
  secondary:
    "border border-field-border bg-surface text-text data-[hovered]:bg-state-hover-bg data-[pressed]:bg-state-pressed-bg",
  /** A destructive action: always labelled in words, never an icon alone (ADR-0024). */
  danger:
    "border border-field-border bg-surface text-text-negative data-[hovered]:bg-negative-tint data-[pressed]:bg-negative-pressed",
  quiet:
    "bg-transparent text-text-accent data-[hovered]:bg-state-hover-bg data-[pressed]:bg-state-pressed-bg",
};

/** A button's classes, for the gallery's states table; screens use `Button`. */
export function buttonClass(variant: ButtonVariant = "primary"): string {
  return cx(
    "inline-flex min-h-control min-w-control items-center justify-center gap-2 rounded-md px-pad-inline text-density font-medium whitespace-nowrap select-none data-[disabled]:opacity-60 data-[pending]:opacity-80",
    PRESSABLE,
    VARIANTS[variant],
    FOCUS_RING,
  );
}

/**
 * A button on React Aria (press, keyboard, focus-visible). At least one control height on
 * each side, so `touch` density gives every button a 48 px target. Hover tints it and pressed
 * darkens it one step (`interaction.ts`).
 */
export function Button({ variant = "primary", className, children, ...props }: ButtonProps) {
  return (
    <AriaButton {...props} className={cx(buttonClass(variant), className)}>
      {children}
    </AriaButton>
  );
}
