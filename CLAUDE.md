@AGENTS.md

# Claude Code

Everything above is shared with other coding agents. This part applies to Claude Code only.

## Skills (the user invokes them)

- `/module-spec <spec-unit>` — spec session with the user; produces the unit spec and its slice plan.
- `/implement-slice <spec-unit> <n>` — build one slice end to end.
- `/close-module <spec-unit>` — close a finished unit.

## Subagents

- `spec-reviewer` — fresh-context review of a diff against the unit spec and the non-negotiables. Run it before reporting a slice done.
- Built-in `Explore` — wide codebase searches, so file dumps stay out of the main context.
- Bundled `/code-review` — correctness bugs in the current diff.
- Route verbose output (full test runs, long logs) through a subagent or filter it; bring back only what matters.

## Agent tooling

- `verify` skill — runs `pnpm verify:agent`, the full gate with filtered output. Use it for every verification step; it passes only on `verify: PASSED`.
- Hook (`.claude/settings.json`): every Edit or Write is formatted with Prettier through `tools/agent/src/format-edited-hook.ts`; files ignored by `.gitignore` or `.prettierignore` (Markdown) are left alone.
- Path-scoped rules in `.claude/rules/` (ledger, sync, tenancy, migrations, RTL UI) load when you read matching files. They summarize the ADRs they cite; the ADRs stay the source of truth. `tools/agent/src/agent-setup.test.ts` checks their paths and ADR references.

## Model and effort

- Work runs on Opus 5.5. Fable models are not available on this subscription — never suggest them.
- The user sets effort; you can't change it for the session. Each slice in a spec carries a recommended effort, and the **الخطوة التالية** line always includes the matching `/effort` command.
- When a fix stops at one layer (handler changed, caller not), first add a check that crosses both layers; only then recommend more effort.
- When stuck: sharpen or add a check → `high` → `xhigh` → `max` for a single step. If it still fails, stop and report under **ينتظرك**: hypotheses, what you tried, the evidence, and a proposal (a smaller slice or a sharper spec).

## Sessions and context

- One spec unit or one slice per session. Don't pick up unrelated work in the same session; propose it as the next step instead.
- The **الخطوة التالية** line names the session to open and the exact commands, for example:
  `جلسة جديدة ← /effort high ← /implement-slice core-money 3`
- Slice progress lives in the unit spec's slice table, not in the conversation.

## Commands for the user

- Every command the user should run goes in its own fenced block tagged `bash`, so the desktop app shows a Run button: one line, no `$` prompt, no output inside the block. The user's terminal is Windows PowerShell 5.1, so chain with `;`, never `&&`.
- The branch cleanup under **ينتظرك** (`AGENTS.md` → Reporting) is always such a block, with the real branch name, for example:

  ```bash
  git switch main; git pull --ff-only; git branch -d slice/core-foundation-1-license
  ```

# Compact instructions

When compacting, keep: the current spec unit and slice number, its Done criteria, files changed so far, failing test names with their errors, decisions made this session, and open questions for the user.
