import { Archive } from "lucide-react";
import type { ReactNode } from "react";
import { cx } from "./cx.ts";

export type BadgeTone = "positive" | "negative" | "warning" | "info" | "neutral" | "archived";

const TONES: Record<BadgeTone, string> = {
  positive: "bg-positive-tint text-text-positive",
  negative: "bg-negative-tint text-text-negative",
  warning: "bg-warning-tint text-text-warning",
  info: "bg-info-tint text-text-info",
  neutral: "border border-divider bg-sunken text-text-secondary",
  /** Solid grey with an archive icon, never red: red stays for errors, danger, negative amounts. */
  archived: "gap-1 bg-neutral-solid text-text-on-neutral-solid",
};

/** A status written as a word with its colour («نشط», «مؤرشف»), never colour alone. */
export function Badge({
  tone,
  children,
}: {
  readonly tone: BadgeTone;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center rounded-sm px-1.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
      )}
    >
      {tone === "archived" ? <Archive aria-hidden="true" size={12} strokeWidth={2} /> : null}
      {children}
    </span>
  );
}
