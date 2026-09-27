import { cx, FOCUS_RING, FOCUS_RING_INSET } from "./cx.ts";

/**
 * One interaction language for everything clickable (`screen-patterns.md`, core-foundation
 * slice 19), written once here and used by every component. Never colour alone:
 *
 * - *hover* tints the item and shows the start-side bar at partial strength;
 * - *pressed* darkens one step, and secondary text turns to body text;
 * - *selected* keeps the full accent bar, a stronger tint, and semibold accent text;
 * - *focus-visible* is a 2 px ring with an offset, distinct from hover.
 *
 * Clickable things show `cursor: pointer`. Colours change over `--mf-duration-fast` (120 ms),
 * which is 0 under `prefers-reduced-motion`. Hover never carries information of its own.
 */

/** The pointer and the colour transition every clickable thing takes. */
export const PRESSABLE = "cursor-pointer transition-colors data-[disabled]:cursor-default";

/** The start-side bar of an item in a list: 3 px, inset from the item's ends. */
const BAR =
  "before:pointer-events-none before:absolute before:inset-y-1 before:start-0 before:w-[3px] before:rounded-sm before:transition-colors";

/**
 * A clickable item in a list on React Aria (a menu item, a list box option): its states come
 * from React Aria's `data-*` attributes. `data-[focused]` is the item the pointer or the arrow
 * keys are on, so it looks like hover; keyboard focus adds the ring.
 */
export const ITEM_STATES = cx(
  "relative outline-none",
  PRESSABLE,
  BAR,
  "data-[hovered]:bg-state-hover-bg data-[hovered]:before:bg-state-bar-hover",
  "data-[focused]:bg-state-hover-bg data-[focused]:before:bg-state-bar-hover",
  "data-[pressed]:bg-state-pressed-bg data-[pressed]:text-text",
  "data-[selected]:bg-state-selected-bg data-[selected]:font-semibold data-[selected]:text-text-accent data-[selected]:before:bg-state-bar-selected",
  FOCUS_RING_INSET,
);

/**
 * The same states for a plain link (a navigation entry from the app's router): CSS pseudo
 * classes instead of React Aria's attributes, and the router's `aria-current="page"` as selected.
 * React Aria's attributes work too: the gallery shows each state by setting them, and the
 * navigation's own toggle is a React Aria button.
 */
export const LINK_ITEM_STATES = cx(
  "relative outline-none",
  PRESSABLE,
  BAR,
  "hover:bg-state-hover-bg hover:text-text hover:before:bg-state-bar-hover",
  "data-[hovered]:bg-state-hover-bg data-[hovered]:text-text data-[hovered]:before:bg-state-bar-hover",
  "active:bg-state-pressed-bg active:text-text data-[pressed]:bg-state-pressed-bg data-[pressed]:text-text",
  "aria-[current=page]:bg-state-selected-bg aria-[current=page]:font-semibold aria-[current=page]:text-text-accent aria-[current=page]:before:bg-state-bar-selected",
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2",
  FOCUS_RING,
);

/**
 * A table row the user can select: the bar is an inset shadow on the row's start edge (a row
 * has no box of its own for `::before`). Rows that cannot be selected get no hover.
 */
export const ROW_STATES = cx(
  PRESSABLE,
  "data-[hovered]:bg-state-hover-bg rtl:data-[hovered]:shadow-[inset_-3px_0_0_var(--mf-state-bar-hover)] ltr:data-[hovered]:shadow-[inset_3px_0_0_var(--mf-state-bar-hover)]",
  "data-[pressed]:bg-state-pressed-bg",
  "data-[selected]:bg-state-selected-bg rtl:data-[selected]:shadow-[inset_-3px_0_0_var(--mf-state-bar-selected)] ltr:data-[selected]:shadow-[inset_3px_0_0_var(--mf-state-bar-selected)]",
  FOCUS_RING_INSET,
);

/**
 * One option of a horizontal group (a segmented control, tabs): the bar sits on the block end,
 * under the label, as tabs carry it.
 */
export const SEGMENT_STATES = cx(
  PRESSABLE,
  "data-[hovered]:bg-state-hover-bg data-[hovered]:shadow-[inset_0_-2px_0_var(--mf-state-bar-hover)]",
  "data-[pressed]:bg-state-pressed-bg",
  "data-[selected]:bg-state-selected-bg data-[selected]:font-semibold data-[selected]:text-text-accent data-[selected]:shadow-[inset_0_-2px_0_var(--mf-state-bar-selected)]",
  FOCUS_RING_INSET,
);

/**
 * A small icon button inside another control (close a panel, reveal a password, copy): at
 * least one control height square, so `touch` density keeps 48 px. It has an accessible name.
 */
export const ICON_BUTTON = cx(
  "flex min-h-control min-w-control flex-none items-center justify-center rounded-md text-text-secondary",
  PRESSABLE,
  "data-[hovered]:bg-state-hover-bg data-[hovered]:text-text data-[pressed]:bg-state-pressed-bg data-[pressed]:text-text",
  FOCUS_RING,
);

/** A text link: underlined, a thicker underline on hover, the focus ring for the keyboard. */
export const TEXT_LINK = cx(
  "cursor-pointer rounded-sm text-text-accent underline underline-offset-4 transition-colors outline-none",
  "hover:decoration-2 active:text-text",
  "focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2",
);
