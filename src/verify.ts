/**
 * hooksmith verify — proves that PreToolUse and PostToolUse hook events
 * actually fire in a Claude Code session using a minimal throwaway config.
 *
 * Strategy:
 *   1. Write a temp settings.json with PreToolUse + PostToolUse hooks that
 *      append a receipt to a temp file.
 *   2. Run `claude --dangerously-skip-permissions -p "echo hooksmith-probe"` in
 *      the temp dir (uses the temp .claude/settings.json).
 *   3. Check that both receipts were written.
 *   4. Report pass/fail with evidence.
 *
 * Note: This requires the `claude` CLI to be available on PATH.
 * If `claude` is not available, the test is skipped with a clear message.
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { tmpdir } from "os";

export interface VerifyResult {
  passed: boolean;
  skipped: boolean;
  skipReason?: string;
  preToolUseFired: boolean;
  postToolUseFired: boolean;
  evidence: string[];
  durationMs: number;
}

export async function verifyHooksFire(): Promise<VerifyResult> {
  const startMs = Date.now();
  const evidence: string[] = [];

  // ── Check claude CLI availability ────────────────────────────────────────
  let claudeBin: string;
  try {
    claudeBin = execSync("which claude", { encoding: "utf8" }).trim();
    evidence.push(`claude CLI found at: ${claudeBin}`);
  } catch {
    return {
      passed: false,
      skipped: true,
      skipReason: "claude CLI not found on PATH — install Claude Code to run verify",
      preToolUseFired: false,
      postToolUseFired: false,
      evidence,
      durationMs: Date.now() - startMs,
    };
  }

  // ── Create temp workspace ────────────────────────────────────────────────
  const tmpDir = join(tmpdir(), `hooksmith-verify-${Date.now()}`);
  const claudeDir = join(tmpDir, ".claude");
  const receiptDir = join(tmpDir, "receipts");

  mkdirSync(claudeDir, { recursive: true });
  mkdirSync(receiptDir, { recursive: true });

  evidence.push(`temp workspace: ${tmpDir}`);

  const preToolReceipt = join(receiptDir, "pre-tool-fired");
  const postToolReceipt = join(receiptDir, "post-tool-fired");

  // ── Write tiny hook scripts ──────────────────────────────────────────────
  const preToolScript = join(claudeDir, "pre-tool-probe.sh");
  const postToolScript = join(claudeDir, "post-tool-probe.sh");

  writeFileSync(
    preToolScript,
    `#!/bin/bash\necho "PreToolUse fired at $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "${preToolReceipt}"\n`,
    { mode: 0o755 },
  );

  writeFileSync(
    postToolScript,
    `#!/bin/bash\necho "PostToolUse fired at $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "${postToolReceipt}"\n`,
    { mode: 0o755 },
  );

  // ── Write minimal settings.json ──────────────────────────────────────────
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: preToolScript,
              timeout: 5, // seconds
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: postToolScript,
            },
          ],
        },
      ],
    },
  };

  writeFileSync(
    join(claudeDir, "settings.json"),
    JSON.stringify(settings, null, 2),
  );

  evidence.push("settings.json written with PreToolUse + PostToolUse hooks");
  evidence.push(`pre-tool script: ${preToolScript}`);
  evidence.push(`post-tool script: ${postToolScript}`);

  // ── Run claude with a minimal prompt that triggers Bash ──────────────────
  try {
    execSync(
      `claude --dangerously-skip-permissions -p "Run: echo hooksmith-probe-complete"`,
      {
        cwd: tmpDir,
        timeout: 60_000,
        encoding: "utf8",
        stdio: "pipe",
      },
    );
    evidence.push("claude session completed");
  } catch (err) {
    evidence.push(
      `claude session error: ${err instanceof Error ? err.message : String(err)}`,
    );
    // Don't return yet — check receipts even if session had a non-zero exit
  }

  // ── Check receipts ───────────────────────────────────────────────────────
  const preToolUseFired = existsSync(preToolReceipt);
  const postToolUseFired = existsSync(postToolReceipt);

  if (preToolUseFired) {
    evidence.push(`PreToolUse receipt: ${readFileSync(preToolReceipt, "utf8").trim()}`);
  } else {
    evidence.push("PreToolUse receipt: NOT FOUND — hook did not fire");
  }

  if (postToolUseFired) {
    evidence.push(`PostToolUse receipt: ${readFileSync(postToolReceipt, "utf8").trim()}`);
  } else {
    evidence.push("PostToolUse receipt: NOT FOUND — hook did not fire");
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────
  try {
    rmSync(tmpDir, { recursive: true });
    evidence.push("temp workspace cleaned up");
  } catch {
    evidence.push(`cleanup failed — manual cleanup needed: rm -rf ${tmpDir}`);
  }

  const passed = preToolUseFired && postToolUseFired;

  return {
    passed,
    skipped: false,
    preToolUseFired,
    postToolUseFired,
    evidence,
    durationMs: Date.now() - startMs,
  };
}
