import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, hexToOklch, oklchToHex } from "./color.ts";
import { checkContrast, CONTRAST_PAIRS, DECORATIVE_TOKENS, MIN_TEXT } from "./contrast.ts";
import { generateTailwindThemeCss, generateTokenCss, themeDeclarations } from "./css.ts";
import { ANCHORS, generatePalette, generateRamp, RAMP_SPECS, STEPS } from "./palette.ts";
import { DENSITIES, MIN_FONT_SIZE, MIN_TOUCH_TARGET, TYPE_SCALE } from "./scale.ts";
import { COMPONENT_TOKENS, resolveTheme, SEMANTIC_TOKENS, THEMES } from "./themes.ts";

const palette = generatePalette();
const light = resolveTheme(palette, THEMES.light);
const dark = resolveTheme(palette, THEMES.dark);

describe("colour math", () => {
  it("round-trips every anchor through OKLCH exactly", () => {
    for (const hex of Object.values(ANCHORS)) expect(oklchToHex(hexToOklch(hex))).toBe(hex);
  });

  it("measures WCAG contrast as ADR-0024 reports it", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 6);
    expect(contrastRatio("#FFFFFF", ANCHORS.ink)).toBeCloseTo(9.2, 1);
    expect(contrastRatio(ANCHORS.text, ANCHORS.paper)).toBeCloseTo(12.5, 1);
    expect(contrastRatio(ANCHORS.fieldBorder, ANCHORS.surface)).toBeCloseTo(3.2, 1);
  });

  it("maps out-of-gamut colours into sRGB by losing chroma only", () => {
    const hex = oklchToHex({ l: 0.7, c: 0.4, h: 150 });
    const fitted = hexToOklch(hex);
    expect(fitted.l).toBeCloseTo(0.7, 2);
    expect(Math.abs(fitted.h - 150)).toBeLessThan(2);
    expect(fitted.c).toBeLessThan(0.4);
  });
});

describe("palette generator", () => {
  it("reproduces every anchor exactly at its step", () => {
    for (const spec of RAMP_SPECS) {
      for (const [step, hex] of Object.entries(spec.pins)) {
        expect(palette[spec.name][Number(step) as keyof (typeof palette)["ink"]]).toBe(hex);
      }
    }
  });

  it("uses every anchor of ADR-0024", () => {
    const pinned = new Set(RAMP_SPECS.flatMap((spec) => Object.values(spec.pins)));
    const fixed = new Set<string>([ANCHORS.paper, ANCHORS.surface]);
    for (const hex of Object.values(ANCHORS)) expect(pinned.has(hex) || fixed.has(hex)).toBe(true);
  });

  it("puts the anchors in the light theme where the ADR assigns them", () => {
    expect(light).toMatchObject({
      accent: ANCHORS.ink,
      "accent-hover": ANCHORS.inkHover,
      "text-accent": ANCHORS.ink,
      page: ANCHORS.paper,
      surface: ANCHORS.surface,
      text: ANCHORS.text,
      "text-secondary": ANCHORS.textSecondary,
      "text-muted": ANCHORS.textMuted,
      "border-field": ANCHORS.fieldBorder,
      signature: ANCHORS.brass,
      "text-positive": ANCHORS.positive,
      "positive-tint": ANCHORS.positiveTint,
      "text-negative": ANCHORS.negative,
      "text-warning": ANCHORS.warning,
      "text-on-accent": "#FFFFFF",
    });
    expect(palette.ledger[100]).toBe(ANCHORS.ledger);
  });

  it("derives the dark accent near the ADR's light ink blue (#8DB3D9)", () => {
    const target = hexToOklch("#8DB3D9");
    const accent = hexToOklch(dark.accent);
    expect(Math.abs(accent.l - target.l)).toBeLessThan(0.02);
    expect(Math.abs(accent.c - target.c)).toBeLessThan(0.01);
    expect(Math.abs(accent.h - target.h)).toBeLessThan(5);
  });

  it("makes every ramp strictly darker step by step", () => {
    for (const ramp of Object.values(palette)) {
      const lightness = STEPS.map((step) => hexToOklch(ramp[step]).l);
      for (let i = 1; i < lightness.length; i += 1) {
        expect(lightness[i]).toBeLessThan(lightness[i - 1]!);
      }
    }
  });

  it("refuses anchors out of lightness order", () => {
    expect(() => generateRamp({ name: "ink", pins: { 300: "#2B4A66", 700: "#E4EEF7" } })).toThrow(
      /darker/,
    );
  });
});

