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
 * The single-line fields of a form, in order: what `Enter` moves between. Buttons, checkboxes,
 * and disabled fields are skipped.
 */
function typingFields(form: HTMLFormElement): HTMLElement[] {
  return Array.from(form.querySelectorAll<HTMLElement>("input, textarea, select")).filter(
    (field) => isTypingTarget(field) && !field.hasAttribute("disabled"),
  );
}

function isPlainEnter(event: ReactKeyboardEvent<HTMLFormElement>): boolean {
  return event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.altKey;
}

/**
 * A settings or long form's `onKeyDown` (`screen-patterns.md`, keyboard): `Enter` in a
 * single-line field moves to the next field and never saves, not even from the last one —
 * `Ctrl+S` or the Save button saves. Pair it with `saveShortcutSubmits` when the form has no
 * screen-wide `Ctrl+S`.
 */
export function enterMovesToNextField(event: ReactKeyboardEvent<HTMLFormElement>): void {
  if (!isPlainEnter(event)) return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !isTypingTarget(target)) return;
  const fields = typingFields(event.currentTarget);
  event.preventDefault();
  fields[fields.indexOf(target) + 1]?.focus();
}

/**
 * A short form's `onKeyDown` when it has several fields (a sign-in step, a reset code with a
 * new password): `Enter` moves to the next field and submits from the last one, even when the
 * form's button sits outside it. A one-field form needs nothing: the browser's `Enter` submits.
 */
export function enterMovesThenSubmits(event: ReactKeyboardEvent<HTMLFormElement>): void {
  if (!isPlainEnter(event)) return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !isTypingTarget(target)) return;
  const form = event.currentTarget;
  const fields = typingFields(form);
  const next = fields[fields.indexOf(target) + 1];
  event.preventDefault();
  if (next === undefined) form.requestSubmit();
  else next.focus();
}

/**
 * `Ctrl+S` inside this form submits it: for a screen with several forms that each save on
 * their own (My account's security sections), where a screen-wide shortcut could not choose.
 */
export function saveShortcutSubmits(event: ReactKeyboardEvent<HTMLFormElement>): void {
  if (event.code !== "KeyS" || !(event.ctrlKey || event.metaKey) || event.altKey) return;
  event.preventDefault();
  event.currentTarget.requestSubmit();
}
