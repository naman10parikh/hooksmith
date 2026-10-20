# Hooksmith — Memory

## Bootstrap (loaded every cycle)

- Strategy: Generate + lint + verify Claude Code `hooks` blocks
- Platform: Claude Code settings.json lifecycle system
- Created: 2026-06-03
- Search this memory (identity/, skills/, the recipe catalog): `hooksmith recall "<query>"`
- Corrections that became rules: `identity/LEARNINGS.md`
- Health: the nightly improve run and `logs/run-log.jsonl` (one line per generate, lint, fire-test)

## Hook events

Claude Code fires 33 hook events and accepts 5 handler types (`command`, `http`, `mcp_tool`, `prompt`,
`agent`) as of 2026-10-19; the full list is `VALID_EVENTS` in `src/linter.ts`, checked nightly against the
published settings schema. Timeouts are in seconds. The events most harnesses use:

| Event         | When it fires                                  | Has `matcher` | Common uses                                |
|---------------|------------------------------------------------|---------------|--------------------------------------------|
| SessionStart  | At the start of every Claude Code session      | Yes           | Context injection, budget apply, log start |
| PreToolUse    | Before every tool call                         | Yes           | Block dangerous Bash, enforce conventions  |
| PostToolUse   | After every tool call                          | Yes           | Auto-format, post-push verify, audit log   |
| PreCompact    | Before context compaction                      | No            | Flush context to disk, write handoff       |
| Stop          | When Claude Code normally exits                | No            | Task gate, Ralph loop re-entry             |
| StopFailure   | When Claude Code exits on error/rate-limit     | No            | Budget rate-limit handler                  |
| SessionEnd    | At session end (after Stop/StopFailure)        | No            | Session log, worktree cleanup              |

## Recipe Catalog (stable)

| Recipe ID          | Event       | Matcher   | Purpose                                      |
|--------------------|-------------|-----------|----------------------------------------------|
| session-start      | SessionStart| (none)    | Inject CLAUDE.md context + budget apply      |
| compact-restore    | SessionStart| compact   | Re-inject anchor-state after compaction      |
| pre-tool-block     | PreToolUse  | Bash      | Block dangerous commands (rm -rf, secrets)   |
| post-write-format  | PostToolUse | Write|Edit| Auto-format with prettier                    |
| post-push-verify   | PostToolUse | Bash      | Check deploy after git push                  |
| audit-log          | PostToolUse | (none)    | Log every tool call to audit trail           |
| pre-compact-flush  | PreCompact  | (none)    | Write handoff + anchor-state before compact  |
| task-gate          | Stop        | (none)    | Block stop if tasks are in_progress          |
| rate-limit-recover | StopFailure | (none)    | Handle rate limits, wait and resume          |
| session-end-log    | SessionEnd  | (none)    | Write session summary to daily log           |
