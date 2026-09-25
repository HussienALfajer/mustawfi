# 0024. Visual design: "Ink and paper" — calm, precise, information-dense; ink-blue accent, paper neutrals, brass double rule; IBM Plex Sans Arabic; three densities; an explicit list of patterns to avoid

- Status: Accepted (reopened on 2026-09-25 after the A2 session, then accepted the same day after comparing identity previews)
- Date: 2026-09-25

## Context

Cashiers, accountants, and owners look at this interface for whole shifts. It is Arabic and RTL, full of figures in two currencies, used with a keyboard at the till and with fingers on tablets, in light and at night. Mustawfi is a product sold through resellers and needs an identity of its own, endorsed by Vertex System.

The user's related project `D:\vertex-suite` has a mature design-system specification (`docs/design-system.md`, v1.17). It was reviewed as a **reference for method** only; by the user's decision, no code is copied from it. Its palette is a literal import of a third-party proprietary design system's published values, and its own §4.6 lists four sub-4.5:1 text pairs and a 1.57:1 field border that it accepts as exceptions. Mustawfi does not reuse those values.

Before accepting, the user compared previews of the candidate identities on the same accounting screen, in light and dark, with contrast measured in the page:

- "Ink and paper";
- an identity built from the official Syrian state palette (July 2025);
- vertex-suite's palette;
- "Pine and sand";
- three refinements of "Ink and paper" (indigo, Prussian blue with copper, bound ledger).

The user chose **"Ink and paper" as proposed**.

## Decision

**Direction:** calm, precise, information-dense. A warm neutral ground (never stark white, never cold grey), one accent reserved for action and focus, semantic colours used only for meaning, hierarchy made by space and type rather than borders and boxes. It should read as a professional instrument an accountant trusts.

**Tokens:** four layers — primitive → alias → semantic → component. Screens may name semantic tokens only. CSS custom properties are prefixed `--mf-`, and Tailwind v4 consumes them through `@theme`. Switching axes: `data-theme` (light, dark, system) and `data-density`. Light and dark are equals: one token set, two value sets.

**Palette: "Ink and paper".** An OKLCH generator in `packages/ui` builds the full ramps and tints from these anchors and checks every pair. Anchors (light theme):

