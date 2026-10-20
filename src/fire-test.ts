/**
 * hooksmith fire-test — run one hook the way Claude Code would: feed it a synthetic event as JSON on stdin,
 * then read its exit code and output and decode the decision (block, deny, ask, allow, defer or pass).
 *
 * Runs locally by default. With `sandbox: "e2b"` it runs inside a fresh E2B Firecracker microVM instead, so
 * an untrusted hook script never touches your machine: the script files the command names are uploaded, the
 * command runs in the VM, and the VM is killed afterwards. E2B needs E2B_API_KEY and the optional `e2b` package.
 */

import { spawnSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { basename, isAbsolute, relative, resolve } from "path";
import { appendRunLog } from "./run-log.js";

export type Decision = "block" | "deny" | "ask" | "allow" | "defer" | "pass";

export interface FireTestInput {
  /** The hook's command, exactly as it appears in settings.json. */
  command: string;
  /** Hook event to simulate. Default: PreToolUse. */
  event?: string;
  /** Tool name for tool events. Default: Bash. */
  toolName?: string;
  /** Tool arguments for tool events. Default: { command: "echo hooksmith-fire-test" }. */
  toolInput?: Record<string, unknown>;
  /** Project directory the hook runs in (also exported as CLAUDE_PROJECT_DIR). Default: the working directory. */
  cwd?: string;
  /** Seconds before the hook is killed. Default: 30. */
  timeoutSec?: number;
  sandbox?: "local" | "e2b";
}

export interface FireTestResult {
  /** The hook ran to completion (it did not time out or fail to start). */
  ok: boolean;
  exitCode: number | null;
  decision: Decision;
  reason: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  sandbox: "local" | "e2b";
  /** Milliseconds until the microVM answered (E2B only). */
  coldStartMs?: number;
  error?: string;
}

const TOOL_EVENTS = new Set(["PreToolUse", "PostToolUse", "PostToolUseFailure", "PermissionRequest", "PermissionDenied"]);

/** The JSON a command hook receives on stdin for this event (the common fields Claude Code sends). */
export function buildPayload(input: FireTestInput, cwd: string): Record<string, unknown> {
  const event = input.event ?? "PreToolUse";
  const payload: Record<string, unknown> = {
    session_id: "hooksmith-fire-test",
    transcript_path: "",
    cwd,
    hook_event_name: event,
  };
  if (TOOL_EVENTS.has(event)) {
    payload.tool_name = input.toolName ?? "Bash";
    payload.tool_input = input.toolInput ?? { command: "echo hooksmith-fire-test" };
    payload.tool_use_id = "toolu_hooksmith_fire_test";
    if (event === "PostToolUse") payload.tool_response = { stdout: "", stderr: "", exit_code: 0 };
  }
  if (event === "UserPromptSubmit") payload.user_message = "hooksmith fire-test";
  return payload;
}

/** Decode a hook's decision from its exit code and output, following the Claude Code hooks reference. */
export function decodeDecision(exitCode: number | null, stdout: string, stderr: string): { decision: Decision; reason: string } {
  if (exitCode === 2) return { decision: "block", reason: stderr.trim() || "exit code 2" };
  const lastJson = stdout
    .trim()
    .split("\n")
    .reverse()
    .find((l) => l.trim().startsWith("{"));
  if (lastJson) {
    try {
      const out = JSON.parse(lastJson) as Record<string, unknown>;
      const specific = (out.hookSpecificOutput ?? {}) as Record<string, unknown>;
      const pd = specific.permissionDecision;
      if (pd === "allow" || pd === "deny" || pd === "ask" || pd === "defer") {
        return { decision: pd, reason: String(specific.permissionDecisionReason ?? "") };
      }
      if (out.decision === "block") return { decision: "block", reason: String(out.reason ?? "") };
      if (out.continue === false) return { decision: "block", reason: String(out.stopReason ?? "continue: false") };
    } catch {
      // Intentionally silent: plain-text stdout is allowed and simply carries no decision.
    }
  }
  if (exitCode !== 0 && exitCode !== null) return { decision: "pass", reason: `non-blocking error (exit ${exitCode})` };
  return { decision: "pass", reason: "" };
}

function runLocal(input: FireTestInput, cwd: string, payload: Record<string, unknown>): FireTestResult {
  const started = Date.now();
  const r = spawnSync("sh", ["-c", input.command], {
    cwd,
    input: JSON.stringify(payload),
    encoding: "utf8",
    timeout: (input.timeoutSec ?? 30) * 1000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd },
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  const timedOut = r.error !== undefined || r.signal !== null;
  return {
    ok: !timedOut,
    exitCode: r.status,
    ...decodeDecision(r.status, stdout, stderr),
    stdout,
    stderr,
    durationMs: Date.now() - started,
    sandbox: "local",
    ...(timedOut ? { error: r.error?.message ?? `killed by ${r.signal}` } : {}),
  };
}

/** Files the command names, as [path on this machine, path in the VM]; the command is rewritten to match. */
function stageFiles(command: string, cwd: string): { files: [string, string][]; vmCommand: string } {
  const files: [string, string][] = [];
  let vmCommand = command.replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, "/home/user/project");
  for (const raw of command.split(/\s+/)) {
    const token = raw.replace(/^["']|["']$/g, "").replace(/\$\{?CLAUDE_PROJECT_DIR\}?/g, cwd);
    if (!token || token.startsWith("-")) continue;
    const local = isAbsolute(token) ? token : resolve(cwd, token);
    if (!existsSync(local) || files.some(([l]) => l === local)) continue;
    const rel = relative(cwd, local);
    const inProject = !rel.startsWith("..") && !isAbsolute(rel);
    const vmPath = inProject ? `/home/user/project/${rel}` : `/home/user/hook/${basename(local)}`;
    files.push([local, vmPath]);
    if (isAbsolute(token)) vmCommand = vmCommand.split(token).join(vmPath);
  }
  return { files, vmCommand };
}

interface E2BSandbox {
  sandboxId: string;
  files: { write(path: string, data: string): Promise<unknown> };
  commands: { run(cmd: string, opts: { timeoutMs: number }): Promise<{ exitCode: number; stdout: string; stderr: string }> };
  kill(): Promise<unknown>;
}

async function runE2B(input: FireTestInput, cwd: string, payload: Record<string, unknown>): Promise<FireTestResult> {
  const started = Date.now();
  const fail = (error: string): FireTestResult => ({
    ok: false, exitCode: null, decision: "pass", reason: "", stdout: "", stderr: "", durationMs: Date.now() - started, sandbox: "e2b", error,
  });
  if (!process.env.E2B_API_KEY) return fail("E2B_API_KEY is not set");
  let Sandbox: { create(opts: { timeoutMs: number }): Promise<E2BSandbox> };
  try {
    const pkg = "e2b"; // a variable, so the build never requires the optional package
    ({ Sandbox } = (await import(pkg)) as { Sandbox: typeof Sandbox });
  } catch {
    return fail("the optional `e2b` package is not installed (npm install e2b)");
  }
  const { files, vmCommand } = stageFiles(input.command, cwd);
  let sbx: E2BSandbox | null = null;
  try {
    const t0 = Date.now();
    sbx = await Sandbox.create({ timeoutMs: 120_000 });
    const coldStartMs = Date.now() - t0;
    for (const [local, vmPath] of files) await sbx.files.write(vmPath, readFileSync(local, "utf8"));
    await sbx.files.write("/home/user/payload.json", JSON.stringify({ ...payload, cwd: "/home/user/project" }));
    const quoted = vmCommand.replace(/'/g, `'\\''`);
    const chmod = files.length ? `chmod +x ${files.map(([, vmPath]) => `'${vmPath}'`).join(" ")} && ` : "";
    const script = `mkdir -p /home/user/project && cd /home/user/project && ${chmod}CLAUDE_PROJECT_DIR=/home/user/project sh -c '${quoted}' < /home/user/payload.json`;
    let exitCode: number;
    let stdout: string;
    let stderr: string;
    try {
      ({ exitCode, stdout, stderr } = await sbx.commands.run(script, { timeoutMs: (input.timeoutSec ?? 30) * 1000 }));
    } catch (e) {
      // The SDK throws on a non-zero exit; the error carries the same fields.
      const ce = e as { exitCode?: number; stdout?: string; stderr?: string; message?: string };
      if (typeof ce.exitCode !== "number") throw e;
      ({ exitCode, stdout = "", stderr = "" } = ce as { exitCode: number; stdout?: string; stderr?: string });
    }
    return {
      ok: true,
      exitCode,
      ...decodeDecision(exitCode, stdout, stderr),
      stdout,
      stderr,
      durationMs: Date.now() - started,
      sandbox: "e2b",
      coldStartMs,
    };
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  } finally {
    await sbx?.kill().catch(() => undefined); // Intentionally silent: the VM also expires on its own timeout.
  }
}

/** Fire one hook with a synthetic event and report what it decided. Never throws. */
export async function fireTest(input: FireTestInput): Promise<FireTestResult> {
  const cwd = resolve(input.cwd ?? process.cwd());
  const payload = buildPayload(input, cwd);
  const result = input.sandbox === "e2b" ? await runE2B(input, cwd, payload) : runLocal(input, cwd, payload);
  appendRunLog("fire-test", {
    event: payload.hook_event_name,
    sandbox: result.sandbox,
    decision: result.decision,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    ...(result.coldStartMs !== undefined ? { coldStartMs: result.coldStartMs } : {}),
  });
  return result;
}
