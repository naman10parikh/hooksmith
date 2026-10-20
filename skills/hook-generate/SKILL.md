---
name: hook-generate
description: Generate a Claude Code hooks block for a project (nextjs, node, python or generic) from hooksmith's recipe catalog. Use when told to add or generate hooks, when a project's .claude/settings.json has no hooks key, or when bootstrapping a new harness.
---

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

2. **Run the generator** (from anywhere; inside the hooksmith repo, `node dist/src/cli.js` works too):
   ```bash
   npx -y -p github:naman10parikh/hooksmith hooksmith generate <project-root> [--project-type=<type>] [--recipes=<r1,r2>]
   ```
   Outputs a JSON `{ "hooks": {...} }` block to stdout. Stderr prints the detected type and merge instruction.

3. **Merge into settings.json** — open the target project's `.claude/settings.json` and
   add the `hooks` key from the generator output. If no `settings.json` exists, create one:
   ```json
   { "hooks": <generator-output> }
   ```

4. **Lint the result** (always) — run hook-lint skill immediately after merging.

5. **Run-log** — the CLI appends one line to hooksmith's own `logs/run-log.jsonl` (time, project, type,
   event count). Nothing to do; read it with `tail logs/run-log.jsonl` inside the hooksmith repo.

## Output

```
Generated hooks block for <project-root> (type: <type>)
Merged into .claude/settings.json
Lint: 0 errors, N warnings
Run-log entry written to logs/run-log.jsonl
```

## Notes

- Recipe `all` uses DEFAULT_RECIPES for the detected project type (10 recipes for nextjs, fewer for others).
- To override, pass `--recipes=session-start,pre-tool-block` (comma-separated RecipeIds).
- The `hooksDir` embedded in commands defaults to `<project-root>/.claude/hooks`. Adjust if the project puts hooks elsewhere.
