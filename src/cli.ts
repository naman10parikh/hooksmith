#!/usr/bin/env node
/**
 * hooksmith CLI
 * Subcommands:
 *   generate  — emit a hooks block for a project type
 *   lint      — validate an existing settings.json hooks block
 *   verify    — prove PreToolUse + PostToolUse actually fire (starts a live Claude session)
 *   test      — fire one hook (or every hook in a settings file) with a synthetic event; local or E2B
 *   recall    — search hooksmith's own memory (identity, lessons, skills, recipes)
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import {
  generateHooksBlock,
  detectProjectType,
  type GenerateOptions,
  type RecipeId,
} from "./generator.js";
import { lintHooksBlock, formatLintResult } from "./linter.js";
import { verifyHooksFire } from "./verify.js";
import { fireTest, type FireTestInput, type FireTestResult } from "./fire-test.js";
import { recall, hooksmithRoot } from "./recall.js";
import { appendRunLog } from "./run-log.js";
import { join } from "path";

const args = process.argv.slice(2);
const sub = args[0];
const flag = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

// ── version ────────────────────────────────────────────────────────────────

if (sub === "--version" || sub === "-v") {
  const pkg = JSON.parse(readFileSync(join(hooksmithRoot(), "package.json"), "utf8")) as { version: string };
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

// ── recall ─────────────────────────────────────────────────────────────────

if (sub === "recall") {
  const query = args.slice(1).filter((a) => !a.startsWith("--")).join(" ");
  const hits = query ? recall(query) : [];
  if (!query) process.stderr.write('usage: hooksmith recall "<query>"\n');
  for (const h of hits) process.stdout.write(`### ${h.heading}  (${h.file})\n${h.snippet}\n\n`);
  if (query && hits.length === 0) process.stdout.write(`no memory matched "${query}"\n`);
  process.exit(query ? 0 : 2);
}

// ── test (fire-test) ───────────────────────────────────────────────────────

function printResult(label: string, r: FireTestResult): void {
  const cold = r.coldStartMs !== undefined ? `, cold start ${r.coldStartMs} ms` : "";
  process.stdout.write(`${label}: decision=${r.decision} exit=${r.exitCode ?? "none"} (${r.durationMs} ms, ${r.sandbox}${cold})\n`);
  if (r.reason) process.stdout.write(`  reason: ${r.reason}\n`);
  if (r.error) process.stdout.write(`  error: ${r.error}\n`);
}

async function runTest(): Promise<number> {
  const sandbox = flag("sandbox") === "e2b" ? "e2b" : "local";
  const cwd = flag("cwd");
  const settingsPath = flag("settings");
  if (settingsPath) {
    const settings = JSON.parse(readFileSync(resolve(settingsPath), "utf8")) as { hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<Record<string, unknown>> }>> };
    let failures = 0;
    for (const [event, matchers] of Object.entries(settings.hooks ?? {})) {
      for (const m of matchers) {
        for (const h of m.hooks ?? []) {
          if (h.type !== "command" || typeof h.command !== "string") continue;
          const tool = (m.matcher ?? "").split("|")[0];
          const r = await fireTest({ command: h.command, event, toolName: tool && /^\w+$/.test(tool) ? tool : "Bash", sandbox, cwd: cwd ?? process.cwd() });
          printResult(`${event}${m.matcher ? ` [${m.matcher}]` : ""}`, r);
          if (!r.ok) failures++;
        }
      }
    }
    return failures === 0 ? 0 : 1;
  }
  const command = args.slice(1).filter((a) => !a.startsWith("--")).join(" ");
  if (!command) {
    process.stderr.write("usage: hooksmith test \"<hook command>\" [--event=PreToolUse] [--tool=Bash] [--input='{...}'] [--expect=block] [--sandbox=e2b] [--json]\n       hooksmith test --settings=.claude/settings.json [--sandbox=e2b]\n");
    return 2;
  }
  const input: FireTestInput = { command, sandbox, ...(cwd ? { cwd } : {}) };
  const event = flag("event");
  const tool = flag("tool");
  const toolInput = flag("input");
  const timeout = flag("timeout");
  if (event) input.event = event;
  if (tool) input.toolName = tool;
  if (toolInput) input.toolInput = JSON.parse(toolInput) as Record<string, unknown>;
  if (timeout) input.timeoutSec = Number(timeout);
  const r = await fireTest(input);
  if (args.includes("--json")) process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  else printResult("fire-test", r);
  const expect = flag("expect");
  if (expect && r.decision !== expect) {
    process.stdout.write(`  expected decision=${expect}\n`);
    return 1;
  }
  return r.ok ? 0 : 1;
}

// ── generate ───────────────────────────────────────────────────────────────

if (sub === "generate") {
  const projectRoot = resolve(args[1] ?? ".");
  const detectedType = detectProjectType(projectRoot);

  // Allow --project-type override
  const typeFlag = args.find((a) => a.startsWith("--project-type="));
  const projectType = (typeFlag?.split("=")[1] ?? detectedType) as
    GenerateOptions["projectType"];

  // Allow --recipes override
  const recipesFlag = args.find((a) => a.startsWith("--recipes="));
  const recipes = recipesFlag
    ? (recipesFlag.split("=")[1]?.split(",") as RecipeId[])
    : (["all"] as ["all"]);

  const hooksDir = resolve(projectRoot, ".claude/hooks");
  const block = generateHooksBlock({ projectType, recipes, hooksDir });

  appendRunLog("generate", { projectRoot, projectType, detectedType, events: Object.keys(block).length });
  process.stdout.write(JSON.stringify({ hooks: block }, null, 2) + "\n");
  process.stderr.write(
    `# Detected project type: ${detectedType}${typeFlag ? ` (overridden to: ${projectType})` : ""}\n` +
    `# Merge this into your .claude/settings.json under the "hooks" key\n`,
  );
  process.exit(0);
}

// ── lint ───────────────────────────────────────────────────────────────────

if (sub === "lint") {
  const settingsPath = resolve(args[1] ?? ".claude/settings.json");
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
  } catch (err) {
    process.stderr.write(
      `hooksmith lint: cannot read ${settingsPath}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }

  const hooksBlock = settings["hooks"] as Record<string, unknown> | undefined;
  if (!hooksBlock) {
    process.stdout.write(`hooksmith lint: no "hooks" key found in ${settingsPath}\n`);
    process.exit(0);
  }

  const result = lintHooksBlock(hooksBlock as Record<string, unknown>);
  appendRunLog("lint", { settingsPath, errorCount: result.errorCount, warningCount: result.warningCount });
  process.stdout.write(formatLintResult(result) + "\n");
  process.exit(result.errorCount > 0 ? 1 : 0);
}

// ── verify ─────────────────────────────────────────────────────────────────

if (sub === "test") {
  void runTest().then((code) => process.exit(code)).catch((err: unknown) => {
    process.stderr.write(`hooksmith test: fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
} else if (sub === "verify") {
  void verifyHooksFire().then((result) => {
    if (result.skipped) {
      process.stdout.write(`hooksmith verify: SKIPPED — ${result.skipReason ?? "unknown"}\n`);
      process.exit(0);
    }

    for (const e of result.evidence) {
      process.stdout.write(`  ${e}\n`);
    }

    if (result.passed) {
      process.stdout.write(`\nhooksmith verify: PASS (${result.durationMs}ms)\n`);
      process.exit(0);
    } else {
      process.stdout.write(
        `\nhooksmith verify: FAIL\n` +
        `  PreToolUse fired:  ${result.preToolUseFired}\n` +
        `  PostToolUse fired: ${result.postToolUseFired}\n`,
      );
      process.exit(1);
    }
  }).catch((err: unknown) => {
    process.stderr.write(`hooksmith verify: fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
} else {

// ── help ───────────────────────────────────────────────────────────────────

process.stdout.write(
  `hooksmith — lifecycle-hook generator, linter, and verifier for Claude Code

Usage:
  hooksmith generate [project-root] [--project-type=nextjs|node|python|generic] [--recipes=r1,r2]
  hooksmith lint     [settings.json path]
  hooksmith test     "<hook command>" [--event=PreToolUse] [--tool=Bash] [--input='{...}'] [--expect=block] [--sandbox=e2b] [--json]
  hooksmith test     --settings=.claude/settings.json [--sandbox=e2b]
  hooksmith recall   "<query>"
  hooksmith verify
  hooksmith --version

Commands:
  generate   Emit a "hooks" block for .claude/settings.json
  lint       Validate an existing hooks block (exits 1 on errors)
  test       Fire a hook with a synthetic event and decode its decision (locally, or in an E2B microVM)
  recall     Search hooksmith's own memory: identity, lessons, skills and recipes
  verify     Run a live probe to confirm hooks actually fire (starts a Claude session; requires claude CLI)

Examples:
  hooksmith generate .                          # auto-detect project type
  hooksmith generate . --project-type=nextjs
  hooksmith lint .claude/settings.json
  hooksmith lint .claude/settings.local.json
  hooksmith test "node .claude/hooks/guard.js" --input='{"command":"rm -rf /"}' --expect=block
  hooksmith test --settings=.claude/settings.json --sandbox=e2b
  hooksmith verify
`,
);
process.exit(0);
}
