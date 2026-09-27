/** Joins class names, skipping empty ones. */
export function cx(...names: readonly (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/**
 * The focus ring every control shows for keyboard focus (never for a pointer click): a solid
 * 2 px ring with an offset. `outline-solid` is required with any variant: Tailwind v4's
 * `outline-none` sets the outline style to `none`, and `outline-2` alone keeps that style, so
 * the ring would never show. Class names stay literal, so Tailwind finds them.
 */
export const FOCUS_RING =
  "outline-none data-[focus-visible]:outline-solid data-[focus-visible]:outline-2 data-[focus-visible]:outline-focus-ring data-[focus-visible]:outline-offset-2";

/** The same ring drawn inside the element: rows, cells, and items that touch their neighbours. */
export const FOCUS_RING_INSET =
  "outline-none data-[focus-visible]:outline-solid data-[focus-visible]:outline-2 data-[focus-visible]:outline-focus-ring data-[focus-visible]:-outline-offset-2";
