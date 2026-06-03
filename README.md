# hooksmith

**Lifecycle-hook generator, linter, and verifier for Claude Code.**

Hooksmith owns the `hooks` key inside `.claude/settings.json`. It generates it by
project type, validates it against known rules, and proves that hooks actually fire —
with a receipt to show for it.

## What It Does

| Command              | What it does                                                       |
|----------------------|--------------------------------------------------------------------|
| `hooksmith generate` | Emit a `hooks` block for a project (auto-detects type)             |
| `hooksmith lint`     | Validate an existing `settings.json` hooks block, report issues    |
| `hooksmith verify`   | Run a live probe to confirm PreToolUse + PostToolUse actually fire |

## Quick Start

```bash
# Generate a hooks block for the current project
npx tsx src/cli.ts generate .

# Lint an existing settings.json
npx tsx src/cli.ts lint .claude/settings.json

# Prove hooks fire (requires claude CLI on PATH)
npx tsx src/cli.ts verify
```

## Recipe Catalog

10 named recipes covering the full Claude Code lifecycle:

| Recipe ID          | Event       | What it does                                   |
|--------------------|-------------|------------------------------------------------|
| session-start      | SessionStart| Inject context + apply budget tier             |
| compact-restore    | SessionStart| Re-inject anchor-state after compaction        |
| pre-tool-block     | PreToolUse  | Block dangerous Bash commands                  |
| post-write-format  | PostToolUse | Auto-format with prettier after writes         |
| post-push-verify   | PostToolUse | Verify deploy after git push                   |
| audit-log          | PostToolUse | Log every tool call to audit trail             |
| pre-compact-flush  | PreCompact  | Flush context to disk before compaction        |
| task-gate          | Stop        | Block exit if tasks still in_progress          |
| rate-limit-recover | StopFailure | Handle rate limits gracefully                  |
| session-end-log    | SessionEnd  | Write session summary to daily log             |

## Linter Violations

| Code                | Severity | Description                                         |
|---------------------|----------|-----------------------------------------------------|
| UNKNOWN_EVENT       | error    | Event name not in known set (typo?)                 |
| MISSING_HOOKS_ARRAY | error    | HookMatcher missing `hooks` key                     |
| EMPTY_HOOKS_ARRAY   | warning  | Hooks array is empty (matcher does nothing)         |
| INVALID_HOOK_TYPE   | error    | Hook type is not "command"                          |
| MISSING_COMMAND     | error    | Hook has no command string                          |
| MISSING_TIMEOUT     | warning  | PreToolUse Bash hook missing timeout (will hang)    |
| SCRIPT_NOT_FOUND    | error    | Script path doesn't exist on disk                   |
| SCRIPT_NOT_EXECUTABLE | error  | Script exists but isn't executable (chmod +x)       |

## Architecture

```
src/
  generator.ts   # generateHooksBlock(opts) → HooksBlock
  linter.ts      # lintHooksBlock(block) → LintResult
  verify.ts      # verifyHooksFire() → VerifyResult
  cli.ts         # CLI glue: generate | lint | verify

catalog/
  recipes.json   # Machine-readable recipe registry

evals/
  eval.ts        # Golden-task evaluation suite (vitest)
```

## Status

Part of the [Energy](https://github.com/naman10parikh/Energy) fleet.
Private harness — not published to npm.
