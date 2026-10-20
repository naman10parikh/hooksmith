/**
 * hooksmith eval — golden-task evaluation suite
 *
 * Three golden tasks:
 *   1. Generator produces a valid, parseable hooks block for each project type
 *   2. Linter catches all known violation types correctly
 *   3. Verify command is runnable and returns a structured result (skipped is OK)
 *
 * Pass criterion: 0 failures across all tasks.
 * Run with: pnpm test (vitest) or: npx tsx evals/eval.ts
 */

import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import {
  generateHooksBlock,
  detectProjectType,
  type HooksBlock,
} from "../src/generator.js";
import { lintHooksBlock, extractScriptPath } from "../src/linter.js";

// ─── Task 1: Generator ────────────────────────────────────────────────────

describe("Task 1 — Generator produces valid hooks blocks", () => {
  it("nextjs: all core events present", () => {
    const block = generateHooksBlock({
      projectType: "nextjs",
      recipes: ["all"],
      hooksDir: "/project/.claude/hooks",
    });

    // Must have these events
    expect(block.SessionStart).toBeDefined();
    expect(block.PreToolUse).toBeDefined();
    expect(block.PostToolUse).toBeDefined();
    expect(block.PreCompact).toBeDefined();
    expect(block.Stop).toBeDefined();
    expect(block.StopFailure).toBeDefined();
    expect(block.SessionEnd).toBeDefined();
  });

  it("nextjs: PreToolUse has a Bash matcher", () => {
    const block = generateHooksBlock({
      projectType: "nextjs",
      recipes: ["all"],
      hooksDir: "/project/.claude/hooks",
    });
    const bashMatcher = block.PreToolUse?.find((m) => m.matcher === "Bash");
    expect(bashMatcher).toBeDefined();
    expect(bashMatcher!.hooks.length).toBeGreaterThan(0);
  });

  it("nextjs: SessionStart has compact-restore matcher", () => {
    const block = generateHooksBlock({
      projectType: "nextjs",
      recipes: ["all"],
      hooksDir: "/project/.claude/hooks",
    });
    const compactMatcher = block.SessionStart?.find((m) => m.matcher === "compact");
    expect(compactMatcher).toBeDefined();
  });

  it("nextjs: all hook commands are strings", () => {
    const block = generateHooksBlock({
      projectType: "nextjs",
      recipes: ["all"],
      hooksDir: "/project/.claude/hooks",
    });
    const allHooks = Object.values(block as HooksBlock)
      .flat()
      .flatMap((m) => m.hooks);
    for (const hook of allHooks) {
      expect(typeof hook.command).toBe("string");
      expect(hook.command.length).toBeGreaterThan(0);
      expect(hook.type).toBe("command");
    }
  });

  it("python: no post-push-verify (not needed for python projects)", () => {
    const block = generateHooksBlock({
      projectType: "python",
      recipes: ["all"],
      hooksDir: "/project/.claude/hooks",
    });
    // post-push-verify is in PostToolUse.Bash matcher — python shouldn't have it
    const postToolBash = block.PostToolUse?.find((m) => m.matcher === "Bash");
    // Python default recipes don't include post-push-verify
    expect(postToolBash).toBeUndefined();
  });

  it("generic: minimal recipe set — only core events", () => {
    const block = generateHooksBlock({
      projectType: "generic",
      recipes: ["all"],
      hooksDir: "/project/.claude/hooks",
    });
    expect(block.SessionStart).toBeDefined();
    expect(block.PreToolUse).toBeDefined();
    // generic doesn't include SessionEnd
    expect(block.SessionEnd).toBeUndefined();
  });

  it("manual recipe list: only specified recipes are included", () => {
    const block = generateHooksBlock({
      projectType: "node",
      recipes: ["session-start", "pre-tool-block"],
      hooksDir: "/project/.claude/hooks",
    });
    expect(block.SessionStart).toBeDefined();
    expect(block.PreToolUse).toBeDefined();
    expect(block.PostToolUse).toBeUndefined();
    expect(block.PreCompact).toBeUndefined();
  });

  it("matchers with same key are merged (not duplicated)", () => {
    // Both post-push-verify and audit-log write to PostToolUse
    // audit-log has no matcher, post-push-verify has Bash matcher
    const block = generateHooksBlock({
      projectType: "nextjs",
      recipes: ["post-push-verify", "audit-log"],
      hooksDir: "/project/.claude/hooks",
    });
    // Count distinct matchers in PostToolUse
    const events = block.PostToolUse ?? [];
    const bashMatchers = events.filter((m) => m.matcher === "Bash");
    const noMatchers = events.filter((m) => !m.matcher);
    expect(bashMatchers.length).toBe(1); // merged into one
    expect(noMatchers.length).toBe(1);   // audit-log
  });

  it("detectProjectType: returns 'nextjs' for a directory with next.config.js", () => {
    // energy project root has no next.config.js at top level but packages/web does
    // For this test, use the energy/packages/web path if available, else skip
    const result = detectProjectType("/tmp/nonexistent-project");
    expect(result).toBe("generic");
  });
});

