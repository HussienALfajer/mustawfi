import { type Palette, type RampName, type Step } from "./palette.ts";

/**
 * Alias, semantic, and component layers (ADR-0024). Screens name semantic and component tokens
 * only; the alias layer says what a ramp is for, so a ramp can be swapped without touching the
 * semantic map.
 */

export const ALIASES = {
  accent: "ink",
  neutral: "graphite",
  ledger: "ledger",
  signature: "brass",
  success: "green",
  danger: "red",
  warning: "amber",
  info: "teal",
} as const satisfies Record<string, RampName>;

export type AliasName = keyof typeof ALIASES;

/** Fixed primitives outside the ramps: the paper page and the white surface. */
export const FIXED = { paper: "#F7F7F5", white: "#FFFFFF" } as const;
export type FixedName = keyof typeof FIXED;

export type TokenRef = { readonly alias: AliasName; readonly step: Step } | FixedName;

export const SEMANTIC_TOKENS = [
  // Backgrounds
  "page",
  "surface",
  "sunken",
  "selected",
  "accent",
  "accent-hover",
  "positive-tint",
  "negative-tint",
  "warning-tint",
  "info-tint",
  // Text
  "text",
  "text-secondary",
  "text-muted",
  "text-accent",
  "text-on-accent",
  "text-positive",
  "text-negative",
  "text-warning",
  "text-info",
  // Non-text
  "border-field",
  "focus-ring",
  "divider",
  "signature",
] as const;

export type SemanticToken = (typeof SEMANTIC_TOKENS)[number];

export type ThemeName = "light" | "dark";

export type ThemeMap = Record<SemanticToken, TokenRef>;

const ref = (alias: AliasName, step: Step): TokenRef => ({ alias, step });

export const THEMES: Record<ThemeName, ThemeMap> = {
  light: {
    page: "paper",
    surface: "white",
    // #F0EBE3 (ledger 100) is the family's anchor, but muted text (4.14:1) and the field border
    // (2.71:1) fail on it, so sunken rows use the family's lightest step.
    sunken: ref("ledger", 50),
    selected: ref("accent", 50),
    accent: ref("accent", 700),
    "accent-hover": ref("accent", 800),
    "positive-tint": ref("success", 50),
    "negative-tint": ref("danger", 50),
    "warning-tint": ref("warning", 50),
    "info-tint": ref("info", 50),
    text: ref("neutral", 800),
    "text-secondary": ref("neutral", 600),
    "text-muted": ref("neutral", 500),
    "text-accent": ref("accent", 700),
    "text-on-accent": "white",
    "text-positive": ref("success", 700),
    "text-negative": ref("danger", 700),
    "text-warning": ref("warning", 700),
    "text-info": ref("info", 700),
    "border-field": ref("neutral", 400),
    "focus-ring": ref("accent", 700),
    divider: ref("neutral", 100),
    signature: ref("signature", 400),
  },
  // Designed, not inverted: a deep blue-grey page, light ink carrying dark text.
  dark: {
    page: ref("neutral", 950),
    surface: ref("neutral", 900),
    sunken: ref("neutral", 950),
    selected: ref("accent", 900),
    accent: ref("accent", 400),
    "accent-hover": ref("accent", 300),
    "positive-tint": ref("success", 950),
    "negative-tint": ref("danger", 950),
    "warning-tint": ref("warning", 950),
    "info-tint": ref("info", 950),
    text: ref("neutral", 50),
    "text-secondary": ref("neutral", 200),
    "text-muted": ref("neutral", 300),
    "text-accent": ref("accent", 300),
    "text-on-accent": ref("neutral", 950),
    "text-positive": ref("success", 400),
    "text-negative": ref("danger", 400),
    "text-warning": ref("warning", 400),
    "text-info": ref("info", 400),
    "border-field": ref("neutral", 500),
    "focus-ring": ref("accent", 400),
    divider: ref("neutral", 800),
    signature: ref("signature", 400),
  },
};

/** Component tokens: named uses of semantic tokens, the same in every theme. */
export const COMPONENT_TOKENS: Record<string, SemanticToken> = {
  "button-primary-bg": "accent",
  "button-primary-bg-hover": "accent-hover",
  "button-primary-text": "text-on-accent",
  "field-bg": "surface",
  "field-border": "border-field",
  "field-text": "text",
  "row-alt-bg": "sunken",
  "row-selected-bg": "selected",
  "total-rule": "signature",
};

export function primitiveName(tokenRef: TokenRef): string {
  if (typeof tokenRef === "string") return tokenRef;
  return `${ALIASES[tokenRef.alias]}-${tokenRef.step}`;
}

export function resolveRef(palette: Palette, tokenRef: TokenRef): string {
  if (typeof tokenRef === "string") return FIXED[tokenRef];
  return palette[ALIASES[tokenRef.alias]][tokenRef.step];
}

export type ResolvedTheme = Record<SemanticToken, string>;

export function resolveTheme(palette: Palette, theme: ThemeMap): ResolvedTheme {
  return Object.fromEntries(
    SEMANTIC_TOKENS.map((token) => [token, resolveRef(palette, theme[token])]),
  ) as ResolvedTheme;
}
