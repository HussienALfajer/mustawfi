/** Joins class names, skipping empty ones. */
export function cx(...names: readonly (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/** The focus ring every control shows for keyboard focus (never for a pointer click). */
export const FOCUS_RING =
  "outline-none data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-focus-ring";