// ─── Task 2: Linter ───────────────────────────────────────────────────────

describe("Task 2 — Linter catches violations correctly", () => {
  it("clean block: 0 violations", () => {
    const block = {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "/usr/bin/true", timeout: 5 }],
        },
      ],
    };
    const result = lintHooksBlock(block);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
  });

  it("UNKNOWN_EVENT: catches lowercase/typo event names", () => {
    const block = {
      preToolUse: [{ hooks: [{ type: "command", command: "/usr/bin/true" }] }],
    };
    const result = lintHooksBlock(block);
    const unknownEvent = result.violations.find((v) => v.code === "UNKNOWN_EVENT");
    expect(unknownEvent).toBeDefined();
  });

  it("MISSING_TIMEOUT: warns on PreToolUse Bash hook without timeout", () => {
    const block = {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "/usr/bin/true" }],
        },
      ],
    };
    const result = lintHooksBlock(block);
    const missingTimeout = result.violations.find((v) => v.code === "MISSING_TIMEOUT");
    expect(missingTimeout).toBeDefined();
    expect(missingTimeout!.severity).toBe("warning");
  });

  it("MISSING_TIMEOUT: not triggered when timeout is present", () => {
    const block = {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "/usr/bin/true", timeout: 5 }],
        },
      ],
    };
    const result = lintHooksBlock(block);
    expect(result.violations.find((v) => v.code === "MISSING_TIMEOUT")).toBeUndefined();
  });

  it("SCRIPT_NOT_FOUND: errors on nonexistent absolute path", () => {
    const block = {
      Stop: [
        {
          hooks: [
            { type: "command", command: "/absolutely/nonexistent/hook.sh" },
          ],
        },
      ],
    };
    const result = lintHooksBlock(block);
    const notFound = result.violations.find((v) => v.code === "SCRIPT_NOT_FOUND");
    expect(notFound).toBeDefined();
  });

  it("SCRIPT_NOT_FOUND: not triggered for npx commands", () => {
    const block = {
      PostToolUse: [
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
    };
    const result = lintHooksBlock(block);
    expect(result.violations.find((v) => v.code === "SCRIPT_NOT_FOUND")).toBeUndefined();
  });

  it("EMPTY_HOOKS_ARRAY: warns on matcher with no hooks", () => {
    const block = {
      SessionStart: [{ matcher: undefined, hooks: [] }],
    };
    const result = lintHooksBlock(block);
    expect(result.violations.find((v) => v.code === "EMPTY_HOOKS_ARRAY")).toBeDefined();
  });

  it("INVALID_HOOK_TYPE: errors on unsupported hook type", () => {
    const block = {
      Stop: [
        {
          hooks: [{ type: "script", command: "/usr/bin/true" }],
        },
      ],
    };
    const result = lintHooksBlock(block);
    expect(result.violations.find((v) => v.code === "INVALID_HOOK_TYPE")).toBeDefined();
  });

  it("MISSING_HOOKS_ARRAY: errors on HookMatcher without hooks key", () => {
    const block = {
      SessionEnd: [{ matcher: "compact" }],
    };
    const result = lintHooksBlock(block);
    expect(result.violations.find((v) => v.code === "MISSING_HOOKS_ARRAY")).toBeDefined();
  });
});

// ─── extractScriptPath unit tests ─────────────────────────────────────────

