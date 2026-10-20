/**
 * hooksmith recall — the searchable layer over hooksmith's own memory: identity/ (SOUL, MEMORY, LEARNINGS,
 * HEARTBEAT), the skills and the recipe catalog. Markdown is split into sections by heading; each recipe is
 * its own section. Ranking: sections matching more distinct query terms first, then TF-IDF.
 *
 *   hooksmith recall "timeout seconds"        (CLI)
 *   recall("timeout seconds", repoRoot, 5)     (code)
 */

import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import { fileURLToPath } from "url";

export interface RecallHit {
  file: string;
  heading: string;
  snippet: string;
  matched: number;
  score: number;
}

interface Section {
  file: string;
  heading: string;
  text: string;
}

/** hooksmith's own root: two levels up from dist/src/, one level up from src/. */
export function hooksmithRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const up2 = resolve(here, "../..");
  return existsSync(join(up2, "catalog")) ? up2 : resolve(here, "..");
}

const tokens = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g)?.filter((t) => t.length > 1) ?? [];

function markdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? markdownFiles(p) : n.endsWith(".md") ? [p] : [];
  });
}

function sections(root: string): Section[] {
  const out: Section[] = [];
  for (const path of [...markdownFiles(join(root, "identity")), ...markdownFiles(join(root, "skills"))]) {
    let heading = relative(root, path);
    let buf: string[] = [];
    const flush = (): void => {
      if (buf.join("").trim()) out.push({ file: relative(root, path), heading, text: buf.join("\n") });
      buf = [];
    };
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (/^#{1,4}\s/.test(line)) {
        flush();
        heading = line.replace(/^#+\s*/, "");
      } else buf.push(line);
    }
    flush();
  }
  const catalog = join(root, "catalog", "recipes.json");
  if (existsSync(catalog)) {
    const recipes = (JSON.parse(readFileSync(catalog, "utf8")) as { recipes?: Record<string, unknown>[] }).recipes ?? [];
    for (const r of recipes) out.push({ file: "catalog/recipes.json", heading: `recipe ${String(r.id ?? "")}`, text: JSON.stringify(r) });
  }
  return out;
}

/** Search hooksmith's memory; returns the top `limit` sections, most relevant first. */
export function recall(query: string, root: string = hooksmithRoot(), limit = 5): RecallHit[] {
  const q = [...new Set(tokens(query))];
  const docs = sections(root).map((s) => ({ ...s, toks: tokens(`${s.heading} ${s.text}`) }));
  const df = new Map(q.map((t) => [t, docs.filter((d) => d.toks.includes(t)).length]));
  const hits = docs.map((d) => {
    let matched = 0;
    let score = 0;
    for (const t of q) {
      const tf = d.toks.filter((x) => x === t).length;
      if (!tf) continue;
      matched++;
      score += (1 + Math.log(tf)) * Math.log(1 + docs.length / (df.get(t) ?? 1));
    }
    const line = d.text.split("\n").find((l) => q.some((t) => l.toLowerCase().includes(t))) ?? d.text.split("\n")[0] ?? "";
    return { file: d.file, heading: d.heading, snippet: line.trim().slice(0, 200), matched, score };
  });
  return hits.filter((h) => h.matched > 0).sort((a, b) => b.matched - a.matched || b.score - a.score).slice(0, limit);
}
