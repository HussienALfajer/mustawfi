import { z } from "zod";

/** `name` with its ends trimmed and every run of white space inside it one plain space. */
export function collapseSpaces(name: string): string {
  return name.trim().replace(/\s+/gu, " ");
}

/**
 * What two record names are compared by: trimmed, spaces collapsed, and case-insensitive
 * (`core-foundation` slice 20). The database's unique indexes compare `lower(name)` over names
 * stored through `recordNameSchema`, which already collapses the spaces.
 */
export function nameKey(name: string): string {
  return collapseSpaces(name).toLowerCase();
}

/**
 * Whether `name` shows something: not only spaces, bidi marks (RLM, LRM, ALM), zero-width
 * characters, or control characters, which pass a trimmed length check but read as a blank
 * name in every list (QA slice 22).
 */
export function isVisibleName(name: string): boolean {
  return /[^\s\p{Cc}\p{Cf}]/u.test(name);
}

/**
 * The name of a record people pick from a list — a department, a role: 1–100 characters once
 * trimmed, stored with its spaces collapsed so that the unique index and people see one spelling.
 */
export const recordNameSchema = z
  .string()
  .transform(collapseSpaces)
  .pipe(z.string().min(1).max(100).refine(isVisibleName, "a name needs a visible character"));