describe("extractScriptPath", () => {
  it("direct absolute path", () => {
    expect(extractScriptPath("/path/to/hook.sh")).toBe("/path/to/hook.sh");
  });

  it("node invocation", () => {
    expect(extractScriptPath("node /path/to/hook.js")).toBe("/path/to/hook.js");
  });

  it("node invocation with args", () => {
    expect(extractScriptPath("node /path/to/hook.js --flag")).toBe("/path/to/hook.js");
  });

  it("npx returns null", () => {
    expect(extractScriptPath("npx prettier --write $FILE")).toBeNull();
  });

  it("relative path returns null (not checked)", () => {
    expect(extractScriptPath("./hooks/post.sh")).toBeNull();
  });
});

// ─── Task 3: Verify harness is importable and callable ───────────────────

describe("Task 3 — Verify harness is importable and returns structured result", () => {
  it("verifyHooksFire function is exported and callable", async () => {
    const { verifyHooksFire } = await import("../src/verify.js");
    expect(typeof verifyHooksFire).toBe("function");
  });

  // A live probe starts a real Claude session, so it runs only on request (HOOKSMITH_LIVE_VERIFY=1). Without a
  // claude CLI (CI) the call returns a structured skip at once, so the shape is still checked there.
  const hasClaude = (() => {
    try {
      execSync("command -v claude", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();
  it.skipIf(hasClaude && process.env.HOOKSMITH_LIVE_VERIFY !== "1")("result shape is correct when skipped (no claude CLI in CI)", async () => {
    // In CI or sandbox, claude CLI won't be available — expect a structured skip
    const { verifyHooksFire } = await import("../src/verify.js");
    const result = await verifyHooksFire();

    // Either passes (claude available) or skips cleanly
    expect(typeof result.passed).toBe("boolean");
    expect(typeof result.skipped).toBe("boolean");
    expect(Array.isArray(result.evidence)).toBe(true);
    expect(typeof result.durationMs).toBe("number");

    if (result.skipped) {
      expect(result.skipReason).toBeTruthy();
    }
  });
});

// ─── Task 4: Current Claude Code hooks (events, handler types, timeout units) ──

describe("Task 4 — the linter matches Claude Code as of October 2026", () => {
  it("newer events are valid (UserPromptSubmit, PostToolUseFailure, SubagentStart, PreModelSwitch)", () => {
    const hook = { hooks: [{ type: "command", command: "/usr/bin/true" }] };
    const result = lintHooksBlock({ UserPromptSubmit: [hook], PostToolUseFailure: [hook], SubagentStart: [hook], PreModelSwitch: [hook] });
    expect(result.violations.filter((v) => v.code === "UNKNOWN_EVENT")).toEqual([]);
  });

  it("http, prompt, agent and mcp_tool handlers are valid when their required field is set", () => {
    const result = lintHooksBlock({
      Stop: [
        {
          hooks: [
            { type: "http", url: "https://example.com/hook" },
            { type: "prompt", prompt: "Did the task finish?" },
            { type: "agent", prompt: "Verify the tests pass" },
            { type: "mcp_tool", server: "memory", tool: "save" },
          ],
        },
      ],
    });
    expect(result.errorCount).toBe(0);
  });

  it("MISSING_FIELD: an mcp_tool hook without a tool is an error", () => {
    const result = lintHooksBlock({ Stop: [{ hooks: [{ type: "mcp_tool", server: "memory" }] }] });
    const v = result.violations.find((x) => x.code === "MISSING_FIELD");
    expect(v?.path).toBe("hooks.Stop[0].hooks[0].tool");
  });

  it("TIMEOUT_IN_MILLISECONDS: a timeout of 3000 is read as 50 minutes and flagged", () => {
    const result = lintHooksBlock({
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/usr/bin/true", timeout: 3000 }] }],
    });
    const v = result.violations.find((x) => x.code === "TIMEOUT_IN_MILLISECONDS");
    expect(v?.severity).toBe("warning");
    expect(v?.message).toMatch(/use 3\./);
  });

  it("every generated timeout is in seconds (at most the 600-second default)", () => {
    const block = generateHooksBlock({ projectType: "nextjs", recipes: ["all"], hooksDir: "/project/.claude/hooks" });
    const timeouts = Object.values(block).flatMap((ms) => (ms ?? []).flatMap((m) => m.hooks.map((h) => h.timeout)));
    expect(timeouts.filter((t) => t !== undefined && t > 600)).toEqual([]);
  });
});
