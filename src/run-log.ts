/**
 * hooksmith run-log — zero-dependency observability for generated/linted hooks.
 *
 * Writes one JSON line per hooksmith invocation to `logs/run-log.jsonl`
 * relative to the hooksmith repo root.
 *
 * Schema (one object per line):
 *   { ts, op, durationMs, ...opFields }
 *
 * Usage (programmatic):
 *   import { appendRunLog } from './run-log.js'
 *   appendRunLog('generate', { projectRoot, projectType, recipeCount })
 *
 * Usage (CLI, invoked from skills):
 *   node dist/src/run-log.js generate /path/to/project nextjs
 *   node dist/src/run-log.js lint /path/to/settings.json 0 2
 */

import { appendFileSync, mkdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

// ── Locate logs/ dir relative to this module ───────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "../../"); // dist/src → repo root
const LOG_PATH = resolve(repoRoot, "logs/run-log.jsonl");

// ── Log entry shape ────────────────────────────────────────────────────────

export interface RunLogEntry {
  /** ISO timestamp */
  ts: string;
  /** Operation: generate | lint | mcp-generate | mcp-lint | verify */
  op: string;
  /** Additional fields specific to the operation */
  [key: string]: unknown;
}

// ── Core writer ────────────────────────────────────────────────────────────

/**
 * Append one JSON log line to logs/run-log.jsonl.
 * Creates the logs/ directory if it doesn't exist.
 * Never throws — observability must not break the main flow.
 */
export function appendRunLog(op: string, fields: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
    const entry: RunLogEntry = { ts: new Date().toISOString(), op, ...fields };
    appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // Silently skip — a log write failure must never crash the tool
  }
}

// ── CLI entry point ────────────────────────────────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  // node dist/src/run-log.js <op> [...fields as key=value or positional]
  const [, , op = "unknown", ...rest] = process.argv;

  // Parse positional args based on op
  let fields: Record<string, unknown> = {};
  if (op === "generate") {
    const [projectRoot, projectType] = rest;
    fields = { projectRoot, projectType };
  } else if (op === "lint") {
    const [settingsPath, errorCount, warningCount] = rest;
    fields = { settingsPath, errorCount: Number(errorCount), warningCount: Number(warningCount) };
  } else {
    // Generic: treat positional args as an array
    fields = { args: rest };
  }

  appendRunLog(op, fields);
  process.stdout.write(`run-log: wrote entry op=${op}\n`);
}
