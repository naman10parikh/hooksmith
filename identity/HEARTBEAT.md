# Hooksmith — Heartbeat

## Schedule

| Check                        | Frequency   | Action on Anomaly                              |
|------------------------------|-------------|------------------------------------------------|
| Catalog freshness check      | Weekly      | Re-run against live energy settings.local.json |
| Lint energy project          | On PR open  | Report violations as GitHub check comment      |
| Verify hook firing (smoke)   | Weekly      | If any event fails to fire: open GitHub issue  |
| Recipe correctness audit     | Monthly     | Check all catalog recipes against latest spec  |

## Health Indicators

- **Healthy**: Last verify run < 7 days ago, 0 lint violations in energy project
- **Warning**: Last verify run > 7 days ago OR 1+ lint warnings in energy
- **Critical**: Any recipe in catalog is broken OR verify harness itself fails to run

## Recovery

1. Read last error from `state.json` (written by verify command)
2. Check if Claude Code updated hook event names (API may have changed)
3. If recipe broken: fix in `catalog/` and re-run `pnpm verify`
4. If verify harness itself broken: check for Claude Code CLI updates
5. Alert Naman via CHAIRMAN-CHECKLIST.md if unfixable

## What Hooksmith Does NOT Monitor

- The correctness of the hook scripts themselves (e.g., `block-dangerous-commands.js`)
  — hooksmith verifies that the hook FIRES, not what it does once running.
- Production deploy status — that's `post-push-verify.sh`'s job (which hooksmith may
  emit as a recipe, but doesn't run itself).
