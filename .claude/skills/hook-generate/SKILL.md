# Skill: hook-generate

## Trigger

Use when:
- Told to "generate hooks" or "add hooks" for a project
- A project's `.claude/settings.json` is missing a `hooks` key
- Starting a new Claude Code harness and need the hooks block wired up
- Asked to bootstrap lifecycle hooks for a nextjs / node / python / generic project

## Steps

1. **Detect project type** — look for `next.config.*` (nextjs), `package.json` (node),
   `pyproject.toml` / `requirements.txt` (python), else generic.

2. **Run the generator** — from the hooksmith repo root:
   ```bash
   npx tsx ~/hooksmith/src/cli.ts generate <project-root> [--project-type=<type>] [--recipes=<r1,r2>]
   ```
   Outputs a JSON `{ "hooks": {...} }` block to stdout. Stderr prints the detected type and merge instruction.

3. **Merge into settings.json** — open the target project's `.claude/settings.json` and
   add the `hooks` key from the generator output. If no `settings.json` exists, create one:
   ```json
   { "hooks": <generator-output> }
   ```

4. **Lint the result** (always) — run hook-lint skill immediately after merging.

5. **Record in run-log** — append to `logs/run-log.jsonl`:
   ```bash
   node ~/hooksmith/dist/src/run-log.js generate <project-root> <detected-type>
   ```

## Output Format

```
Generated hooks block for <project-root> (type: <type>)
Merged into .claude/settings.json
Lint: 0 errors, N warnings
Run-log entry written to logs/run-log.jsonl
```

## Model Tier

sonnet (generate + merge is deterministic; no reasoning needed)

## Notes

- Recipe `all` uses DEFAULT_RECIPES for the detected project type (10 recipes for nextjs, fewer for others).
- To override, pass `--recipes=session-start,pre-tool-block` (comma-separated RecipeIds).
- The `hooksDir` embedded in commands defaults to `<project-root>/.claude/hooks`. Adjust if the project puts hooks elsewhere.
