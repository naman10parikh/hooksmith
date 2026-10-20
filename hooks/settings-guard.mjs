#!/usr/bin/env node
// hooksmith settings guard (PostToolUse on Write|Edit|MultiEdit).
// After an agent edits a hooks file (settings.json, settings.local.json or hooks.json), lint its hooks block
// and tell the agent what is wrong. On PostToolUse, exit code 2 shows stderr to the agent: the edit has
// already happened, so this is feedback the agent acts on, not a veto. Any other file: exit 0, silently.
// With hooksmith built (dist/), the full linter runs; without it (a plugin install), the guard still catches
// the two silent failures: invalid JSON (Claude Code then loads no hook from the file) and unknown event names.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Kept equal to VALID_EVENTS in src/linter.ts by tests/settings-guard.test.ts.
const EVENTS = new Set([
  "Setup", "SessionStart", "UserPromptSubmit", "UserPromptExpansion", "PreToolUse", "PermissionRequest",
  "PermissionDenied", "PostToolUse", "PostToolUseFailure", "PostToolBatch", "Stop", "StopFailure",
  "SubagentStart", "SubagentStop", "TaskCreated", "TaskCompleted", "TeammateIdle", "Notification",
  "MessageDisplay", "InstructionsLoaded", "ConfigChange", "CwdChanged", "DirectoryAdded", "FileChanged",
  "WorktreeCreate", "WorktreeRemove", "PreCompact", "PostCompact", "PreModelSwitch", "PostModelSwitch",
  "Elicitation", "ElicitationResult", "SessionEnd",
]);

const HOOK_FILE = /(^|[\\/])(settings(\.local)?\.json|hooks\.json)$/;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

let raw = "";
for await (const chunk of process.stdin) raw += chunk;
let file = "";
try {
  file = JSON.parse(raw)?.tool_input?.file_path ?? "";
} catch {
  process.exit(0); // not a tool event; nothing to check
}
if (!HOOK_FILE.test(file) || !existsSync(file)) process.exit(0);

let settings;
try {
  settings = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  process.stderr.write(`hooksmith: ${file} is not valid JSON, so Claude Code loads no hook from it: ${err.message}\n`);
  process.exit(2);
}
const block = settings?.hooks;
if (!block || typeof block !== "object") process.exit(0);

let problems = [];
const linter = join(root, "dist/src/linter.js");
if (existsSync(linter)) {
  const { lintHooksBlock } = await import(pathToFileURL(linter).href);
  problems = lintHooksBlock(block).violations
    .filter((v) => v.severity === "error")
    .map((v) => `${v.code} at ${v.path}: ${v.message}`);
  const { appendRunLog } = await import(pathToFileURL(join(root, "dist/src/run-log.js")).href);
  appendRunLog("settings-guard", { file: basename(file), errorCount: problems.length });
} else {
  for (const event of Object.keys(block)) {
    if (!EVENTS.has(event)) problems.push(`UNKNOWN_EVENT at hooks.${event}: Claude Code never fires "${event}"`);
  }
}

if (problems.length > 0) {
  process.stderr.write(
    `hooksmith: ${problems.length} hook error(s) in ${file}:\n- ${problems.join("\n- ")}\n` +
      `Details: npx -y -p github:naman10parikh/hooksmith hooksmith lint ${file}\n`,
  );
  process.exit(2);
}
