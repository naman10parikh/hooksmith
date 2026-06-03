# Skill: hook-lint

## Trigger

Use when:
- Asked to "lint hooks", "check hooks", or "validate settings.json"
- After generating or editing a hooks block (always run as post-generate step)
- A hook is not firing and you want to diagnose why
- Pre-commit validation to ensure no broken hook scripts ship

## Steps

1. **Run the linter** — from the hooksmith repo root:
   ```bash
   npx tsx ~/hooksmith/src/cli.ts lint <path-to-settings.json>
   ```
   Defaults to `.claude/settings.json` if no path given. Exits 0 if clean, exits 1 on errors.

2. **Interpret results** — each violation has:
   - Severity: `error` (blocks), `warning` (should fix), `info`
   - Code: `UNKNOWN_EVENT` | `MISSING_HOOKS_ARRAY` | `EMPTY_HOOKS_ARRAY` | `INVALID_HOOK_TYPE` | `MISSING_COMMAND` | `MISSING_TIMEOUT` | `SCRIPT_NOT_FOUND` | `SCRIPT_NOT_EXECUTABLE`
   - Path: JSON path to the problem (e.g. `hooks.PreToolUse[0].hooks[1].command`)

3. **Fix violations in priority order**:
   - `SCRIPT_NOT_FOUND` → check path, chmod +x if script exists but wrong path
   - `SCRIPT_NOT_EXECUTABLE` → `chmod +x <path>`
   - `UNKNOWN_EVENT` → fix typo (e.g. `preToolUse` → `PreToolUse`)
   - `MISSING_TIMEOUT` → add `"timeout": 3000` to PreToolUse Bash hooks
   - `EMPTY_HOOKS_ARRAY` → add at least one hook entry or remove the matcher

4. **Record in run-log** — append result to `logs/run-log.jsonl`:
   ```bash
   node ~/hooksmith/dist/src/run-log.js lint <settings-path> <errorCount> <warningCount>
   ```

5. **Re-run until clean** (0 errors). Warnings are acceptable but should be noted.

## Output Format

```
hooksmith lint: <N> error(s), <N> warning(s), <N> info(s)
[list of violations with path + message]
```

## Model Tier

haiku (pure validation — no reasoning; just run the tool and parse output)

## Notes

- `SCRIPT_NOT_FOUND` checks absolute paths only. Relative paths and `npx` commands are not checked (by design).
- On Windows, `SCRIPT_NOT_EXECUTABLE` is skipped.
- The linter reads the full settings.json and checks ONLY the `hooks` key — it ignores all other keys.
