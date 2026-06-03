#!/usr/bin/env node
/**
 * hooksmith CLI
 * Subcommands:
 *   generate  — emit a hooks block for a project type
 *   lint      — validate an existing settings.json hooks block
 *   verify    — prove PreToolUse + PostToolUse actually fire
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

const args = process.argv.slice(2);
const sub = args[0];

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
  process.stdout.write(formatLintResult(result) + "\n");
  process.exit(result.errorCount > 0 ? 1 : 0);
}

// ── verify ─────────────────────────────────────────────────────────────────

if (sub === "verify") {
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
  hooksmith verify

Commands:
  generate   Emit a "hooks" block for .claude/settings.json
  lint       Validate an existing hooks block (exits 1 on errors)
  verify     Run a live probe to confirm hooks actually fire (requires claude CLI)

Examples:
  hooksmith generate .                          # auto-detect project type
  hooksmith generate . --project-type=nextjs
  hooksmith lint .claude/settings.json
  hooksmith lint .claude/settings.local.json
  hooksmith verify
`,
);
process.exit(0);
}
