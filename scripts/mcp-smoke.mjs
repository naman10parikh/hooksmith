#!/usr/bin/env node
// hooksmith-mcp end-to-end smoke: start the built server over stdio, list its tools, lint a broken hooks
// block and fire-test an exit-2 guard, the way an MCP client would. Run after `pnpm build`. Exit 0 = pass.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "hooksmith-smoke-"));
const settings = join(dir, "settings.json");
writeFileSync(settings, JSON.stringify({ hooks: { PreToolCall: [{ hooks: [{ type: "command", command: "true" }] }] } }));

const calls = [
  { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "1" } } },
  { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
  { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "hook_lint", arguments: { settingsPath: settings } } },
  {
    jsonrpc: "2.0", id: 4, method: "tools/call",
    params: { name: "hook_test", arguments: { command: "echo blocked >&2; exit 2", toolInput: { command: "ls" } } },
  },
];

const server = spawn("node", [join(root, "dist/src/mcp-server.js")], { stdio: ["pipe", "pipe", "inherit"] });
const replies = new Map();
let buf = "";
server.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) {
      const msg = JSON.parse(line);
      replies.set(msg.id, msg);
    }
  }
});
server.on("close", () => {
  const tools = (replies.get(2)?.result?.tools ?? []).map((t) => t.name);
  const lint = replies.get(3)?.result?.content?.[0]?.text ?? "";
  const fired = JSON.parse(replies.get(4)?.result?.content?.[0]?.text ?? "{}");
  const ok = {
    tools: ["hook_generate", "hook_lint", "hook_test"].every((t) => tools.includes(t)),
    lint: /UNKNOWN_EVENT/.test(lint),
    test: fired.decision === "block" && fired.exitCode === 2,
  };
  if (Object.values(ok).every(Boolean)) {
    console.log("MCP SMOKE PASS: 3 tools listed, hook_lint caught an unknown event, hook_test saw the guard block");
    process.exit(0);
  }
  console.error(`MCP SMOKE FAIL: ${JSON.stringify(ok)}`);
  process.exit(1);
});
setTimeout(() => {
  console.error("MCP SMOKE FAIL: timeout");
  server.kill();
  process.exit(1);
}, 15000);
for (const c of calls) server.stdin.write(`${JSON.stringify(c)}\n`);
server.stdin.end();