| Role | Value | Measured |
|---|---|---|
| Accent — **ink** (buttons, links, focus, selection) | `#2B4A66`, hover `#1F3850` | White on it 9.2:1 |
| Page — **paper** | `#F7F7F5` | |
| Surface | `#FFFFFF` | |
| Sunken rows and panels — **ledger** | `#F0EBE3` family | |
| Text | `#2C2F38` | 12.5:1 on paper |
| Secondary text | `#5C6370` | 5.6:1 |
| Muted text | `#6B717C` | 4.6:1 |
| Field border | `#8A9099` | 3.2:1 on surface |
| Signature — **brass** | `#C9A227` | Decorative only |
| Positive | `#2F7A4D` on tint `#EAF5EE` | 4.7:1 (the preview's tint `#E3F1E8` measured 4.49 and is replaced) |
| Negative | `#B3261E` | 6.5:1 |
| Warning | `#8A5A00` | 5.2:1 on its tint |

- Neutrals are warm and paper-like.
- The dark theme is **designed, not inverted**. The generator derives it from the same anchors: ink becomes a light ink blue (around `#8DB3D9`) carrying dark text, and the paper becomes a deep blue-grey. The user approves the dark values on the preview page in slice 9 of the walking skeleton.
- Semantic roles: success/positive (green), danger/negative (red), warning (amber), info (teal). Green and red keep their meaning in charts as well, and are never used for decoration.
- **Brand signature:** a brass **double rule** under a document's final total — the accounting convention for "closed and balanced" — also used in the product mark. Brass is never used for text or for status.
- **No contrast exceptions:** text at least 4.5:1 at every size (no large-text relaxation, because Arabic joins are thinner than Latin strokes); non-text elements and control boundaries, including field borders, at least 3:1. A CI test measures every pair and fails the build.
- The generator reproduces the anchors above exactly. The user reviews the full ramps and the dark theme on a preview page in the walking skeleton.

**Tenant brand:** a tenant's own colour appears only on the sign-in screen, printed document headers, and the POS idle screen. Its text colour is computed; a colour that cannot reach 4.5:1 with either white or near-black text is refused with an explanation. It never drives interaction.

**Product mark:** the Arabic wordmark «مستوفي» with the brass double-rule signature, endorsed "من Vertex System". The final mark is a designer's job; a placeholder is used until then.

**Typography:** IBM Plex Sans Arabic for the interface, IBM Plex Sans for Latin runs, IBM Plex Mono for codes, IMEIs, and document numbers. All are SIL OFL and bundled with the app, never loaded from a CDN. Minimum size 12px (Arabic dots merge below it). Line heights 1–2px taller than a Latin scale. `tabular-nums` on every figure in a column. No italics. Weights: 400 body, 500 labels, 600 totals and headings, 700 page titles only. Tabular figures and legibility on a 203 dpi thermal raster are verified in the skeleton.

**Density:** three levels, set at the app root.
- `compact` — grids, reports, ledgers.
- `comfortable` — forms and settings; the default.
- `touch` — POS and tablets; every target at least 48×48 px, checked by an automated test.

Corners nearly square (2–4px on controls). Shadows only on floating layers. Motion 120–200 ms, never delaying a keystroke, respecting reduced-motion settings.

**Direction and numbers:** `dir="rtl"` is the default, not a mode. Only logical CSS properties (lint bans `ml-`, `mr-`, `left-`, `text-left`…). Machine text — document numbers, IMEIs, codes, formats — is an LTR island with `unicode-bidi: isolate`, so `K7-INV-000123` never displays reordered. Numeric columns align to the end with decimal alignment. An amount never appears without its currency, and a negative amount carries a sign as well as the danger colour.

**Patterns to avoid** (a review finding when they appear):

1. Colour as the only signal (status, negative amounts, chart series).
2. Gradients, glassmorphism, glow, neon, and decorative illustration on working screens.
3. The generic SaaS look: gradient heroes, card grids for everything, big rounded corners, emoji.
4. Essential information or actions available only on hover (tablets have no hover).
5. A modal on top of a modal; wizards for tasks that fit one form.
6. A toast as the only report of a failure that matters (sync, print, posting); those need persistent state on screen.
7. Spinners that block the UI waiting for the network, or loading states that don't say whether the app is offline.
8. Disabled buttons without a reason; prefer an enabled control that explains the refusal.
9. Icon-only buttons for critical or destructive actions.
10. Truncated amounts or names without the full value available.
11. Physical left/right styling, numbers that flip with the layout, mixed alignment in numeric columns.
12. Confirmation dialogs on routine actions — and destructive actions (void, drawer open without sale) on a single unmodified key.
13. Placeholders used as labels; the browser's own validation messages (not Arabic, not translatable).
14. Paginated POS search results; infinite scroll in reports (use virtualized tables with a totals row).

**The design-system document** (`docs/design/design-system.md`) is written in the walking skeleton from this ADR, then changes only by recorded decision.

## Consequences

- The interface gets its own identity and a verifiable accessibility floor, not inherited exceptions.
- Generated colours can be regenerated and re-verified whenever the accent changes.
- The light anchors are fixed; the full ramps and the dark theme wait for the user's review of the preview page in the skeleton.

## Alternatives considered

- **Vertex-suite's palette as is** — visual consistency with the other project, but copied from a third party, below its own contrast floor in five places, and with no product colour.
- **Official Syrian identity palette** (pine `#126E70`, sand, mulberry, Qasioun gold `#B9A77A`, flag green and red) — distinctive and local. But the product would look like a government service, the palette is tied to a political moment, commercial use of state symbols may be restricted, and several official values fail text contrast.
- **"Pine and sand"** (a Syrian-inspired teal `#0F6466` with sand neutrals) — scored highest in the comparison, but the user preferred ink blue.
- **Refined ink variants** — indigo `#33408F` with ruled tables; Prussian blue `#1B4F72` with a copper ledger-margin rule; a navy "bound ledger" frame `#1E2B3C` with ivory pages. All passed contrast; the user chose the original.
- **A full ledger look** (ruled lines everywhere, monospaced figures) — the user rejected a ledger-style direction in vertex-suite on 2026-09-13; only the double-rule signature is kept here.
- **Friendly and colourful** — attractive in a demo, but colours lose their meaning and tire the eye over a shift.
- **Dark, high-contrast POS style** — right for a till only; kept possible as the dark theme of the same tokens.
