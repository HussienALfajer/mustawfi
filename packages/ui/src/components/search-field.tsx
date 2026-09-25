import { Search } from "lucide-react";
import { useRef } from "react";
import { Input, SearchField as AriaSearchField } from "react-aria-components";
import { cx, FOCUS_RING } from "./cx.ts";
import { Kbd } from "./kbd.tsx";
import { useShortcut } from "./keyboard.ts";

export interface SearchFieldProps {
  /** The field's accessible name: a filter bar's search has no visible label, only its icon. */
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  /** `/` focuses this field from anywhere on the screen (one search per screen). */
  readonly slashShortcut?: boolean;
  readonly className?: string;
}

/** A list's search in its filter bar, in `compact` density; `Esc` clears it. */
export function SearchField({
  label,
  value,
  onChange,
  slashShortcut = true,
  className,
}: SearchFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  useShortcut(
    { key: "/" },
    () => {
      input.current?.focus();
    },
    slashShortcut,
  );
  return (
    <AriaSearchField
      aria-label={label}
      value={value}
      onChange={onChange}
      className={cx("relative w-60 max-w-full", className)}
    >
      <Search
        aria-hidden="true"
        size={16}
        strokeWidth={1.75}
        className="pointer-events-none absolute start-2 top-1/2 -translate-y-1/2 text-text-muted"
      />
      <Input
        ref={input}
        {...(slashShortcut ? { "aria-keyshortcuts": "/" } : {})}
        className={cx(
          "h-7 w-full rounded-sm border border-field-border bg-field-bg ps-8 pe-8 text-sm text-field-text [&::-webkit-search-cancel-button]:hidden",
          FOCUS_RING,
        )}
      />
      {slashShortcut ? (
        <Kbd
          shortcut="/"
          className="pointer-events-none absolute end-1.5 top-1/2 -translate-y-1/2 text-text-secondary"
        />
      ) : null}
    </AriaSearchField>
  );
}
