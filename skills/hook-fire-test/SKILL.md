---
name: hook-fire-test
description: Fire a hook with the JSON event Claude Code would send and read back its decision (block, deny, ask, allow, defer or pass), locally or inside an E2B microVM. Use after writing or changing a guard hook, when a hook seems to do nothing, or before running a hook script you did not write.
---

# Skill: hook-fire-test

## Trigger

Use when:
- A new `PreToolUse` guard must be shown to block what it should and pass the rest
- A hook "does nothing" and you need to know whether it runs at all
- A settings file came from somewhere else and every hook in it should be run once
- A hook script is untrusted and must not run on this machine (use `--sandbox=e2b`)

## Steps

1. **Fire one hook with a case it must stop.** Pass the hook's command exactly as it appears in
   `settings.json`, the tool input, and the decision you expect:
   ```bash
   npx -y -p github:naman10parikh/hooksmith hooksmith test "node .claude/hooks/guard.mjs" \
     --event=PreToolUse --tool=Bash --input='{"command":"git push --force"}' --expect=block
   ```
   Exit code 0 means it decided as expected; 1 means it did not (or timed out).

2. **Fire the same hook with a case it must allow** (`--expect=pass` or `--expect=allow`).
   A guard that blocks everything is as broken as one that blocks nothing.

3. **Fire every command hook in a settings file once** with a harmless default event:
   ```bash
   npx -y -p github:naman10parikh/hooksmith hooksmith test --settings=.claude/settings.json
   ```

4. **Untrusted script? Run it in a microVM.** Add `--sandbox=e2b` with `E2B_API_KEY` set. The files
   the command names are uploaded to a fresh E2B Firecracker VM, the hook runs there with the same
   JSON on stdin, and the VM is killed afterwards. The result adds `coldStartMs`.

5. **Record what you saw.** Each run appends one line to hooksmith's `logs/run-log.jsonl`
   (event, sandbox, decision, exit code, duration). Add `--json` for the full result.

## How decisions are read

The same rules Claude Code uses: exit code 2 blocks (stderr is the reason);
`hookSpecificOutput.permissionDecision` of `allow`, `deny`, `ask` or `defer` in the last JSON line of
stdout wins; `"decision": "block"` or `"continue": false` blocks; any other exit code is a
non-blocking error, so the decision is `pass`.

## Output

```
fire-test: decision=block exit=2 (41 ms, local)
  reason: force push is not allowed
```

With `--settings`, one such block per hook, labelled with its event and matcher. With `--expect`, a
mismatch adds `expected decision=<x>` and exits 1.

## Notes

- `hooksmith test` never starts a Claude session and spends nothing. `hooksmith verify` does start
  one (it proves the event pipeline fires end to end) and is the slower, rarer check.
- `$CLAUDE_PROJECT_DIR` is set to `--cwd` (default: the working directory), as Claude Code sets it.
- MCP clients get the same check as the `hook_test` tool on `hooksmith-mcp`.
