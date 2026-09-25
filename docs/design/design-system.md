# Mustawfi design system — "Ink and paper"

- Source decision: ADR-0024 (visual design direction), with ADR-0023 (client stack) and ADR-0018 (money).
- Written in walking-skeleton slice 9 (2026-09-25). Palette, full ramps, dark theme, and the rules below approved by the user on the preview page the same day.
- This document changes only by recorded decision (an ADR or a unit spec's deviation note).
- How screens are laid out and behave — the frame, patterns, keyboard, tables, forms, components, code structure — is in `screen-patterns.md`.

## Where things live

| What | Where |
|---|---|
| Colour math (OKLCH, gamut mapping, WCAG contrast) | `packages/ui/src/tokens/color.ts` |
| Anchors and ramp generator (primitive layer) | `packages/ui/src/tokens/palette.ts` |
| Alias, semantic, and component layers; light and dark maps | `packages/ui/src/tokens/themes.ts` |
| Contrast pairs and the checker | `packages/ui/src/tokens/contrast.ts` |
| Type, density, radii, motion | `packages/ui/src/tokens/scale.ts` |
| Generated stylesheet (committed, never edited by hand) | `packages/ui/src/styles/tokens.css`, exported as `@mustawfi/ui/tokens.css` |
| Preview page (generated, not committed) | `pnpm --filter @mustawfi/ui tokens:generate` → `packages/ui/preview/index.html` |
| Tests | `packages/ui/src/tokens/tokens.test.ts` |

To change a colour: edit the anchor, map, or pair in TypeScript, run `tokens:generate`, run the tests, and review the preview. The test fails while `tokens.css` differs from the generator's output.

## Direction

Calm, precise, information-dense — a professional instrument an accountant trusts. A warm neutral ground (never stark white as the page, never cold grey), one accent reserved for action and focus, semantic colours only for meaning, hierarchy by space and type rather than borders and boxes.

## Token layers

All custom properties are prefixed `--mf-`. Screens name **semantic** and **component** tokens only.

1. **Primitive** — the generated ramps `--mf-{ramp}-{step}` (steps 50, 100, 200 … 900, 950) plus the fixed `--mf-paper` (`#F7F7F5`) and `--mf-white` (`#FFFFFF`).
2. **Alias** — what a ramp is for: `accent` → ink, `neutral` → graphite, `ledger` → ledger, `signature` → brass, `success` → green, `danger` → red, `warning` → amber, `info` → teal (`--mf-accent-700` …).
3. **Semantic** — `--mf-color-*`, one value per theme (table below).
4. **Component** — named uses of semantic tokens: `--mf-button-primary-bg`, `-bg-hover`, `-text`, `--mf-field-bg`, `--mf-field-border`, `--mf-field-text`, `--mf-row-alt-bg`, `--mf-row-selected-bg`, `--mf-total-rule`.

Switching axes, on the app root or any subtree: `data-theme` = `light` | `dark` | `system` (follows `prefers-color-scheme`), and `data-density` = `compact` | `comfortable` | `touch`. Light and comfortable are the defaults. Tailwind v4 consumes them through the generated `@theme` in `packages/ui/src/styles/theme.css` (`@mustawfi/ui/theme.css`), which clears Tailwind's own palette, fonts, sizes, radii, and shadows: screens can name only semantic and component tokens (`bg-surface`, `text-text-muted`, `border-field-border`, `h-control`, `px-pad-inline`, `gap-density-gap`, `text-density`).

## Palette

### Anchors (ADR-0024, reproduced exactly)

| Role | Value | Ramp step |
|---|---|---|
| Accent — ink | `#2B4A66`, hover `#1F3850` | ink 700, 800 |
| Page — paper | `#F7F7F5` | fixed |
| Surface | `#FFFFFF` | fixed |
| Ledger family | `#F0EBE3` | ledger 100 |
| Text / secondary / muted | `#2C2F38` / `#5C6370` / `#6B717C` | graphite 800 / 600 / 500 |
| Field border | `#8A9099` | graphite 400 |
| Signature — brass | `#C9A227` | brass 400 |
| Positive, tint | `#2F7A4D`, `#EAF5EE` | green 700, 50 |
| Negative | `#B3261E` | red 700 |
| Warning | `#8A5A00` | amber 700 |

Info has no anchor: its ramp is generated from a teal seed, OKLCH(0.50 0.085 200), at step 700.

### How the ramps are generated

Each step has a default OKLCH lightness (50 = 0.985 … 950 = 0.24). A ramp's anchors bend that curve piecewise-linearly so each anchored step lands exactly on its anchor, with white and black as fixed ends. Each anchor also gives a hue and a peak chroma (its chroma divided by a lightness weight that is full around L 0.6 and fades toward white and black); steps between anchors interpolate both, steps beyond them take the nearest anchor's. Out-of-gamut colours lose chroma, never lightness or hue. The tests check that every anchor is reproduced, that every ramp gets strictly darker, and that anchors out of order are refused.

### Semantic tokens

| Token | Light | Dark |
|---|---|---|
| `page` | paper `#F7F7F5` | graphite 950 |
| `surface` | white | graphite 900 |
| `sunken` | ledger 50 | graphite 950 |
| `selected` | ink 50 | ink 900 |
| `accent` / `accent-hover` | ink 700 / 800 | ink 400 / 300 |
| `positive-tint`, `negative-tint`, `warning-tint`, `info-tint` | step 50 of each | step 950 of each |
| `text` / `text-secondary` / `text-muted` | graphite 800 / 600 / 500 | graphite 50 / 200 / 300 |
| `text-accent` | ink 700 | ink 300 |
| `text-on-accent` | white | graphite 950 |
| `text-positive`, `text-negative`, `text-warning`, `text-info` | step 700 of each | step 400 of each |
| `border-field` | graphite 400 | graphite 500 |
| `focus-ring` | ink 700 | ink 400 |
| `divider` (decorative) | graphite 100 | graphite 800 |
| `signature` (decorative) | brass 400 | brass 400 |

In dark, `sunken` equals `page`: alternate and sunken rows show only inside a `surface` container, which is where tables sit.

The dark theme is designed from the same anchors, not inverted: a deep blue-grey page, and a light ink blue accent (ink 400, near the ADR's `#8DB3D9`) that carries dark text. The preview page lists the resolved hex values.

## Contrast — no exceptions

- Text at least **4.5:1 at every size** (no large-text relaxation: Arabic joins are thinner than Latin strokes).
- Non-text elements and control boundaries at least **3:1**.
- `CONTRAST_PAIRS` lists every place a foreground token may sit; the test checks every pair in both themes and fails the build on any shortfall. Every semantic token is in a pair unless it is declared decorative (`divider`, `signature`).

The pairs are the usage rules. Combinations not in the list are not allowed on screens:

| Foreground | Allowed on |
|---|---|
| `text`, `text-secondary` | `page`, `surface`, `sunken`, `selected`, and every tint |
| `text-muted` | `page`, `surface`, `sunken`, `selected` — **never on a tint** (4.39:1 on the anchored positive tint) |
| `text-accent`, `text-positive`, `text-negative`, `text-warning`, `text-info` | `page`, `surface`, `sunken`, `selected`; each status text also on its own tint |
| `text-on-accent` | `accent`, `accent-hover` |
| `focus-ring`, `accent` (as a control fill) | `page`, `surface`, `sunken`, `selected` (3:1) |
| `border-field` | measured against the field's own background, which is **always `surface`** (3.22:1; against paper it is 2.998:1) |

**Sunken rows use ledger 50, not the `#F0EBE3` anchor.** On `#F0EBE3`, muted text reaches 4.14:1 and the field border 2.71:1, so sunken rows and panels use the family's lightest step; `#F0EBE3` stays in the ramp. Approved by the user on 2026-09-25.

## Typography

- **IBM Plex Sans Arabic** for the interface, **IBM Plex Sans** for Latin runs, **IBM Plex Mono** for codes, IMEIs, and document numbers. SIL OFL, bundled through `@fontsource` packages — never loaded from a CDN in the product.
- Scale (px, size/line height): xs 12/18, sm 14/22, md 16/26, lg 18/28, xl 20/30, 2xl 24/34, 3xl 30/40. Line heights run 2px taller than a Latin scale. Nothing smaller than **12px** (Arabic dots merge below it).
- Weights: 400 body, 500 labels, 600 totals and headings, 700 page titles only. No italics.
- `tabular-nums` on every figure in a column.
- Legibility on a 203 dpi thermal raster is checked in slice 14 (receipt printing).

## Density

| | `compact` | `comfortable` (default) | `touch` |
|---|---|---|---|
| Use | grids, reports, ledgers | forms, settings | POS, tablets |
| Control height | 28 | 36 | 48 |
| Row height | 28 | 40 | 56 |
| Body text | 13/20 | 14/22 | 16/26 |
| Padding inline / block | 8 / 4 | 12 / 8 | 16 / 12 |
| Gap | 8 | 12 | 12 |

Variables: `--mf-control-height`, `--mf-row-height`, `--mf-density-font-size`, `--mf-density-line-height`, `--mf-padding-inline`, `--mf-padding-block`, `--mf-gap`. In `touch`, every target is at least **48×48 px**; the token test checks the density values, and a Playwright check measures rendered controls in `touch` density (`apps/web/e2e`).

## Shape and motion

- Corners nearly square: `--mf-radius-sm` 2px, `--mf-radius-md` 4px.
- Shadows only on floating layers: `--mf-shadow-floating`.
- Motion 120–200 ms (`--mf-duration-fast`, `--mf-duration-normal`), never delaying a keystroke; both are 0 under `prefers-reduced-motion`.

## Direction and numbers

- `dir="rtl"` is the default, not a mode. Only logical CSS properties (`margin-inline-start`, `ms-`, `text-start`…); physical ones are a lint error (`mustawfi/no-physical-direction`; `.css` files are not linted).
- Machine text — document numbers, IMEIs, codes, formats — is an LTR island with `unicode-bidi: isolate`, so `K7-INV-000123` never displays reordered.
- Numeric columns align to the end, with decimal alignment and `tabular-nums`.
- An amount never appears without its currency. A negative amount carries a minus sign **and** the negative colour.
- Digits are Latin by default, with Arabic-Indic as a per-user display setting (`DigitShapeContext` in `packages/i18n`); stored values and parsing never change. Currency labels: SYP «ل.س», USD «$», any other currency shows its ISO code (`ui` namespace).

## Brand

- **Signature:** a brass double rule under a document's final total (`border-block-end: 4px double var(--mf-total-rule)`) — the accounting convention for "closed and balanced". Also used in the product mark. Brass is never text and never status.
- **Product mark:** the Arabic wordmark «مستوفي» with the double rule, endorsed "من Vertex System". A placeholder until a designer delivers the final mark.
- **Tenant brand colour** appears only on the sign-in screen, printed document headers, and the POS idle screen. Its text colour is computed; a colour that cannot reach 4.5:1 with white or near-black text is refused with an explanation. It never drives interaction.

## Patterns to avoid

A review finding when they appear (ADR-0024):

1. Colour as the only signal (status, negative amounts, chart series).
2. Gradients, glassmorphism, glow, neon, decorative illustration on working screens.
3. The generic SaaS look: gradient heroes, card grids for everything, big rounded corners, emoji.
4. Essential information or actions available only on hover.
5. A modal on a modal; wizards for tasks that fit one form.
6. A toast as the only report of a failure that matters (sync, print, posting).
7. Spinners that block the UI on the network, or loading states that hide whether the app is offline.
8. Disabled buttons without a reason; prefer an enabled control that explains the refusal.
9. Icon-only buttons for critical or destructive actions.
10. Truncated amounts or names without the full value available.
11. Physical left/right styling, numbers that flip with the layout, mixed alignment in numeric columns.
12. Confirmation dialogs on routine actions — and destructive actions on a single unmodified key.
13. Placeholders used as labels; the browser's own validation messages.
14. Paginated POS search results; infinite scroll in reports.
