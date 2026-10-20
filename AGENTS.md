# AGENTS.md — Hooksmith

> How any coding agent uses and works on hooksmith. This is the one source; `CLAUDE.md` and `GEMINI.md` point here.

## What it does

Hooksmith owns one part of an agent's harness: the lifecycle **hooks** in Claude Code's `.claude/settings.json`
(and a plugin's `hooks/hooks.json`). It generates a correct hooks block for a project, lints an existing one against
today's 33 hook events and 5 handler types, and fire-tests each hook with the JSON event Claude Code would send,
locally or inside an E2B microVM.

## Tools and how to call them

| Surface | Call | What it returns |
| ------- | ---- | --------------- |
| CLI | `npx -y -p github:naman10parikh/hooksmith hooksmith generate <project> [--project-type=nextjs\|node\|python\|generic] [--recipes=a,b]` | A `{ "hooks": ... }` block on stdout |
| CLI | `hooksmith lint <settings.json>` | Violations with code, JSON path and fix; exit 1 on errors |
| CLI | `hooksmith test "<hook command>" [--event=PreToolUse] [--tool=Bash] [--input='{...}'] [--expect=block] [--sandbox=e2b]` | The hook's decision, exit code, reason and timing |
| CLI | `hooksmith test --settings=<settings.json>` | Fires every command hook in the file once |
| CLI | `hooksmith recall "<query>"` | The best matching sections of hooksmith's own memory |
| CLI | `hooksmith verify` | Starts a real Claude session to prove events fire (slow; spends a session) |
| MCP | `hooksmith-mcp` tools `hook_generate`, `hook_lint`, `hook_test` | The same three as JSON-RPC tools over stdio |
| Skills | `skills/hook-generate`, `skills/hook-lint`, `skills/hook-fire-test` | Step-by-step playbooks for each job |
| Sub-agents | `.claude/agents/hook-reviewer.md`, `.claude/agents/hook-fire-tester.md` | A reviewer that reads and lints; a tester that runs |
| Hook | `hooks/settings-guard.mjs` (PostToolUse on Write, Edit, MultiEdit) | Tells the agent when an edited hooks file has errors |

`--sandbox=e2b` needs `E2B_API_KEY` in the environment and uploads only the files the hook command names.

## Layout

```
identity/        SOUL, BRAND, HEARTBEAT, MEMORY, LEARNINGS (who hooksmith is, what it learned)
src/             generator.ts, linter.ts, fire-test.ts, verify.ts, recall.ts, cli.ts, mcp-server.ts, run-log.ts
catalog/         recipes.json, the named hook recipes the generator emits
skills/          the three skills
hooks/           settings-guard.mjs and hooks.json (the plugin's hooks)
evals/           eval.ts, golden tasks that gate every pull request
tests/           fire-test and settings-guard tests
scripts/         mcp-smoke.mjs (MCP end to end), event-drift.mjs (the nightly improvement signal)
.claude/         settings.json (hooksmith's own hooks), agents/ (the two personas)
.claude-plugin/  plugin.json and marketplace.json
dsip.json        the self-improvement contract (honest level L2)
```

## Key concepts

- **Recipe:** a named hook pattern (for example `pre-tool-block`) tied to one event; `catalog/recipes.json` lists them.
- **Hooks block:** the object under the `"hooks"` key: event name, then matchers, then handlers.
- **Decision:** what a hook told Claude Code. Exit code 2 blocks; `hookSpecificOutput.permissionDecision` can allow,
  deny, ask or defer; `"decision": "block"` or `"continue": false` blocks; anything else passes.

## Working on hooksmith

1. `pnpm install && pnpm build`
2. `pnpm test && pnpm eval` must pass (CI runs both on every pull request, plus `node scripts/mcp-smoke.mjs`).
3. Lint and fire hooksmith's own hooks after touching them:
   `node dist/src/cli.js lint .claude/settings.json && node dist/src/cli.js test --settings=.claude/settings.json`
4. New hook events: add them to `VALID_EVENTS` in `src/linter.ts` and to the list in `hooks/settings-guard.mjs`
   (a test keeps the two equal), with one eval case each.

## What not to do

- Do not rewrite a project's existing hooks unasked: report violations, let the owner merge the fix.
- Do not run `hooksmith verify` in a loop or in CI with a logged-in Claude: it starts a real session.
- Do not write absolute home paths into hook commands; use `$CLAUDE_PROJECT_DIR` or `${CLAUDE_PLUGIN_ROOT}`.
- Do not print or commit keys. E2B reads `E2B_API_KEY` from the environment only.
- Do not merge from the improvement loop; it opens issues, a person merges.
