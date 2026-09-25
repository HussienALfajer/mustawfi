/**
 * Type, density, shape, and motion tokens (ADR-0024). Sizes are CSS pixels.
 */

/** The smallest font size anywhere: Arabic dots merge below it. */
export const MIN_FONT_SIZE = 12;

/** Every target in `touch` density is at least this many pixels on each side. */
export const MIN_TOUCH_TARGET = 48;

export const FONT_FAMILIES = {
  sans: '"IBM Plex Sans Arabic", "IBM Plex Sans", system-ui, sans-serif',
  mono: '"IBM Plex Mono", ui-monospace, monospace',
} as const;

export const FONT_WEIGHTS = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

/** Line heights run 2px taller than a Latin scale, for Arabic ascenders and dots. */
export const TYPE_SCALE = {
  xs: { size: 12, lineHeight: 18 },
  sm: { size: 14, lineHeight: 22 },
  md: { size: 16, lineHeight: 26 },
  lg: { size: 18, lineHeight: 28 },
  xl: { size: 20, lineHeight: 30 },
  "2xl": { size: 24, lineHeight: 34 },
  "3xl": { size: 30, lineHeight: 40 },
} as const;

export type DensityName = "compact" | "comfortable" | "touch";

export interface Density {
  /** Height of buttons and fields; also the minimum target size. */
  readonly controlHeight: number;
  /** Height of a table row. */
  readonly rowHeight: number;
  /** Body text size. */
  readonly fontSize: number;
  readonly lineHeight: number;
  /** Padding inside controls and cells, along the line and across it. */
  readonly paddingInline: number;
  readonly paddingBlock: number;
  /** Gap between neighbouring controls and form rows. */
  readonly gap: number;
}

export const DEFAULT_DENSITY: DensityName = "comfortable";

export const DENSITIES: Record<DensityName, Density> = {
  compact: {
    controlHeight: 28,
    rowHeight: 28,
    fontSize: 13,
    lineHeight: 20,
    paddingInline: 8,
    paddingBlock: 4,
    gap: 8,
  },
  comfortable: {
    controlHeight: 36,
    rowHeight: 40,
    fontSize: 14,
    lineHeight: 22,
    paddingInline: 12,
    paddingBlock: 8,
    gap: 12,
  },
  touch: {
    controlHeight: 48,
    rowHeight: 56,
    fontSize: 16,
    lineHeight: 26,
    paddingInline: 16,
    paddingBlock: 12,
    gap: 12,
  },
};

/** Corners nearly square. */
export const RADII = { sm: 2, md: 4 } as const;

/** 120–200 ms, never delaying a keystroke; zeroed under `prefers-reduced-motion`. */
export const DURATIONS = { fast: 120, normal: 200 } as const;

/** Shadows only on floating layers (menus, popovers, dialogs). */
export const FLOATING_SHADOW = "0 4px 16px rgb(0 0 0 / 0.16), 0 1px 3px rgb(0 0 0 / 0.12)";
