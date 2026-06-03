#!/usr/bin/env node
/**
 * hooksmith MCP server — exposes hook-generate and hook-lint as MCP tools
 * via the stdio JSON-RPC protocol used by Claude Code's MCP integration.
 *
 * Tools:
 *   hook_generate  — generate a hooks block for a project root
 *   hook_lint      — lint an existing settings.json hooks block
 *
 * Protocol: MCP 2024-11-05 (JSON-RPC 2.0 over stdio)
 * Zero runtime dependencies — uses only Node built-ins + hooksmith's own modules.
 */

import * as readline from "readline";
import { generateHooksBlock, detectProjectType } from "./generator.js";
import { lintHooksBlock, formatLintResult } from "./linter.js";
import { appendRunLog } from "./run-log.js";
import { readFileSync } from "fs";
import { resolve } from "path";

// ── MCP wire types (minimal subset we actually use) ───────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

// ── Server metadata ────────────────────────────────────────────────────────

const SERVER_INFO = {
  name: "hooksmith",
  version: "0.1.0",
};

const TOOLS = [
  {
    name: "hook_generate",
    description:
      "Generate a Claude Code settings.json hooks block for a project. " +
      "Auto-detects project type (nextjs|node|python|generic). " +
      "Returns the JSON hooks block ready to merge into settings.json.",
    inputSchema: {
      type: "object",
      properties: {
        projectRoot: {
          type: "string",
          description: "Absolute path to the project root directory",
        },
        projectType: {
          type: "string",
          enum: ["nextjs", "node", "python", "generic"],
          description: "Override auto-detected project type (optional)",
        },
        recipes: {
          type: "array",
          items: { type: "string" },
          description:
            "Recipe IDs to include. Omit for all defaults. " +
            "Options: session-start, compact-restore, pre-tool-block, " +
            "post-write-format, post-push-verify, audit-log, pre-compact-flush, " +
            "task-gate, rate-limit-recover, session-end-log",
        },
      },
      required: ["projectRoot"],
    },
  },
  {
    name: "hook_lint",
    description:
      "Lint an existing Claude Code settings.json hooks block. " +
      "Reports violations: unknown events, missing scripts, missing timeouts, etc. " +
      "Returns a structured result with errorCount, warningCount, and violation list.",
    inputSchema: {
      type: "object",
      properties: {
        settingsPath: {
          type: "string",
          description:
            "Absolute path to the settings.json file to lint. " +
            "Defaults to .claude/settings.json in current directory.",
        },
      },
      required: ["settingsPath"],
    },
  },
];

// ── Tool handlers ──────────────────────────────────────────────────────────

function handleHookGenerate(
  params: Record<string, unknown>,
): { content: Array<{ type: "text"; text: string }> } {
  const projectRoot = resolve(String(params["projectRoot"] ?? "."));
  const detectedType = detectProjectType(projectRoot);
  const projectType =
    (params["projectType"] as string | undefined) ?? detectedType;

  const rawRecipes = params["recipes"];
  const recipes =
    Array.isArray(rawRecipes) && rawRecipes.length > 0
      ? (rawRecipes as string[])
      : (["all"] as ["all"]);

  const hooksDir = `${projectRoot}/.claude/hooks`;
  const block = generateHooksBlock({
    projectType: projectType as "nextjs" | "node" | "python" | "generic",
    recipes: recipes as Parameters<typeof generateHooksBlock>[0]["recipes"],
    hooksDir,
  });

  appendRunLog("mcp-generate", { projectRoot, projectType, detectedType });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ hooks: block }, null, 2),
      },
    ],
  };
}

function handleHookLint(
  params: Record<string, unknown>,
): { content: Array<{ type: "text"; text: string }> } {
  const settingsPath = resolve(String(params["settingsPath"] ?? ".claude/settings.json"));

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Error reading ${settingsPath}: ${msg}` }],
    };
  }

  const hooksBlock = settings["hooks"] as Record<string, unknown> | undefined;
  if (!hooksBlock) {
    return {
      content: [{ type: "text", text: `No "hooks" key found in ${settingsPath}` }],
    };
  }

  const result = lintHooksBlock(hooksBlock as Record<string, unknown>);
  appendRunLog("mcp-lint", {
    settingsPath,
    errorCount: result.errorCount,
    warningCount: result.warningCount,
  });

  return {
    content: [
      {
        type: "text",
        text: formatLintResult(result),
      },
    ],
  };
}

// ── JSON-RPC dispatcher ────────────────────────────────────────────────────

function respond(id: string | number, result: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, result } as JsonRpcResponse);
}

function respondError(id: string | number, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } } as JsonRpcResponse);
}

function dispatch(req: JsonRpcRequest): string {
  const { id, method, params = {} } = req;

  switch (method) {
    case "initialize":
      return respond(id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case "tools/list":
      return respond(id, { tools: TOOLS });

    case "tools/call": {
      const toolName = params["name"] as string | undefined;
      const toolArgs = (params["arguments"] ?? {}) as Record<string, unknown>;

      if (toolName === "hook_generate") {
        return respond(id, handleHookGenerate(toolArgs));
      }
      if (toolName === "hook_lint") {
        return respond(id, handleHookLint(toolArgs));
      }
      return respondError(id, -32601, `Unknown tool: ${toolName}`);
    }

    case "notifications/initialized":
      // One-way — no response needed; but we must not error on it
      return ""; // empty string = skip write

    default:
      return respondError(id, -32601, `Method not found: ${method}`);
  }
}

// ── stdio transport ────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let req: JsonRpcRequest;
  try {
    req = JSON.parse(trimmed) as JsonRpcRequest;
  } catch {
    process.stdout.write(
      respondError(0, -32700, "Parse error") + "\n",
    );
    return;
  }

  const out = dispatch(req);
  if (out) {
    process.stdout.write(out + "\n");
  }
});

rl.on("close", () => {
  process.exit(0);
});
