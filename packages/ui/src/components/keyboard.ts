import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef } from "react";

/** Whether the keystroke lands where the user types text, so a single-key shortcut must not fire. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (!(target instanceof HTMLInputElement)) return false;
  return !["button", "checkbox", "radio", "submit", "reset", "file"].includes(target.type);
}

export interface Shortcut {
  /** A letter (`"n"`, `"s"`, `"b"`, matched by physical key) or a character (`"/"`). */
  readonly key: string;
  /** Ctrl on Windows (or ⌘ on macOS). */
  readonly ctrl?: boolean;
}

/**
 * Letters match by physical key (`KeyS`), so they work whatever the keyboard layout: with the
 * Arabic layout, S types «س». Other keys (`/`) match by the character typed.
 */
function matchesKey(event: KeyboardEvent, key: string): boolean {
  if (/^[a-z]$/i.test(key)) return event.code === `Key${key.toUpperCase()}`;
  return event.key === key;
}

function matches(event: KeyboardEvent, shortcut: Shortcut): boolean {
  if (!matchesKey(event, shortcut.key)) return false;
  const ctrl = event.ctrlKey || event.metaKey;
  return shortcut.ctrl === true ? ctrl && !event.altKey : !ctrl && !event.altKey;
}

/**
 * Runs `handler` on `shortcut` anywhere on the page. A shortcut without Ctrl never fires while
 * the user types in a field; one with Ctrl does (`Ctrl+S` saves from inside the form).
 */
export function useShortcut(
  shortcut: Shortcut,
  handler: (event: KeyboardEvent) => void,
  enabled = true,
): void {
  const latest = useRef(handler);
  latest.current = handler;
  const { key, ctrl } = shortcut;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !matches(event, ctrl === true ? { key, ctrl } : { key }))
        return;
      if (ctrl !== true && isTypingTarget(event.target)) return;
      event.preventDefault();
      latest.current(event);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [key, ctrl, enabled]);
}

/**
 * A form's `onKeyDown`: `Enter` in a single-line field moves to the next field, and submits
 * from the last one (`screen-patterns.md`, keyboard).
 */
export function enterMovesToNextField(event: ReactKeyboardEvent<HTMLFormElement>): void {
  if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey) return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !isTypingTarget(target)) return;
  const fields = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>("input, textarea, select"),
  ).filter((field) => isTypingTarget(field) && !field.hasAttribute("disabled"));
  const next = fields[fields.indexOf(target) + 1];
  event.preventDefault();
  // The last field submits, even when the form's Save button sits outside it (a sticky footer).
  if (next === undefined) event.currentTarget.requestSubmit();
  else next.focus();
}
