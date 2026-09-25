import { contrastRatio } from "./color.ts";
import { type ResolvedTheme, type SemanticToken } from "./themes.ts";

/**
 * The contrast floor of ADR-0024, with no exceptions: text at least 4.5:1 at every size (no
 * large-text relaxation — Arabic joins are thinner than Latin strokes); non-text elements and
 * control boundaries at least 3:1.
 */
export const MIN_TEXT = 4.5;
export const MIN_NON_TEXT = 3;

export interface ContrastPair {
  readonly foreground: SemanticToken;
  readonly background: SemanticToken;
  readonly kind: "text" | "non-text";
}

const BACKGROUNDS = ["page", "surface", "sunken", "selected"] as const;
const TINTS = ["positive-tint", "negative-tint", "warning-tint", "info-tint"] as const;
const READING_TEXT = ["text", "text-secondary", "text-muted"] as const;
const COLOURED_TEXT = [
  "text-accent",
  "text-positive",
  "text-negative",
  "text-warning",
  "text-info",
] as const;

const pairs = (
  foregrounds: readonly SemanticToken[],
  backgrounds: readonly SemanticToken[],
  kind: ContrastPair["kind"],
): ContrastPair[] =>
  foregrounds.flatMap((foreground) =>
    backgrounds.map((background) => ({ foreground, background, kind })),
  );

/**
 * Every place a foreground token may sit. A pair missing here is a combination screens must
 * not use; `docs/design/design-system.md` lists the rules.
 */
export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ...pairs([...READING_TEXT, ...COLOURED_TEXT], BACKGROUNDS, "text"),
  // Alerts and status rows: body text on every tint, each status text on its own tint. Muted
  // text stays off tints: on the anchored positive tint it reaches only 4.39:1.
  ...pairs(["text", "text-secondary"], TINTS, "text"),
  { foreground: "text-positive", background: "positive-tint", kind: "text" },
  { foreground: "text-negative", background: "negative-tint", kind: "text" },
  { foreground: "text-warning", background: "warning-tint", kind: "text" },
  { foreground: "text-info", background: "info-tint", kind: "text" },
  ...pairs(["text-on-accent"], ["accent", "accent-hover"], "text"),
  // A field's boundary is measured against its own background, which is always `surface`.
  { foreground: "border-field", background: "surface", kind: "non-text" },
  ...pairs(["focus-ring", "accent"], BACKGROUNDS, "non-text"),
];

/** Tokens that carry no information and so need no contrast: never text, never status. */
export const DECORATIVE_TOKENS: readonly SemanticToken[] = ["divider", "signature"];

export interface ContrastResult extends ContrastPair {
  readonly ratio: number;
  readonly minimum: number;
  readonly passes: boolean;
}

export function checkContrast(
  theme: ResolvedTheme,
  contrastPairs: readonly ContrastPair[] = CONTRAST_PAIRS,
): ContrastResult[] {
  return contrastPairs.map((pair) => {
    const ratio = contrastRatio(theme[pair.foreground], theme[pair.background]);
    const minimum = pair.kind === "text" ? MIN_TEXT : MIN_NON_TEXT;
    return { ...pair, ratio, minimum, passes: ratio >= minimum };
  });
}
