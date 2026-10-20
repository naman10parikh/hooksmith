import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildPayload, decodeDecision, fireTest } from "../src/fire-test.js";
import { recall } from "../src/recall.js";

function hookDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hooksmith-fire-"));
  writeFileSync(join(dir, "exit2.sh"), '#!/bin/sh\nif grep -q "rm -rf"; then echo "no rm -rf" >&2; exit 2; fi\n', { mode: 0o755 });
  writeFileSync(
    join(dir, "deny.cjs"),
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const i=JSON.parse(s);' +
      'if(i.tool_input.command.includes("curl")) console.log(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:"no network"}}));});\n',
  );
  return dir;
}

describe("decodeDecision follows the Claude Code hooks reference", () => {
  it("exit 2 blocks, with stderr as the reason", () => {
    expect(decodeDecision(2, "", "nope\n")).toEqual({ decision: "block", reason: "nope" });
  });
  it("permissionDecision in hookSpecificOutput wins", () => {
    const out = JSON.stringify({ hookSpecificOutput: { permissionDecision: "ask", permissionDecisionReason: "check" } });
    expect(decodeDecision(0, `log line\n${out}\n`, "")).toEqual({ decision: "ask", reason: "check" });
  });
  it("decision: block and continue: false both block", () => {
    expect(decodeDecision(0, JSON.stringify({ decision: "block", reason: "r" }), "").decision).toBe("block");
    expect(decodeDecision(0, JSON.stringify({ continue: false, stopReason: "s" }), "")).toEqual({ decision: "block", reason: "s" });
  });
  it("other exit codes are non-blocking", () => {
    expect(decodeDecision(1, "", "boom")).toEqual({ decision: "pass", reason: "non-blocking error (exit 1)" });
  });
});

describe("buildPayload", () => {
  it("tool events carry tool_name and tool_input; others do not", () => {
    const pre = buildPayload({ command: "x", toolInput: { command: "ls" } }, "/p");
    expect(pre).toMatchObject({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" }, cwd: "/p" });
    expect(buildPayload({ command: "x", event: "Stop" }, "/p").tool_name).toBeUndefined();
  });
});

describe("fireTest runs a hook the way Claude Code would (local)", () => {
  it("an exit-2 guard blocks rm -rf and passes ls", async () => {
    const cwd = hookDir();
    expect((await fireTest({ command: "./exit2.sh", cwd, toolInput: { command: "rm -rf /" } })).decision).toBe("block");
    expect((await fireTest({ command: "./exit2.sh", cwd, toolInput: { command: "ls" } })).decision).toBe("pass");
  });
  it("a JSON guard denies with its reason", async () => {
    const r = await fireTest({ command: "node deny.cjs", cwd: hookDir(), toolInput: { command: "curl x" } });
    expect(r).toMatchObject({ ok: true, decision: "deny", reason: "no network", sandbox: "local" });
  });
  it("a hook that hangs is killed at its timeout and reported", async () => {
    const r = await fireTest({ command: "sleep 5", cwd: hookDir(), timeoutSec: 1 });
    expect(r.ok).toBe(false);
  });
  it("E2B without a key refuses cleanly", async () => {
    const saved = process.env.E2B_API_KEY;
    delete process.env.E2B_API_KEY;
    try {
      const r = await fireTest({ command: "true", sandbox: "e2b" });
      expect(r.error).toMatch(/E2B_API_KEY/);
    } finally {
      if (saved !== undefined) process.env.E2B_API_KEY = saved;
    }
  });
  it.skipIf(!process.env.E2B_API_KEY)("inside a live E2B microVM the same guard blocks", async () => {
    const r = await fireTest({ command: "./exit2.sh", cwd: hookDir(), toolInput: { command: "rm -rf /" }, sandbox: "e2b" });
    expect(r).toMatchObject({ ok: true, decision: "block", sandbox: "e2b" });
    expect(r.coldStartMs).toBeGreaterThan(0);
  }, 120_000);
});

describe("recall searches hooksmith's own memory", () => {
  it("finds the recipe catalog entry for a blocking guard", () => {
    const hits = recall("block dangerous bash");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.file === "catalog/recipes.json")).toBe(true);
  });
});
