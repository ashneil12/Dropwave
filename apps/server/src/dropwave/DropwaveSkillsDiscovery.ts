// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalDate:off -- cache TTL bookkeeping, not turn timing.
// Discovers skills installed on this machine and knowledge libraries available to Dropwave
// bots. Cached: the scan hits the filesystem at most once per TTL window, not per turn.

import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import type { DropwaveLibraryRoot, DropwaveSkillEntry } from "./personality/composePersonality.ts";

const SKILLS_TTL_MS = 60_000;
const DESCRIPTION_CAP = 300;

const SKILL_DIRS = [
  ".agents/skills",
  ".claude/skills",
  ".codex/skills",
  ".config/devin/skills",
] as const;

const OWNER_LIBRARY_DIR = ".config/dropwave/library";

let skillsCache: {
  readonly at: number;
  readonly entries: ReadonlyArray<DropwaveSkillEntry>;
} | null = null;
let skillsScan: Promise<ReadonlyArray<DropwaveSkillEntry>> | null = null;

function parseSkillFrontmatter(text: string): { name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const body = match[1] ?? "";
  const name = /^name:\s*"?([^"\n]+?)"?\s*$/m.exec(body)?.[1]?.trim();
  let description: string | undefined;
  const inline = /^description:\s*"?([^"\n]+?)"?\s*$/m.exec(body)?.[1]?.trim();
  if (inline) {
    description = inline;
  } else {
    const folded = /^description:\s*[|>]\s*\r?\n((?:[ \t]+\S[^\n]*\r?\n?)+)/m.exec(body)?.[1];
    if (folded) description = folded.replace(/[ \t]+/g, " ").trim();
  }
  const out: { name?: string; description?: string } = {};
  if (name) out.name = name;
  if (description) out.description = description;
  return out;
}

async function scanSkillDir(dir: string, seen: Set<string>): Promise<DropwaveSkillEntry[]> {
  let children;
  try {
    children = await NodeFSP.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const entries: DropwaveSkillEntry[] = [];
  for (const child of children) {
    const skillPath = NodePath.join(dir, child.name, "SKILL.md");
    try {
      const real = await NodeFSP.realpath(skillPath);
      if (seen.has(real)) continue;
      const text = await NodeFSP.readFile(real, "utf8");
      seen.add(real);
      const { name, description } = parseSkillFrontmatter(text);
      if (!name) continue;
      entries.push({
        name,
        description: (description ?? "").slice(0, DESCRIPTION_CAP),
        path: real,
      });
    } catch {
      continue;
    }
  }
  return entries;
}

async function scanSkills(): Promise<ReadonlyArray<DropwaveSkillEntry>> {
  const home = NodeOS.homedir();
  const seen = new Set<string>();
  const entries: DropwaveSkillEntry[] = [];
  for (const rel of SKILL_DIRS) {
    entries.push(...(await scanSkillDir(NodePath.join(home, rel), seen)));
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

export function discoverSkills(): Promise<ReadonlyArray<DropwaveSkillEntry>> {
  const now = Date.now();
  if (skillsCache && now - skillsCache.at < SKILLS_TTL_MS) {
    return Promise.resolve(skillsCache.entries);
  }
  skillsScan ??= scanSkills()
    .then((entries) => {
      skillsCache = { at: Date.now(), entries };
      return entries;
    })
    .catch(() => skillsCache?.entries ?? [])
    .finally(() => {
      skillsScan = null;
    });
  return skillsScan;
}

async function firstExistingDir(candidates: ReadonlyArray<string>): Promise<string | undefined> {
  for (const candidate of candidates) {
    try {
      if ((await NodeFSP.stat(candidate)).isDirectory()) return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

export async function dropwaveLibraryRoots(): Promise<ReadonlyArray<DropwaveLibraryRoot>> {
  const home = NodeOS.homedir();
  const moduleDir = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
  const roots: DropwaveLibraryRoot[] = [];
  // The bundled server may ship the library next to this module; dev reads the source copy.
  const bundled = await firstExistingDir([
    NodePath.join(moduleDir, "library"),
    NodePath.join(moduleDir, "personality", "library"),
  ]);
  if (bundled !== undefined) {
    roots.push({ label: "Dropwave knowledge library", absolutePath: bundled });
  }
  const ownerLibrary = await firstExistingDir([NodePath.join(home, OWNER_LIBRARY_DIR)]);
  if (ownerLibrary !== undefined) {
    roots.push({ label: "Owner's private library", absolutePath: ownerLibrary });
  }
  return roots;
}
