/**
 * hooksmith generator — emits a Claude Code settings.json `hooks` block
 * for a given project type + recipe selection.
 *
 * Usage (programmatic):
 *   import { generateHooksBlock } from './generator.js'
 *   const block = generateHooksBlock({ projectType: 'nextjs', recipes: ['all'] })
 *
 * Usage (CLI):
 *   hooksmith generate --project-type nextjs --recipes session-start,pre-tool-block
 */

import { existsSync } from "fs";
import { join } from "path";

// ── Types ──────────────────────────────────────────────────────────────────

export type ProjectType = "nextjs" | "node" | "python" | "generic";

export type RecipeId =
  | "session-start"
  | "compact-restore"
  | "pre-tool-block"
  | "post-write-format"
  | "post-push-verify"
  | "audit-log"
  | "pre-compact-flush"
  | "task-gate"
  | "rate-limit-recover"
  | "session-end-log";

export interface GenerateOptions {
  /** Detected or declared project type */
  projectType: ProjectType;
  /** Which recipe IDs to include. 'all' expands to every recipe. */
  recipes: RecipeId[] | ["all"];
  /** Absolute path to the hooks/ directory where scripts will live */
  hooksDir?: string;
}

export interface HookEntry {
  type: "command";
  command: string;
  timeout?: number;
}

export interface HookMatcher {
  matcher?: string;
  hooks: HookEntry[];
}

export type HooksBlock = {
  SessionStart?: HookMatcher[];
  PreToolUse?: HookMatcher[];
  PostToolUse?: HookMatcher[];
  PreCompact?: HookMatcher[];
  Stop?: HookMatcher[];
  StopFailure?: HookMatcher[];
  SessionEnd?: HookMatcher[];
};

// ── Recipe catalog ─────────────────────────────────────────────────────────

/**
 * Builds a recipe entry keyed by RecipeId.
 * Each entry returns the HookMatcher(s) it contributes.
 * `hooksDir` is the absolute path to where scripts live.
 */
function buildRecipes(hooksDir: string): Record<RecipeId, HookMatcher[]> {
  const h = (script: string, opts?: { timeout?: number }): HookEntry => ({
    type: "command",
    command: `${hooksDir}/${script}`,
    ...(opts?.timeout !== undefined ? { timeout: opts.timeout } : {}),
  });

  return {
    "session-start": [
      {
        hooks: [h("session-start-context.sh"), h("context-monitor.sh")],
      },
    ],

    "compact-restore": [
      {
        matcher: "compact",
        hooks: [h("post-compact-restore.sh")],
      },
    ],

    "pre-tool-block": [
      {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command: `node ${hooksDir}/block-dangerous-commands.js`,
            timeout: 5, // seconds: Claude Code reads hook timeouts in seconds
          },
        ],
      },
    ],

    "post-write-format": [
      {
        matcher: "Write|Edit",
        hooks: [
          {
            type: "command",
            command: `npx prettier --write "$CLAUDE_TOOL_INPUT_FILE_PATH" 2>/dev/null || true`,
          },
        ],
      },
    ],

    "post-push-verify": [
      {
        matcher: "Bash",
        hooks: [h("post-push-verify.sh")],
      },
    ],

    "audit-log": [
      {
        hooks: [h("audit-log.sh")],
      },
    ],

    "pre-compact-flush": [
      {
        hooks: [h("pre-compact-memory-flush.sh")],
      },
    ],

    "task-gate": [
      {
        hooks: [h("task-completion-gate.sh")],
      },
    ],

    "rate-limit-recover": [
      {
        hooks: [h("budget-rate-limit.sh")],
      },
    ],

    "session-end-log": [
      {
        hooks: [h("session-end-log.sh")],
      },
    ],
  };
}

// ── Recipe-to-event mapping ────────────────────────────────────────────────

type EventKey = keyof HooksBlock;

const RECIPE_EVENT: Record<RecipeId, EventKey> = {
  "session-start": "SessionStart",
  "compact-restore": "SessionStart",
  "pre-tool-block": "PreToolUse",
  "post-write-format": "PostToolUse",
  "post-push-verify": "PostToolUse",
  "audit-log": "PostToolUse",
  "pre-compact-flush": "PreCompact",
  "task-gate": "Stop",
  "rate-limit-recover": "StopFailure",
  "session-end-log": "SessionEnd",
};

// ── Default recipes by project type ───────────────────────────────────────

const DEFAULT_RECIPES: Record<ProjectType, RecipeId[]> = {
  nextjs: [
    "session-start",
    "compact-restore",
    "pre-tool-block",
    "post-write-format",
    "post-push-verify",
    "audit-log",
    "pre-compact-flush",
    "task-gate",
    "rate-limit-recover",
    "session-end-log",
  ],
  node: [
    "session-start",
    "compact-restore",
    "pre-tool-block",
    "audit-log",
    "pre-compact-flush",
    "task-gate",
    "rate-limit-recover",
    "session-end-log",
  ],
  python: [
    "session-start",
    "compact-restore",
    "pre-tool-block",
    "audit-log",
    "pre-compact-flush",
    "session-end-log",
  ],
  generic: [
    "session-start",
    "compact-restore",
    "pre-tool-block",
    "audit-log",
    "pre-compact-flush",
  ],
};

// ── Project type auto-detection ────────────────────────────────────────────

export function detectProjectType(projectRoot: string): ProjectType {
  if (existsSync(join(projectRoot, "next.config.js")) ||
      existsSync(join(projectRoot, "next.config.ts")) ||
      existsSync(join(projectRoot, "next.config.mjs"))) {
    return "nextjs";
  }
  if (existsSync(join(projectRoot, "package.json"))) {
    return "node";
  }
  if (existsSync(join(projectRoot, "pyproject.toml")) ||
      existsSync(join(projectRoot, "requirements.txt")) ||
      existsSync(join(projectRoot, "setup.py"))) {
    return "python";
  }
  return "generic";
}

// ── Main generator ─────────────────────────────────────────────────────────

export function generateHooksBlock(opts: GenerateOptions): HooksBlock {
  const hooksDir = opts.hooksDir ?? `${opts.projectType}/.claude/hooks`;
  const catalog = buildRecipes(hooksDir);

  // Resolve recipe list
  const recipeIds: RecipeId[] =
    opts.recipes[0] === "all"
      ? DEFAULT_RECIPES[opts.projectType]
      : (opts.recipes as RecipeId[]);

  // Group matchers by event
  const result: HooksBlock = {};

  for (const id of recipeIds) {
    const event = RECIPE_EVENT[id];
    const matchers = catalog[id];
    if (!result[event]) {
      result[event] = [];
    }
    result[event]!.push(...matchers);
  }

  // Merge matchers with the same matcher key within an event
  for (const event of Object.keys(result) as EventKey[]) {
    result[event] = mergeMatchers(result[event]!);
  }

  return result;
}

/**
 * Merges HookMatchers with identical `matcher` values within the same event,
 * concatenating their `hooks` arrays (PreToolUse blocks in order of declaration).
 */
function mergeMatchers(matchers: HookMatcher[]): HookMatcher[] {
  const seen = new Map<string | undefined, HookMatcher>();
  for (const m of matchers) {
    const key = m.matcher;
    if (seen.has(key)) {
      seen.get(key)!.hooks.push(...m.hooks);
    } else {
      seen.set(key, { ...m, hooks: [...m.hooks] });
    }
  }
  return Array.from(seen.values());
}
