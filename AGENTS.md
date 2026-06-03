# AGENTS.md — Hooksmith

> This file tells AI agents how hooksmith is structured.

## Domain: lifecycle-hooks (Claude Code `settings.json`)

## Created: 2026-06-03

## Directory Structure

```
identity/           # Agent identity (SOUL, BRAND, MEMORY, HEARTBEAT)
  SOUL.md           # Who hooksmith is, what it owns, its boundaries
  BRAND.md          # Name rationale, tagline, look & feel
  MEMORY.md         # Bootstrap facts, recipe catalog, patterns
  HEARTBEAT.md      # Health schedule and recovery protocol

src/                # TypeScript implementation (the owned artifact)
  generator.ts      # generateHooksBlock() — emits a hooks block by recipe
  linter.ts         # lintHooksBlock() — validates an existing hooks block
  verify.ts         # verifyHooksFire() — proves hooks fire in a live session
  cli.ts            # CLI entry point: generate | lint | verify

evals/              # Evaluation suite (golden tasks)
  eval.ts           # 3-task eval: generator, linter, verify (vitest)

catalog/            # Machine-readable recipe registry
  recipes.json      # 10 named recipes with metadata

dist/               # Compiled output (gitignored)
CLAUDE.md           # Operating handbook for agents
AGENTS.md           # This file
README.md           # Human-readable overview
llms.txt            # AI agent discovery index
TODOS.md            # Task queue (claim → work → close)
IMPLEMENTATION-LOG.md  # Append-only action log
```

## Key Concepts

**Recipe**: A named, reusable lifecycle-hook pattern (e.g., `pre-tool-block`). Each recipe
maps to one Claude Code event (SessionStart, PreToolUse, etc.) and contributes one or more
`HookMatcher` objects to the `hooks` block.

**HooksBlock**: The JSON object that lives at the `"hooks"` key in `settings.json`. It maps
event names to arrays of `HookMatcher` objects.

**HookMatcher**: `{ matcher?: string, hooks: HookEntry[] }`. The `matcher` is matched against
the tool name (for PreToolUse/PostToolUse) or the word "compact" (for SessionStart).

**Verify**: A live probe that runs a minimal Claude Code session with throwaway hooks and
checks that receipts were written to disk. This is the evidence that hooks fire.

## How to Use hooksmith in Another Project

1. Generate: `npx tsx src/cli.ts generate /path/to/project` → copy the `hooks` block
   into that project's `.claude/settings.json`
2. Lint: `npx tsx src/cli.ts lint /path/to/project/.claude/settings.json`
3. Verify: `npx tsx src/cli.ts verify` (requires `claude` CLI on PATH)

## Quality Gate

Before marking any work done:
1. `pnpm build` — 0 TypeScript errors
2. `pnpm test` — all eval tasks GREEN
3. `pnpm verify` if changing generator/linter logic
