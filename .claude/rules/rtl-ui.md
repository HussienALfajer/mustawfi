---
paths:
  - "apps/web/**"
  - "apps/desktop/**"
  - "apps/android/**"
  - "apps/admin/**"
  - "apps/portal/**"
  - "packages/ui/**"
  - "packages/i18n/**"
  - "core/*/src/client/**"
  - "modules/*/src/client/**"
  - "**/*.tsx"
  - "**/*.css"
---

# RTL user interface rules

Sources: ADR-0023 (client application stack), ADR-0024 (visual design direction), ADR-0018 (money), and `docs/design/design-system.md` (tokens, contrast pairs, and usage rules).

- `dir="rtl"` is the default, not a mode. Use logical CSS only (`ms-`, `me-`, `ps-`, `start-`, `text-start`); physical utilities (`ml-`, `mr-`, `left-`, `text-left`…) are a lint error.
- No user-facing string literal in code: every text goes through i18n keys (i18next, ICU messages, one namespace per module). V1 text is Arabic.
- Machine text — document numbers, IMEIs, codes, formats — is an LTR island with `unicode-bidi: isolate`, so `K7-INV-000123` never displays reordered.
- Amounts render through `Money`/`MoneyInput` on the kernel's `Money`, never `number`, and never without their currency. Numeric columns align to the end with decimal alignment and `tabular-nums`.
- Screens use semantic tokens only (`--mf-*` through Tailwind `@theme`), never primitive colours. Text contrast is at least 4.5:1 at every size; control boundaries at least 3:1. Only the foreground/background pairs in `packages/ui/src/tokens/contrast.ts` are allowed (for example, no muted text on a status tint).
- Behavior comes from React Aria Components; styling from `packages/ui`. Don't mix in a second component library.
- `touch` density (POS, tablets): every target at least 48×48 px. Minimum font size 12px. No italics.
- Avoid ADR-0024's listed patterns: colour as the only signal, a toast as the only report of a failure that matters (sync, print, posting), spinners that block on the network, disabled buttons without a reason, hover-only actions, icon-only destructive buttons, modal on modal.
- The UI must work offline: read through the local database and TanStack Query; show whether the app is offline instead of waiting on the server.
