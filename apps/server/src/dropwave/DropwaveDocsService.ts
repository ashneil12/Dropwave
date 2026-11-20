// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  type DropwaveDoc,
  type DropwaveDocKind,
  type DropwaveDocSummary,
  DropwaveOperationError,
  type IsoDateTime,
  type ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProjectService from "../project/ProjectService.ts";

const DOCS_DIR_RELATIVE = ".dropwave/docs";
const HUBS_DIR_RELATIVE = ".dropwave/hubs";
const MAX_DOC_BYTES = 250_000;
const ALLOWED_EXT = new Set([".md", ".mdx", ".txt"]);
const ALLOWED_HUB_EXT = new Set([".html"]);
const isDropwaveError = Schema.is(DropwaveOperationError);

function isHubPath(relPath: string): boolean {
  const norm = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return norm.startsWith(`${HUBS_DIR_RELATIVE}/`);
}

function slugifyTitle(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "untitled";
}

function inferKindFromPath(relPath: string): DropwaveDocKind {
  if (isHubPath(relPath)) return "hub";
  const lower = relPath.toLowerCase();
  if (lower.includes("foundation")) return "foundation";
  if (lower.includes("loop") || lower.includes("workflow")) return "loop";
  if (lower.includes("memory") || lower.includes("rules")) return "memory";
  if (lower.includes("spec") || lower.includes("architecture") || lower.includes("plan")) {
    return "spec";
  }
  if (lower.includes("brief") || lower.includes("readme")) return "brief";
  return "note";
}

function extractTitle(relPath: string, content: string): string {
  if (isHubPath(relPath)) {
    const titleMatch = /<title>([^<]{1,160})<\/title>/i.exec(content);
    if (titleMatch?.[1]?.trim()) return titleMatch[1].trim();
  }
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) return trimmed.slice(2).trim().slice(0, 160);
  }
  const base = NodePath.basename(relPath, NodePath.extname(relPath));
  return base.replace(/[-_]+/g, " ").replace(/^\w/, (ch) => ch.toUpperCase());
}

function extractExcerpt(content: string): string {
  if (content.trimStart().startsWith("<")) {
    const metaDesc = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,140})["']/i.exec(
      content,
    );
    if (metaDesc?.[1]) return metaDesc[1];
    return "Interactive custom Dropwave Hub";
  }
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("---")) continue;
    const plain = trimmed.replace(/^[-*•]\s+/, "").replace(/[*_`]/g, "");
    return plain.length > 140 ? `${plain.slice(0, 139).trimEnd()}…` : plain;
  }
  return "";
}

function resolveSafeDocPath(
  workspaceRoot: string,
  relativePath: string,
): { readonly absolute: string; readonly normalized: string } | DropwaveOperationError {
  const cleaned = relativePath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!cleaned || cleaned.includes("..")) {
    return new DropwaveOperationError({
      code: "invalid_input",
      message: "Document path must stay inside the project workspace.",
    });
  }
  const ext = NodePath.extname(cleaned).toLowerCase();
  const allowed = isHubPath(cleaned) ? ALLOWED_HUB_EXT.has(ext) : ALLOWED_EXT.has(ext);
  if (!allowed) {
    return new DropwaveOperationError({
      code: "invalid_input",
      message: isHubPath(cleaned)
        ? "Dropwave hubs support .html files inside .dropwave/hubs/."
        : "Dropwave docs support .md, .mdx, and .txt files.",
    });
  }
  const rootResolved = NodePath.resolve(workspaceRoot);
  const absolute = NodePath.resolve(rootResolved, cleaned);
  if (absolute !== rootResolved && !absolute.startsWith(`${rootResolved}${NodePath.sep}`)) {
    return new DropwaveOperationError({
      code: "invalid_input",
      message: "Document path escapes the project directory.",
    });
  }
  return {
    absolute,
    normalized: NodePath.relative(rootResolved, absolute).replace(/\\/g, "/"),
  };
}

function collectMarkdownFiles(
  rootDir: string,
  dirRelative: string,
  maxDepth: number,
  out: Array<string>,
): void {
  const full = NodePath.resolve(rootDir, dirRelative);
  if (!NodeFS.existsSync(full)) return;
  let entries: Array<NodeFS.Dirent>;
  try {
    entries = NodeFS.readdirSync(full, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && dirRelative === "") continue;
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const rel = dirRelative ? `${dirRelative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (maxDepth > 0) collectMarkdownFiles(rootDir, rel, maxDepth - 1, out);
    } else if (entry.isFile()) {
      const ext = NodePath.extname(entry.name).toLowerCase();
      if (isHubPath(rel) ? ALLOWED_HUB_EXT.has(ext) : ALLOWED_EXT.has(ext)) {
        out.push(rel);
      }
    }
  }
}

