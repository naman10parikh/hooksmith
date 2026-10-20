#!/usr/bin/env node
// hooksmith's improvement signal: compare the hook events the linter knows with the events in Claude Code's
// published settings schema (json.schemastore.org). An event upstream that the linter lacks means hooksmith
// would wrongly call a valid hook broken, so it becomes a proposal. Run after `pnpm build`.
//   node scripts/event-drift.mjs [--out proposal.md]
// Exit 0: no drift. Exit 3: drift found (proposal written). Exit 1: the check itself failed.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCHEMA = "https://json.schemastore.org/claude-code-settings.json";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { VALID_EVENTS } = await import(pathToFileURL(join(root, "dist/src/linter.js")).href);

const res = await fetch(SCHEMA);
if (!res.ok) {
  console.error(`event-drift: ${SCHEMA} answered ${res.status}`);
  process.exit(1);
}
const upstream = Object.keys((await res.json())?.properties?.hooks?.properties ?? {});
if (upstream.length === 0) {
  console.error("event-drift: the schema has no hooks.properties; its shape changed, so read it by hand");
  process.exit(1);
}
const missing = upstream.filter((e) => !VALID_EVENTS.has(e));
const docsOnly = [...VALID_EVENTS].filter((e) => !upstream.includes(e));
console.log(`event-drift: schema ${upstream.length} events, linter ${VALID_EVENTS.size}; missing ${missing.length}; docs-only ${docsOnly.join(", ") || "none"}`);
if (missing.length === 0) process.exit(0);

const proposal = [
  `Claude Code's settings schema lists ${missing.length} hook event(s) that \`src/linter.ts\` does not know:`,
  "",
  ...missing.map((e) => `- \`${e}\``),
  "",
  "Until they are added to `VALID_EVENTS` (and to the fallback list in `hooks/settings-guard.mjs`), `hooksmith lint`",
  "reports valid hooks on these events as `UNKNOWN_EVENT` errors.",
  "",
  "Proposed change: add the events to both lists, add one eval case per event in `evals/eval.ts`, and confirm each",
  "against the hooks reference at code.claude.com/docs/en/hooks before merging.",
  "",
  `Source: ${SCHEMA}. Opened by the nightly improvement loop (.github/workflows/improve.yml); a person merges.`,
].join("\n");
const out = process.argv.indexOf("--out");
if (out > 0 && process.argv[out + 1]) writeFileSync(process.argv[out + 1], proposal + "\n");
else console.log(proposal);
process.exit(3);
