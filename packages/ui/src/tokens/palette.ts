import { hexToOklch, type Oklch, oklchToHex } from "./color.ts";

/**
 * Primitive layer (ADR-0024): tonal ramps generated in OKLCH from the "Ink and paper" anchors.
 * Every anchor is pinned to a step and reproduced exactly; the other steps are generated.
 */

export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type Step = (typeof STEPS)[number];

/** Default OKLCH lightness per step, before the ramp's pins bend it. */
const DEFAULT_LIGHTNESS: Record<Step, number> = {
  50: 0.985,
  100: 0.95,
  200: 0.91,
  300: 0.86,
  400: 0.78,
  500: 0.65,
  600: 0.56,
  700: 0.47,
  800: 0.39,
  900: 0.31,
  950: 0.24,
};

export type RampName = "ink" | "graphite" | "ledger" | "brass" | "green" | "red" | "amber" | "teal";

export interface RampSpec {
  readonly name: RampName;
  /** Anchors from ADR-0024, reproduced exactly at their step. */
  readonly pins: Partial<Record<Step, string>>;
  /** A ramp without an anchor (info teal) is generated from a seed colour at step 700. */
  readonly seed?: Oklch;
}

/** The anchors of ADR-0024, light theme. */
export const ANCHORS = {
  ink: "#2B4A66",
  inkHover: "#1F3850",
  paper: "#F7F7F5",
  surface: "#FFFFFF",
  ledger: "#F0EBE3",
  text: "#2C2F38",
  textSecondary: "#5C6370",
  textMuted: "#6B717C",
  fieldBorder: "#8A9099",
  brass: "#C9A227",
  positive: "#2F7A4D",
  positiveTint: "#EAF5EE",
  negative: "#B3261E",
  warning: "#8A5A00",
} as const;

export const RAMP_SPECS: readonly RampSpec[] = [
  { name: "ink", pins: { 700: ANCHORS.ink, 800: ANCHORS.inkHover } },
  {
    name: "graphite",
    pins: {
      400: ANCHORS.fieldBorder,
      500: ANCHORS.textMuted,
      600: ANCHORS.textSecondary,
      800: ANCHORS.text,
    },
  },
  { name: "ledger", pins: { 100: ANCHORS.ledger } },
  { name: "brass", pins: { 400: ANCHORS.brass } },
  { name: "green", pins: { 50: ANCHORS.positiveTint, 700: ANCHORS.positive } },
  { name: "red", pins: { 700: ANCHORS.negative } },
  { name: "amber", pins: { 700: ANCHORS.warning } },
  // Info has no anchor in ADR-0024: a teal seed at the lightness of the other status colours.
  { name: "teal", pins: {}, seed: { l: 0.5, c: 0.085, h: 200 } },
];

/**
 * How much chroma a step keeps relative to its peak, by lightness: full around the middle,
 * fading toward white and black so tints and shades stay quiet.
 */
function chromaWeight(lightness: number): number {
  const width = lightness > 0.6 ? 0.45 : 0.6;
  const bell = Math.max(0, 1 - ((lightness - 0.6) / width) ** 2);
  return bell * bell;
}

/** The chroma a colour's ramp would have at full weight. */
function peakChroma(color: Oklch): number {
  return color.c / Math.max(chromaWeight(color.l), 1e-3);
}

/**
 * Hue between two anchors along the shorter arc. A near-grey anchor has no meaningful hue, so
 * the other anchor's hue wins in proportion to its chroma.
 */
function interpolateHue(from: Oklch, to: Oklch, t: number): number {
  const delta = ((to.h - from.h + 540) % 360) - 180;
  const weightFrom = from.c * (1 - t);
  const weightTo = to.c * t;
  const share = weightFrom + weightTo === 0 ? t : weightTo / (weightFrom + weightTo);
  return (from.h + delta * share + 360) % 360;
}

/**
 * Generates one ramp. Lightness: the default targets, bent piecewise-linearly so each pinned
 * step lands on its anchor (white and black stay fixed ends). Colour: each anchor gives a peak
 * chroma (its chroma divided by `chromaWeight` at its lightness) and a hue; steps between two
 * anchors interpolate both, steps beyond the outer anchors take the nearest one's; the step's
 * chroma is the peak times `chromaWeight` at its lightness. Out-of-gamut colours lose chroma,
 * never lightness or hue.
 */
export function generateRamp(spec: RampSpec): Record<Step, string> {
  const pinned = STEPS.filter((step) => spec.pins[step] !== undefined).map((step) => ({
    step,
    hex: spec.pins[step] as string,
    color: hexToOklch(spec.pins[step] as string),
  }));
  if (pinned.length === 0) {
    if (!spec.seed) throw new Error(`Ramp ${spec.name} has neither anchors nor a seed.`);
    pinned.push({ step: 700, hex: "", color: spec.seed });
  }
  for (let i = 1; i < pinned.length; i += 1) {
    if (pinned[i]!.color.l >= pinned[i - 1]!.color.l) {
      throw new Error(`Ramp ${spec.name}: anchors must get darker as the step grows.`);
    }
  }

  // Lightness knots: default target → actual lightness.
  const knots = [
    { from: 1, to: 1 },
    ...pinned.map((pin) => ({ from: DEFAULT_LIGHTNESS[pin.step], to: pin.color.l })),
    { from: 0, to: 0 },
  ];
  const lightnessOf = (step: Step): number => {
    const target = DEFAULT_LIGHTNESS[step];
    for (let i = 1; i < knots.length; i += 1) {
      const upper = knots[i - 1]!;
      const lower = knots[i]!;
      if (target <= upper.from && target >= lower.from) {
        const t = upper.from === lower.from ? 0 : (upper.from - target) / (upper.from - lower.from);
        return upper.to + (lower.to - upper.to) * t;
      }
    }
    throw new Error(`Unreachable: lightness target ${target}`);
  };

  const ramp = {} as Record<Step, string>;
  for (const step of STEPS) {
    const pin = pinned.find((candidate) => candidate.step === step);
    if (pin?.hex) {
      ramp[step] = pin.hex;
      continue;
    }
    const lightness = lightnessOf(step);
    const lighter = pinned.filter((candidate) => candidate.color.l > lightness).at(-1);
    const darker = pinned.find((candidate) => candidate.color.l < lightness);
    let peak: number;
    let hue: number;
    if (lighter && darker) {
      const t = (lighter.color.l - lightness) / (lighter.color.l - darker.color.l);
      peak = peakChroma(lighter.color) + (peakChroma(darker.color) - peakChroma(lighter.color)) * t;
      hue = interpolateHue(lighter.color, darker.color, t);
    } else {
      const nearest = (lighter ?? darker ?? pin)!.color;
      peak = peakChroma(nearest);
      hue = nearest.h;
    }
    ramp[step] = oklchToHex({ l: lightness, c: peak * chromaWeight(lightness), h: hue });
  }
  return ramp;
}

export type Palette = Record<RampName, Record<Step, string>>;

export function generatePalette(specs: readonly RampSpec[] = RAMP_SPECS): Palette {
  return Object.fromEntries(specs.map((spec) => [spec.name, generateRamp(spec)])) as Palette;
}
