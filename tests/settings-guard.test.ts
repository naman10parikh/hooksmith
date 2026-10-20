import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { VALID_EVENTS } from "../src/linter.js";
import { fireTest } from "../src/fire-test.js";

const GUARD = resolve(__dirname, "../hooks/settings-guard.mjs");

function editOf(content: string, name = "settings.json"): string {
  const dir = mkdtempSync(join(tmpdir(), "hooksmith-guard-"));
  const file = join(dir, name);
  writeFileSync(file, content);
  return file;
}

const fire = (file: string) =>
  fireTest({ command: `node "${GUARD}"`, event: "PostToolUse", toolName: "Write", toolInput: { file_path: file } });

describe("hooks/settings-guard.mjs", () => {
  it("keeps the same 33 events as the linter (its fallback list)", () => {
    const text = readFileSync(GUARD, "utf8");
    const list = text.slice(text.indexOf("new Set(["), text.indexOf("]);"));
    const events = [...list.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(events.sort()).toEqual([...VALID_EVENTS].sort());
  });

  it("tells the agent about an event Claude Code never fires (exit 2)", async () => {
    const r = await fire(editOf(JSON.stringify({ hooks: { PreToolCall: [{ hooks: [{ type: "command", command: "true" }] }] } })));
    expect(r.decision).toBe("block");
    expect(r.reason).toMatch(/UNKNOWN_EVENT/);
  });

  it("flags a hooks file that is not valid JSON", async () => {
    const r = await fire(editOf('{ "hooks": { "Stop": [ }'));
    expect(r.decision).toBe("block");
    expect(r.reason).toMatch(/not valid JSON/);
  });

  it("stays silent for a clean hooks block and for files that are not hooks files", async () => {
    const clean = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "true", timeout: 5 }] }] } });
    expect((await fire(editOf(clean))).decision).toBe("pass");
    expect((await fire(editOf("not json at all", "notes.md"))).decision).toBe("pass");
  });
});