function asIsoDateTime(value: string): IsoDateTime {
  return value as IsoDateTime;
}

export interface DropwaveDocsServiceShape {
  readonly listDocs: (
    projectId: ProjectId,
  ) => Effect.Effect<ReadonlyArray<DropwaveDocSummary>, DropwaveOperationError>;
  readonly readDoc: (
    projectId: ProjectId,
    path: string,
  ) => Effect.Effect<DropwaveDoc, DropwaveOperationError>;
  readonly writeDoc: (input: {
    readonly projectId: ProjectId;
    readonly path?: string | undefined;
    readonly title: string;
    readonly kind?: DropwaveDocKind | undefined;
    readonly content: string;
  }) => Effect.Effect<DropwaveDoc, DropwaveOperationError>;
  readonly deleteDoc: (
    projectId: ProjectId,
    path: string,
  ) => Effect.Effect<boolean, DropwaveOperationError>;
}

export class DropwaveDocsService extends Context.Service<
  DropwaveDocsService,
  DropwaveDocsServiceShape
>()("t3/dropwave/DropwaveDocsService") {}

export const layer: Layer.Layer<DropwaveDocsService, never, ProjectService.ProjectService> =
  Layer.effect(
    DropwaveDocsService,
    Effect.gen(function* () {
      const projects = yield* ProjectService.ProjectService;

      const resolveProjectRoot = Effect.fn("DropwaveDocsService.resolveProjectRoot")(function* (
        projectId: ProjectId,
      ) {
        const project = yield* projects.getById(projectId).pipe(
          Effect.mapError(
            (cause) =>
              new DropwaveOperationError({
                code: "storage_error",
                message: cause.message,
              }),
          ),
        );
        if (Option.isNone(project) || project.value.deletedAt !== null) {
          return yield* new DropwaveOperationError({
            code: "not_found",
            message: `Project "${projectId}" not found.`,
          });
        }
        return project.value.workspaceRoot;
      });

      const readSummary = (workspaceRoot: string, relPath: string): DropwaveDocSummary | null => {
        const safe = resolveSafeDocPath(workspaceRoot, relPath);
        if (isDropwaveError(safe)) return null;
        try {
          const stat = NodeFS.statSync(safe.absolute);
          if (!stat.isFile() || stat.size > MAX_DOC_BYTES) return null;
          const content = NodeFS.readFileSync(safe.absolute, "utf8");
          return {
            id: safe.normalized,
            path: safe.normalized,
            title: extractTitle(safe.normalized, content),
            kind: inferKindFromPath(safe.normalized),
            updatedAt: asIsoDateTime(stat.mtime.toISOString()),
            sizeBytes: stat.size,
            excerpt: extractExcerpt(content),
          };
        } catch {
          return null;
        }
      };

      const listDocs = Effect.fn("DropwaveDocsService.listDocs")(function* (projectId: ProjectId) {
        const root = yield* resolveProjectRoot(projectId);
        return yield* Effect.try({
          try: () => {
            const candidates: Array<string> = [];
            collectMarkdownFiles(root, DOCS_DIR_RELATIVE, 2, candidates);
            collectMarkdownFiles(root, HUBS_DIR_RELATIVE, 1, candidates);
            const topDocs = ["README.md", "VISION.md", "SPEC.md", "PLAN.md"];
            for (const file of topDocs) {
              if (NodeFS.existsSync(NodePath.join(root, file))) {
                candidates.push(file);
              }
            }
            const docsFolder: Array<string> = [];
            collectMarkdownFiles(root, "docs", 1, docsFolder);
            for (const file of docsFolder.slice(0, 20)) candidates.push(file);

            const seen = new Set<string>();
            const summaries: Array<DropwaveDocSummary> = [];
            for (const rel of candidates) {
              if (seen.has(rel)) continue;
              seen.add(rel);
              const summary = readSummary(root, rel);
              if (summary) summaries.push(summary);
            }
            return summaries.toSorted((a, b) => {
              const aOwn = a.path.startsWith(`${DOCS_DIR_RELATIVE}/`) ? 0 : 1;
              const bOwn = b.path.startsWith(`${DOCS_DIR_RELATIVE}/`) ? 0 : 1;
              if (aOwn !== bOwn) return aOwn - bOwn;
              return b.updatedAt.localeCompare(a.updatedAt);
            });
          },
          catch: (cause) =>
            new DropwaveOperationError({
              code: "storage_error",
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
      });

      const readDoc = Effect.fn("DropwaveDocsService.readDoc")(function* (
        projectId: ProjectId,
        path: string,
      ) {
        const root = yield* resolveProjectRoot(projectId);
        const safe = resolveSafeDocPath(root, path);
        if (isDropwaveError(safe)) return yield* safe;
        return yield* Effect.try({
          try: (): DropwaveDoc => {
            if (!NodeFS.existsSync(safe.absolute)) {
              throw new DropwaveOperationError({
                code: "not_found",
                message: `Document "${safe.normalized}" not found.`,
              });
            }
            const stat = NodeFS.statSync(safe.absolute);
            if (stat.size > MAX_DOC_BYTES) {
              throw new DropwaveOperationError({
                code: "invalid_input",
                message: "Document is too large to open in Dropwave Docs.",
              });
            }
            const content = NodeFS.readFileSync(safe.absolute, "utf8");
            return {
              id: safe.normalized,
              path: safe.normalized,
              title: extractTitle(safe.normalized, content),
              kind: inferKindFromPath(safe.normalized),
              updatedAt: asIsoDateTime(stat.mtime.toISOString()),
              sizeBytes: stat.size,
              excerpt: extractExcerpt(content),
              content,
            };
          },
          catch: (cause) =>
            isDropwaveError(cause)
              ? cause
              : new DropwaveOperationError({
                  code: "storage_error",
                  message: cause instanceof Error ? cause.message : String(cause),
                }),
        });
      });

      const writeDoc = Effect.fn("DropwaveDocsService.writeDoc")(function* (input: {
        readonly projectId: ProjectId;
        readonly path?: string | undefined;
        readonly title: string;
        readonly kind?: DropwaveDocKind | undefined;
        readonly content: string;
      }) {
        const root = yield* resolveProjectRoot(input.projectId);
        const targetRel =
          input.path?.trim() ||
          (input.kind === "hub"
            ? `${HUBS_DIR_RELATIVE}/${slugifyTitle(input.title)}.html`
            : `${DOCS_DIR_RELATIVE}/${slugifyTitle(input.title)}.md`);
        const safe = resolveSafeDocPath(root, targetRel);
        if (isDropwaveError(safe)) return yield* safe;
        return yield* Effect.try({
          try: (): DropwaveDoc => {
            NodeFS.mkdirSync(NodePath.dirname(safe.absolute), { recursive: true });
            const isHtmlHub = isHubPath(safe.normalized);
            const body = isHtmlHub
              ? input.content
              : input.content.trimStart().startsWith("# ")
                ? input.content
                : `# ${input.title.trim()}\n\n${input.content}`;
            NodeFS.writeFileSync(safe.absolute, body, "utf8");
            const stat = NodeFS.statSync(safe.absolute);
            return {
              id: safe.normalized,
              path: safe.normalized,
              title: extractTitle(safe.normalized, body),
              kind: input.kind ?? inferKindFromPath(safe.normalized),
              updatedAt: asIsoDateTime(stat.mtime.toISOString()),
              sizeBytes: stat.size,
              excerpt: extractExcerpt(body),
              content: body,
            };
          },
          catch: (cause) =>
            new DropwaveOperationError({
              code: "storage_error",
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
      });

      const deleteDoc = Effect.fn("DropwaveDocsService.deleteDoc")(function* (
        projectId: ProjectId,
        path: string,
      ) {
        const root = yield* resolveProjectRoot(projectId);
        const safe = resolveSafeDocPath(root, path);
        if (isDropwaveError(safe)) return yield* safe;
        if (
          !safe.normalized.startsWith(`${DOCS_DIR_RELATIVE}/`) &&
          !safe.normalized.startsWith(`${HUBS_DIR_RELATIVE}/`)
        ) {
          return yield* new DropwaveOperationError({
            code: "forbidden",
            message: "Only Dropwave workspace docs under .dropwave/docs/ can be deleted here.",
          });
        }
        return yield* Effect.try({
          try: () => {
            if (!NodeFS.existsSync(safe.absolute)) return false;
            NodeFS.unlinkSync(safe.absolute);
            return true;
          },
          catch: (cause) =>
            new DropwaveOperationError({
              code: "storage_error",
              message: cause instanceof Error ? cause.message : String(cause),
            }),
        });
      });

      return DropwaveDocsService.of({
        listDocs,
        readDoc,
        writeDoc,
        deleteDoc,
      });
    }),
  );
