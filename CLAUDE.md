@AGENTS.md

# Hooksmith — Claude Code operating rules

> One repo = one agent-native harness. Hooksmith owns the "lifecycle hooks" component.
> See `identity/SOUL.md` for identity and `catalog/recipes.json` for the recipe catalog.

## The 3-artifact protocol

1. **The task description** — the approach before any code change
2. **TODOS.md** — the shared queue: CLAIM → WORK → CLOSE with evidence
3. **IMPLEMENTATION-LOG.md** — append `{did / why / evidence / next}` on every meaningful action

## The Four Things (Karpathy — before/during ANY code change)

1. **Think before coding** — state assumptions; surface tradeoffs; present options
2. **Simplicity first** — minimum code; nothing speculative; no single-use abstractions
3. **Surgical changes** — touch only what the task requires; 0 deletions
4. **Goal-driven** — a `verify:` per step; loop until verified, not until it compiles

## Commit convention

`feat(generator):` · `feat(linter):` · `feat(fire-test):` · `feat(verify):` · `feat(catalog):` · `docs:` · `fix:`

## Build + test

```bash
pnpm build       # tsc → dist/
pnpm test        # vitest run (tests/ and evals/)
pnpm eval        # the golden tasks alone
pnpm verify      # build + test together

# CLI (dev, no build needed):
npx tsx src/cli.ts generate .
npx tsx src/cli.ts lint .claude/settings.json
npx tsx src/cli.ts test --settings=.claude/settings.json
npx tsx src/cli.ts verify          # starts a real Claude session; run it rarely
```

## In this repository

- **Hooks:** `.claude/settings.json` runs `hooks/settings-guard.mjs` after every Write or Edit, so an edit that breaks
  a hooks file is reported back at once. The run-log hooks need `dist/` (run `pnpm build`).
- **MCP:** the root `.mcp.json` starts the published server through `npx` (safe for anyone who installs the plugin).
  To use this checkout's own build instead, run `claude --mcp-config .mcp.dev.json`.
- **E2B:** `hooksmith test --sandbox=e2b` reads `E2B_API_KEY` from the environment. Never print it.

## Scope boundaries

- I emit and validate the **`hooks` key only** — not the full settings.json
- I do NOT write the hook scripts themselves (that's the harness owner's job)
- I do NOT run the target project's tests
- I DO verify the hook event pipeline fires (the infrastructure, not the scripts), and fire-test single hooks

## Reuse (don't rebuild)

- Study a mature harness's `.claude/settings.json` and its `.claude/hooks/` scripts as the reference
- Use `catalog/recipes.json` as the machine-readable source of truth for recipe metadata
