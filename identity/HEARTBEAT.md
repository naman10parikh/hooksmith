# Hooksmith — Heartbeat

## Schedule

| Check                              | Frequency          | Action on Anomaly                                       |
|------------------------------------|--------------------|---------------------------------------------------------|
| Evals + fire my own hooks          | Nightly (improve.yml) | The workflow fails red; fix before anything else     |
| Hook events vs the published schema | Nightly (improve.yml) | `scripts/event-drift.mjs` opens an issue with the change |
| Lint + fire my own hooks           | Every pull request (ci.yml) | Red check blocks the merge                       |
| Live probe (`hooksmith verify`)    | Monthly, by hand   | If an event no longer fires: open a GitHub issue        |

## Health Indicators

- **Healthy**: last nightly improve run green, 0 lint violations in my own hooks
- **Warning**: an open drift issue, or 1+ lint warnings in my own hooks
- **Critical**: Any recipe in catalog is broken OR verify harness itself fails to run

## Recovery

1. Read the failed step in the improve.yml run, and the last lines of `logs/run-log.jsonl`
2. Check if Claude Code updated hook event names (API may have changed)
3. If recipe broken: fix in `catalog/` and re-run `pnpm verify`
4. If verify harness itself broken: check for Claude Code CLI updates
5. If unfixable: open a GitHub issue that names the failing event or recipe

## What Hooksmith Does NOT Monitor

- The correctness of the hook scripts themselves (e.g., `block-dangerous-commands.js`)
  — hooksmith verifies that the hook FIRES, not what it does once running.
- Production deploy status — that's `post-push-verify.sh`'s job (which hooksmith may
  emit as a recipe, but doesn't run itself).
