import { cx } from "./cx.ts";

const KEY_NAMES: Record<string, string> = { Control: "Ctrl", Escape: "Esc" };

/** How a shortcut in `aria-keyshortcuts` syntax (`Control+S`, `Escape`, `N`) is shown on screen. */
export function shortcutLabel(shortcut: string): string {
  return shortcut
    .split("+")
    .map((key) => KEY_NAMES[key] ?? key.toUpperCase())
    .join("+");
}

/**
 * A keyboard shortcut shown next to its control: pass the control's `aria-keyshortcuts` value
 * (`Control+S`). Decorative, so assistive tech reads the shortcut once, from the control.
 */
export function Kbd({
  shortcut,
  className,
}: {
  readonly shortcut: string;
  readonly className?: string;
}) {
  return (
    <kbd
      aria-hidden="true"
      className={cx(
        "rounded-sm border border-current px-1 font-mono text-xs font-normal",
        className,
      )}
    >
      {/* Only the label reads left to right: on the badge itself, `dir` would turn its logical
          placement (`end-*`, `ms-auto`) to the wrong side of a right-to-left screen. */}
      <bdi dir="ltr">{shortcutLabel(shortcut)}</bdi>
    </kbd>
  );
}
