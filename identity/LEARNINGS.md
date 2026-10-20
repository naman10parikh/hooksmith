# Hooksmith — Learnings

Corrections that became rules. Newest first. Each line: what went wrong, the rule now, and where it is enforced.

## 2026-10-19

- **Hook timeouts are seconds.** The June generator wrote `"timeout": 3000`, which Claude Code reads as 50
  minutes. Rule: the generator writes `5`; the linter warns `TIMEOUT_IN_MILLISECONDS` above 600 (the default).
  Enforced in `src/linter.ts` and the eval "generated timeouts stay in seconds".
- **The event list went stale.** The June linter knew 7 events; Claude Code now fires 33 and has 5 handler types,
  so valid `http`, `prompt`, `agent` and `mcp_tool` hooks were called broken. Rule: the nightly improve run compares
  `VALID_EVENTS` with the published settings schema and opens an issue on drift (`scripts/event-drift.mjs`).
- **Hooks read the event from stdin.** There is no `$CLAUDE_TOOL_NAME` variable; a hook gets one JSON object on
  stdin (`tool_name`, `tool_input`, `cwd`, `hook_event_name`). Rule: scripts parse stdin; `hooksmith test` sends
  the same object, so a script that ignores stdin shows up at once.
- **Absolute paths break for everyone else.** Hook commands pointed at one machine's home folder. Rule: use
  `"$CLAUDE_PROJECT_DIR/..."` in `.claude/settings.json` and `"${CLAUDE_PLUGIN_ROOT}/..."` in `hooks/hooks.json`.
- **Prove a guard without a session.** `hooksmith verify` starts a real Claude session and spends it; a fire-test
  needs none. Rule: fire-test every guard with one case it must stop and one it must allow; run `verify` rarely.
- **The E2B SDK throws on a non-zero exit.** An exit-2 guard inside the microVM surfaced as an exception, not a
  result. Rule: read `exitCode`, `stdout` and `stderr` from the error (`src/fire-test.ts`).
- **No `2>/dev/null` inside the sandbox.** It hid a failed `chmod` while staging scripts. Rule: change modes only
  on the files that were uploaded, and let errors show.