describe("contrast (ADR-0024: no exceptions)", () => {
  it.each([
    ["light", light],
    ["dark", dark],
  ] as const)("passes every pair in the %s theme", (_name, theme) => {
    const failing = checkContrast(theme).filter((result) => !result.passes);
    expect(failing).toEqual([]);
  });

  it("covers every semantic token that is not decorative", () => {
    const covered = new Set(CONTRAST_PAIRS.flatMap((pair) => [pair.foreground, pair.background]));
    for (const token of SEMANTIC_TOKENS) {
      expect(covered.has(token) !== DECORATIVE_TOKENS.includes(token)).toBe(true);
    }
  });

  it("holds text pairs to 4.5:1 at every size, non-text to 3:1", () => {
    for (const result of checkContrast(light)) {
      expect(result.minimum).toBe(result.kind === "text" ? MIN_TEXT : 3);
    }
  });

  it("fails on a fixture pair below the floor", () => {
    // The field border is a 3:1 boundary colour; as text it must be refused.
    const [result] = checkContrast(light, [
      { foreground: "border-field", background: "page", kind: "text" },
    ]);
    expect(result?.passes).toBe(false);
    expect(result?.ratio).toBeLessThan(MIN_TEXT);
  });

  it("fails when a theme value drifts below the floor", () => {
    const drifted = { ...light, "text-muted": palette.graphite[400] };
    expect(checkContrast(drifted).some((result) => !result.passes)).toBe(true);
  });
});

describe("type and density", () => {
  it("never goes below the minimum font size", () => {
    for (const { size } of Object.values(TYPE_SCALE))
      expect(size).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
    for (const density of Object.values(DENSITIES)) {
      expect(density.fontSize).toBeGreaterThanOrEqual(MIN_FONT_SIZE);
    }
  });

  it("keeps every touch target at least 48×48", () => {
    expect(DENSITIES.touch.controlHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(DENSITIES.touch.rowHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  it("sets Arabic line heights taller than the font size", () => {
    for (const { size, lineHeight } of Object.values(TYPE_SCALE)) {
      expect(lineHeight - size).toBeGreaterThanOrEqual(6);
    }
  });
});

describe("token stylesheet", () => {
  const css = generateTokenCss(palette);

  it("is committed exactly as the generator writes it (run tokens:generate)", () => {
    const committed = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
    expect(committed.replaceAll("\r\n", "\n")).toBe(css);
  });

  it("commits the Tailwind theme exactly as the generator writes it (run tokens:generate)", () => {
    const committed = readFileSync(new URL("../styles/theme.css", import.meta.url), "utf8");
    expect(committed.replaceAll("\r\n", "\n")).toBe(generateTailwindThemeCss());
  });

  it("gives Tailwind every semantic and component token, and no primitive or raw colour", () => {
    const theme = generateTailwindThemeCss();
    for (const token of SEMANTIC_TOKENS) {
      expect(theme).toContain(`--color-${token}: var(--mf-color-${token});`);
    }
    for (const name of Object.keys(COMPONENT_TOKENS)) {
      expect(theme).toContain(`--color-${name}: var(--mf-${name});`);
    }
    expect(theme).toContain("--color-*: initial;");
    expect(theme).not.toMatch(/var\(--mf-[a-z]+-\d+\)/);
    expect(theme).not.toMatch(/#[0-9A-Fa-f]{3,8}\b/);
  });

  it("defines every semantic token in both themes through primitives only", () => {
    for (const theme of ["light", "dark"] as const) {
      const declarations = themeDeclarations(theme).join("\n");
      for (const token of SEMANTIC_TOKENS) {
        expect(declarations).toMatch(
          new RegExp(`--mf-color-${token}: var\\(--mf-[a-z]+(-\\d+)?\\);`),
        );
      }
      expect(declarations).not.toMatch(/#[0-9A-F]{6}/);
    }
  });

  it("switches on data-theme and data-density, following the OS for data-theme=system", () => {
    expect(css).toContain('[data-theme="dark"] {');
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\n {2}\[data-theme="system"\] \{/);
    expect(css).toContain('[data-density="compact"] {');
    expect(css).toContain('[data-density="touch"] {');
    for (const name of Object.keys(COMPONENT_TOKENS)) expect(css).toContain(`--mf-${name}:`);
  });
});
