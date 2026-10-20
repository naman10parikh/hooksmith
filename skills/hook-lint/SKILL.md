---
name: hook-lint
description: Validate the hooks block of a Claude Code settings.json against today's 33 hook events and 5 handler types. Use after generating or editing hooks, when a hook does not fire, or as a pre-commit check before a settings.json change ships.
---

# Skill: hook-lint

## Trigger

Use when:
- Asked to "lint hooks", "check hooks", or "validate settings.json"
- After generating or editing a hooks block (always run as post-generate step)
- A hook is not firing and you want to diagnose why
- Pre-commit validation to ensure no broken hook scripts ship

## Steps

1. **Run the linter** (from anywhere; inside the hooksmith repo, `node dist/src/cli.js` works too):
   ```bash
   npx -y -p github:naman10parikh/hooksmith hooksmith lint <path-to-settings.json>
   ```
   Defaults to `.claude/settings.json` if no path given. Exits 0 if clean, exits 1 on errors.

2. **Interpret results** — each violation has:
   - Severity: `error` (blocks), `warning` (should fix), `info`
   - Code: `UNKNOWN_EVENT` | `MISSING_HOOKS_ARRAY` | `EMPTY_HOOKS_ARRAY` | `INVALID_HOOK_TYPE` | `MISSING_FIELD` | `MISSING_COMMAND` | `MISSING_TIMEOUT` | `TIMEOUT_IN_MILLISECONDS` | `SCRIPT_NOT_FOUND` | `SCRIPT_NOT_EXECUTABLE`
   - Path: JSON path to the problem (e.g. `hooks.PreToolUse[0].hooks[1].command`)

3. **Fix violations in priority order**:
   - `SCRIPT_NOT_FOUND` → check path, chmod +x if script exists but wrong path
   - `SCRIPT_NOT_EXECUTABLE` → `chmod +x <path>`
   - `UNKNOWN_EVENT` → fix typo (e.g. `preToolUse` → `PreToolUse`)
   - `MISSING_TIMEOUT` → add `"timeout": 5` (seconds) to PreToolUse Bash hooks
   - `TIMEOUT_IN_MILLISECONDS` → Claude Code reads timeouts in seconds; change `3000` to `3`
   - `MISSING_FIELD` → an `http` hook needs `url`, `prompt` and `agent` need `prompt`, `mcp_tool` needs `server` and `tool`
   - `EMPTY_HOOKS_ARRAY` → add at least one hook entry or remove the matcher

4. **Run-log** — the CLI appends one line to hooksmith's `logs/run-log.jsonl` (file, error and warning counts).

5. **Re-run until clean** (0 errors). Warnings are acceptable but should be noted.

## Output

```
hooksmith lint: <N> error(s), <N> warning(s), <N> info(s)
[list of violations with path + message]
```

## Notes

- `SCRIPT_NOT_FOUND` checks absolute paths only. Relative paths and `npx` commands are not checked (by design).
- On Windows, `SCRIPT_NOT_EXECUTABLE` is skipped.
- The linter reads the full settings.json and checks ONLY the `hooks` key — it ignores all other keys.
