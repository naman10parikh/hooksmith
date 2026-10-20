/**
 * hooksmith linter — reads an existing settings.json and reports violations.
 *
 * Violations:
 *   - Unknown event names (typos like "preToolUse" instead of "PreToolUse")
 *   - Unknown handler types, and handlers missing their required field (command, url, prompt, server+tool)
 *   - PreToolUse Bash hooks missing `timeout` (they run before EVERY tool call)
 *   - Timeouts written in milliseconds (Claude Code reads seconds, so 3000 means 50 minutes)
 *   - Hook script paths that don't exist on disk
 *   - Hook scripts that aren't executable (POSIX only — skipped on Windows)
 *   - Empty hooks arrays
 *   - Malformed HookMatcher shape (missing `hooks` key)
 */

import { existsSync, accessSync, constants } from "fs";

// ── Types ──────────────────────────────────────────────────────────────────

export type LintSeverity = "error" | "warning" | "info";

export interface LintViolation {
  severity: LintSeverity;
  code: string;
  message: string;
  path: string; // JSON path like "hooks.PreToolUse[0].hooks[1].command"
}

export interface LintResult {
  violations: LintViolation[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

// ── Known event names ──────────────────────────────────────────────────────

// Every event Claude Code fires, as of 19 October 2026: code.claude.com/docs/en/hooks (33 events) and the
// settings schema at json.schemastore.org/claude-code-settings.json (31; it lacks the two model-switch events).
export const VALID_EVENTS = new Set([
  "Setup",
  "SessionStart",
  "UserPromptSubmit",
  "UserPromptExpansion",
  "PreToolUse",
  "PermissionRequest",
  "PermissionDenied",
  "PostToolUse",
  "PostToolUseFailure",
  "PostToolBatch",
  "Stop",
  "StopFailure",
  "SubagentStart",
  "SubagentStop",
  "TaskCreated",
  "TaskCompleted",
  "TeammateIdle",
  "Notification",
  "MessageDisplay",
  "InstructionsLoaded",
  "ConfigChange",
  "CwdChanged",
  "DirectoryAdded",
  "FileChanged",
  "WorktreeCreate",
  "WorktreeRemove",
  "PreCompact",
  "PostCompact",
  "PreModelSwitch",
  "PostModelSwitch",
  "Elicitation",
  "ElicitationResult",
  "SessionEnd",
]);

// Handler types and the field each one requires (from the same schema).
const REQUIRED_FIELDS: Record<string, string[]> = {
  command: ["command"],
  http: ["url"],
  mcp_tool: ["server", "tool"],
  prompt: ["prompt"],
  agent: ["prompt"],
};

/** Claude Code's default hook timeout, in seconds. A larger value was almost always meant as milliseconds. */
const DEFAULT_TIMEOUT_SECONDS = 600;

// ── Linter ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lintHooksBlock(hooksBlock: Record<string, any>): LintResult {
  const violations: LintViolation[] = [];

  function add(
    severity: LintSeverity,
    code: string,
    message: string,
    path: string,
  ): void {
    violations.push({ severity, code, message, path });
  }

  for (const [event, matchers] of Object.entries(hooksBlock)) {
    const eventPath = `hooks.${event}`;

    // Unknown event name
    if (!VALID_EVENTS.has(event)) {
      add(
        "error",
        "UNKNOWN_EVENT",
        `Unknown hook event "${event}". Valid events: ${[...VALID_EVENTS].join(", ")}`,
        eventPath,
      );
      continue;
    }

    if (!Array.isArray(matchers)) {
      add(
        "error",
        "INVALID_MATCHERS",
        `Expected array of HookMatchers at ${eventPath}`,
        eventPath,
      );
      continue;
    }

    for (let mi = 0; mi < matchers.length; mi++) {
      const matcher = matchers[mi];
      const matcherPath = `${eventPath}[${mi}]`;

      if (typeof matcher !== "object" || matcher === null) {
        add("error", "INVALID_MATCHER_SHAPE", "HookMatcher must be an object", matcherPath);
        continue;
      }

      if (!Array.isArray(matcher.hooks)) {
        add(
          "error",
          "MISSING_HOOKS_ARRAY",
          "HookMatcher missing `hooks` array",
          matcherPath,
        );
        continue;
      }

      if (matcher.hooks.length === 0) {
        add(
          "warning",
          "EMPTY_HOOKS_ARRAY",
          "Empty hooks array — this matcher does nothing",
          `${matcherPath}.hooks`,
        );
      }

      for (let hi = 0; hi < matcher.hooks.length; hi++) {
        const hook = matcher.hooks[hi];
        const hookPath = `${matcherPath}.hooks[${hi}]`;

        const required = REQUIRED_FIELDS[String(hook.type)];
        if (!required) {
          add(
            "error",
            "INVALID_HOOK_TYPE",
            `Hook type "${hook.type}" is not supported. Valid types: ${Object.keys(REQUIRED_FIELDS).join(", ")}.`,
            `${hookPath}.type`,
          );
          continue;
        }

        if (typeof hook.timeout === "number" && hook.timeout > DEFAULT_TIMEOUT_SECONDS) {
          add(
            "warning",
            "TIMEOUT_IN_MILLISECONDS",
            `Timeout ${hook.timeout} is read as seconds (${Math.round(hook.timeout / 60)} minutes). If you meant milliseconds, use ${Math.max(1, Math.round(hook.timeout / 1000))}.`,
            `${hookPath}.timeout`,
          );
        }

        if (hook.type !== "command") {
          for (const field of required) {
            if (typeof hook[field] !== "string" || hook[field].trim() === "") {
              add("error", "MISSING_FIELD", `A "${hook.type}" hook needs a "${field}" string`, `${hookPath}.${field}`);
            }
          }
          continue; // the script checks below apply to command hooks only
        }

        if (typeof hook.command !== "string" || hook.command.trim() === "") {
          add("error", "MISSING_COMMAND", "Hook is missing a command string", `${hookPath}.command`);
          continue;
        }

        // Check for timeout on PreToolUse Bash hooks
        if (
          event === "PreToolUse" &&
          (matcher.matcher === "Bash" || !matcher.matcher) &&
          hook.timeout === undefined
        ) {
          add(
            "warning",
            "MISSING_TIMEOUT",
            `PreToolUse Bash hook should specify a timeout in seconds (e.g., 5) to avoid blocking all tool calls`,
            `${hookPath}.timeout`,
          );
        }

        // Extract the script path from the command (first token, handling "node /path" etc.)
        const scriptPath = extractScriptPath(hook.command);
        if (scriptPath) {
          if (!existsSync(scriptPath)) {
            add(
              "error",
              "SCRIPT_NOT_FOUND",
              `Hook script does not exist: ${scriptPath}`,
              `${hookPath}.command`,
            );
          } else if (process.platform !== "win32") {
            // Check executability (skip for .js scripts invoked via node)
            const isNodeInvoked = hook.command.trim().startsWith("node ");
            if (!isNodeInvoked) {
              try {
                accessSync(scriptPath, constants.X_OK);
              } catch {
                add(
                  "error",
                  "SCRIPT_NOT_EXECUTABLE",
                  `Hook script is not executable: ${scriptPath} (run: chmod +x ${scriptPath})`,
                  `${hookPath}.command`,
                );
              }
            }
          }
        }
      }
    }
  }

  return {
    violations,
    errorCount: violations.filter((v) => v.severity === "error").length,
    warningCount: violations.filter((v) => v.severity === "warning").length,
    infoCount: violations.filter((v) => v.severity === "info").length,
  };
}

/**
 * Extracts the file-system path from a hook command string.
 * Handles:
 *   "/path/to/script.sh"           → "/path/to/script.sh"
 *   "node /path/to/script.js"      → "/path/to/script.js"
 *   "npx prettier --write ..."     → null (npx invocations are not checked)
 *   "bash -c '...'"                → null
 */
export function extractScriptPath(command: string): string | null {
  const trimmed = command.trim();

  // node /path/to/script.js [args]
  const nodeMatch = trimmed.match(/^node\s+(\S+)/);
  if (nodeMatch) {
    const p = nodeMatch[1];
    return p && p.startsWith("/") ? p : null;
  }

  // Absolute path directly (shell script)
  const directMatch = trimmed.match(/^(\/\S+)/);
  if (directMatch) {
    // Strip any trailing args — path ends at first space
    return directMatch[1] ?? null;
  }

  return null;
}

// ── Formatter ─────────────────────────────────────────────────────────────

export function formatLintResult(result: LintResult): string {
  if (result.violations.length === 0) {
    return "✓ hooks block: 0 violations";
  }

  const lines: string[] = [];
  for (const v of result.violations) {
    const icon = v.severity === "error" ? "✗" : v.severity === "warning" ? "⚠" : "ℹ";
    lines.push(`${icon} [${v.code}] ${v.path}\n  ${v.message}`);
  }
  lines.push(
    `\n${result.errorCount} error(s), ${result.warningCount} warning(s), ${result.infoCount} info(s)`,
  );
  return lines.join("\n");
}
