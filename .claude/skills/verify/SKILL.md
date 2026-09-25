---
name: verify
description: Run Mustawfi's full verification gate (pnpm verify) with output filtered to failures and summaries. Use before committing, before reporting a slice done, and after any change that could break build, format, lint, typecheck, boundaries, or tests.
effort: low
---

Run from the repository root:

```bash
pnpm verify:agent
```

It runs the same steps as `pnpm verify`, in the same order, stopping at the first failure (a test keeps the two lists equal). Each passing step prints one line; the failing step prints only its error lines and summary, then `verify: FAILED at <step>`. The full log of every step is in `node_modules/.cache/mustawfi-verify/<step>.log` — read it only when the condensed output is not enough, and search it rather than reading it whole.

After a failure:

1. Fix the cause in code. Never weaken a test, a lint rule, a boundary rule, or a CI step to get past it.
2. For a narrower loop while fixing, run only the failing part:
   - tests: `pnpm test:agent <path or name filter>` (failures and the summary only);
   - formatting: `pnpm format` (the edit hook already formats files you touch);
   - lint: `pnpm lint`; types: `pnpm typecheck`; boundaries: `pnpm check:boundaries`.
3. Run `pnpm verify:agent` again. The gate is passed only when it ends with `verify: PASSED`.

Report the command and its last line as evidence.
