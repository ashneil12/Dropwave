// Memory v2 merge-on-write (design §3c; Row-Bot dedupe ideas, Apache-2.0).
// Automated writers call saveMemoryMerged: subject/alias lookup -> vector
// similarity -> containment -> conflict prompt. Conflicts park needs_review;
// owner-authority items are never modified.
import type {
  DropwaveMemoryItem,
  DropwaveOperationError as DropwaveOperationErrorType,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";

import * as ServerSettings from "../serverSettings.ts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import type { DropwaveStoreShape } from "./DropwaveStore.ts";
import { cosineSimilarity, memoryEmbedSource } from "./memoryEmbeddings.ts";
import type { MemoryEmbeddingsShape } from "./memoryEmbeddings.ts";
import { DROPWAVE_MEMORY_CONFLICT_PROMPT } from "./memoryPrompts.ts";

const SAME_SOURCE_THRESHOLD = 0.8;
const CROSS_SOURCE_THRESHOLD = 0.9;
const LEXICAL_FALLBACK_THRESHOLD = 0.85;
const MIN_CONTAIN_CHARS = 25;
const CONFLICT_TIMEOUT = "30 seconds";

export interface MemoryWriteInput {
  readonly projectId: Parameters<DropwaveStoreShape["saveMemory"]>[0]["projectId"];
  readonly botThreadId?: Parameters<DropwaveStoreShape["saveMemory"]>[0]["botThreadId"];
  readonly scope?: Parameters<DropwaveStoreShape["saveMemory"]>[0]["scope"];
  readonly personaId?: Parameters<DropwaveStoreShape["saveMemory"]>[0]["personaId"];
  readonly kind: Parameters<DropwaveStoreShape["saveMemory"]>[0]["kind"];
  readonly subject?: string | undefined;
  readonly text: string;
  readonly aliases?: ReadonlyArray<string> | undefined;
  readonly tags?: ReadonlyArray<string> | undefined;
  readonly quote?: string | undefined;
  readonly sourceMessageId?: string | null | undefined;
  readonly threadId?: string | null | undefined;
  readonly evidence?: Parameters<DropwaveStoreShape["saveMemory"]>[0]["evidence"];
  readonly authority?: "owner" | "agent" | "import" | undefined;
  readonly confidence?: Parameters<DropwaveStoreShape["saveMemory"]>[0]["confidence"];
}

function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(normalizeText(text).match(/[\p{L}\p{N}]+/gu) ?? []);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / (a.size + b.size - overlap);
}

function subjectKey(subject: string): string {
  return normalizeText(subject);
}

function isDuplicateCandidate(item: DropwaveMemoryItem, input: MemoryWriteInput): boolean {
  const subject = subjectKey(input.subject ?? "");
  if (subject !== "" && subjectKey(item.subject) === subject) return true;
  const aliases = new Set((input.aliases ?? []).map(subjectKey));
  if (aliases.size > 0 && item.aliases.some((alias) => aliases.has(subjectKey(alias)))) return true;
  if (subject !== "" && item.aliases.some((alias) => subjectKey(alias) === subject)) return true;
  // Two writes quoting overlapping owner words are the same fact even when the
  // stored phrasing diverges enough to defeat bag-of-words text similarity.
  if (quoteSimilarity(input.quote, item.quote) >= 0.6) return true;
  // Subject-less writes still dedupe on near-identical text.
  const inputTokens = tokenSet(`${input.subject ?? ""} ${input.text}`);
  const itemTokens = tokenSet(`${item.subject} ${item.text}`);
  return jaccard(inputTokens, itemTokens) >= 0.6;
}

/**
 * 0..1 similarity between two evidence quotes. Containment scores 1: the same
 * owner sentence can't ground two different facts. Short quotes only score by
 * token overlap so a two-word quote can't false-positive.
 */
function quoteSimilarity(
  quote: string | null | undefined,
  other: string | null | undefined,
): number {
  if (!quote?.trim() || !other?.trim()) return 0;
  const a = normalizeText(quote);
  const b = normalizeText(other);
  if (a.length < 12 || b.length < 12) return 0;
  if (a === b) return 1;
  if (a.length >= MIN_CONTAIN_CHARS && b.includes(a)) return 1;
  if (b.length >= MIN_CONTAIN_CHARS && a.includes(b)) return 1;
  return jaccard(tokenSet(a), tokenSet(b));
}

function sameSource(item: DropwaveMemoryItem, input: MemoryWriteInput): boolean {
  const left = input.sourceMessageId ?? input.threadId ?? input.botThreadId ?? null;
  const right = item.sourceMessageId ?? item.botThreadId ?? null;
  if (left === null || right === null) return true;
  return left === right;
}

function parseConflictVerdict(
  raw: string,
):
  | { readonly contradicts: boolean; readonly reason: string; readonly merged?: string }
  | undefined {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    return {
      contradicts: parsed.contradicts === true,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      ...(typeof parsed.merged === "string" && parsed.merged.trim() !== ""
        ? { merged: parsed.merged }
        : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Save with Row-Bot-style dedupe/merge/conflict. Returns the surviving item:
 * the existing row (evidence touched / text replaced / merged / needs_review),
 * a brand-new row, or the new needs_review candidate when an owner-authority
 * item blocked the write.
 */
export const saveMemoryMerged = Effect.fnUntraced(function* (
  input: MemoryWriteInput & {
    readonly store: DropwaveStoreShape;
    readonly embeddings?: MemoryEmbeddingsShape | undefined;
    readonly textGeneration?: TextGeneration.TextGeneration["Service"] | undefined;
    readonly serverSettings?: ServerSettings.ServerSettingsService["Service"] | undefined;
    readonly workspaceRoot?: string | undefined;
  },
): Effect.fn.Return<DropwaveMemoryItem, DropwaveOperationErrorType, never> {
  const { store } = input;
  const scope = input.scope ?? "project";
  const personaId = scope === "bot" ? (input.personaId ?? null) : null;

  // Candidate pool: same scope visibility as listMemories.
  const pool = yield* store
    .listMemories({
      projectId: input.projectId,
      botThreadId: input.botThreadId ?? undefined,
      ...(personaId != null ? { personaId } : {}),
      statuses: ["active"],
      limit: 300,
    })
    .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<DropwaveMemoryItem>));
  const candidates = pool.filter(
    (item) =>
      item.scope === scope &&
      (scope !== "bot" || item.personaId === personaId) &&
      (scope !== "project" || item.projectId === input.projectId) &&
      isDuplicateCandidate(item, input),
  );
  if (candidates.length === 0) {
    return yield* store.saveMemory(input);
  }

  // Similarity gate: vectors when ready, lexical Jaccard otherwise.
  const newSource = memoryEmbedSource({
    kind: input.kind,
    subject: input.subject ?? "",
    text: input.text,
    aliases: input.aliases ?? [],
    tags: input.tags ?? [],
  });
  let best: { item: DropwaveMemoryItem; score: number } | undefined;
  const embeddings = input.embeddings;
  const vectorsReady =
    embeddings !== undefined &&
    (yield* embeddings.status.pipe(Effect.orElseSucceed(() => undefined)))?.state === "ready";
  if (vectorsReady && embeddings !== undefined) {
    const scored = yield* Effect.gen(function* () {
      const sources = candidates.map((item) =>
        memoryEmbedSource({
          kind: item.kind,
          subject: item.subject,
          text: item.text,
          aliases: item.aliases,
          tags: item.tags,
        }),
      );
      const vectors = yield* embeddings.embed([newSource, ...sources]);
      const queryVector = vectors[0];
      if (queryVector === undefined)
        return [] as Array<{ item: DropwaveMemoryItem; score: number }>;
      return candidates.map((item, index) => ({
        item,
        score: cosineSimilarity(queryVector, vectors[index + 1] ?? queryVector),
      }));
    }).pipe(Effect.orElseSucceed(() => [] as Array<{ item: DropwaveMemoryItem; score: number }>));
    for (const entry of scored) {
      if (best === undefined || entry.score > best.score) best = entry;
    }
  } else {
    const inputTokens = tokenSet(`${input.subject ?? ""} ${input.text}`);
    for (const item of candidates) {
      const score = jaccard(inputTokens, tokenSet(`${item.subject} ${item.text}`));
      // Exact subject/alias matches score high without vectors.
      const boosted =
        subjectKey(input.subject ?? "") !== "" &&
        subjectKey(item.subject) === subjectKey(input.subject ?? "")
          ? Math.max(score, 0.9)
          : score;
      if (best === undefined || boosted > best.score) {
        best = { item, score: boosted };
      }
    }
  }
  if (best === undefined) return yield* store.saveMemory(input);
  // Verbatim quote overlap outranks paraphrase distance: two writes grounded
  // in the same owner words are one fact, so let them reach containment or
  // the conflict prompt instead of saving a lexical lookalike twice.
  for (const item of candidates) {
    const quoteScore = quoteSimilarity(input.quote, item.quote);
    if (quoteScore < 0.8) continue;
    const score = quoteScore >= 1 ? 1 : 0.9;
    if (score > best.score) {
      best = { item, score };
    }
  }
  const threshold = sameSource(best.item, input)
    ? vectorsReady
      ? SAME_SOURCE_THRESHOLD
      : LEXICAL_FALLBACK_THRESHOLD
    : vectorsReady
      ? CROSS_SOURCE_THRESHOLD
      : LEXICAL_FALLBACK_THRESHOLD;
  if (best.score < threshold) return yield* store.saveMemory(input);

  const existing = best.item;
  const newNorm = normalizeText(input.text);
  const oldNorm = normalizeText(existing.text);

  // New text adds nothing the old one doesn't already say: touch evidence only.
  if (newNorm !== oldNorm && newNorm.length >= MIN_CONTAIN_CHARS && oldNorm.includes(newNorm)) {
    const fresh = yield* store.getMemory(existing.id);
    if (fresh === undefined) return yield* store.saveMemory(input);
    const evidence =
      input.evidence ??
      (input.quote
        ? [
            {
              quote: input.quote.slice(0, 500),
              sourceMessageId: input.sourceMessageId ?? null,
              threadId: input.threadId ?? null,
              at: DateTime.formatIso(DateTime.nowUnsafe()),
            },
          ]
        : []);
    if (evidence.length === 0) return fresh;
    return yield* store.withTransaction(
      Effect.gen(function* () {
        const current = yield* store.getMemory(existing.id);
        if (current === undefined) return yield* store.saveMemory(input);
        return yield* store.appendMemoryEvidence({
          id: existing.id,
          revision: current.revision,
          evidence: evidence[0]!,
        });
      }),
    );
  }

  // Old text is fully contained in the new one: replace, journaled by updateMemory.
  if (newNorm !== oldNorm && oldNorm.length >= MIN_CONTAIN_CHARS && newNorm.includes(oldNorm)) {
    return yield* store.withTransaction(
      Effect.gen(function* () {
        const fresh = yield* store.getMemory(existing.id);
        if (fresh === undefined || fresh.authority === "owner") {
          return yield* store.saveMemory(input);
        }
        return yield* store.updateMemory({
          id: existing.id,
          revision: fresh.revision,
          text: input.text.slice(0, 600),
          ...(input.subject !== undefined && input.subject !== fresh.subject
            ? { subject: input.subject }
            : {}),
          by: input.threadId ?? "agent",
        });
      }),
    );
  }

  // Ambiguous pair: one model verdict decides conflict vs merge.
  const modelSelection = yield* Effect.gen(function* () {
    if (
      input.textGeneration === undefined ||
      input.serverSettings === undefined ||
      input.workspaceRoot === undefined
    ) {
      return undefined;
    }
    const projectId = input.projectId ?? null;
    const allSettings = yield* input.serverSettings.getSettings;
    const { settings } = resolveProjectSettings(allSettings, projectId);
    return settings.textGenerationModelSelection ?? settings.defaultModelSelection;
  }).pipe(Effect.orElseSucceed(() => undefined));
  if (
    modelSelection === undefined ||
    input.textGeneration === undefined ||
    input.workspaceRoot === undefined
  ) {
    return yield* store.saveMemory(input);
  }
  const prompt = DROPWAVE_MEMORY_CONFLICT_PROMPT.replace(
    "{{EXISTING_DATE}}",
    existing.updatedAt.slice(0, 10),
  )
    .replace("{{EXISTING}}", existing.text)
    .replace("{{CANDIDATE_SOURCE}}", input.threadId ?? "a new message")
    .replace("{{CANDIDATE_DATE}}", DateTime.formatIso(DateTime.nowUnsafe()).slice(0, 10))
    .replace("{{CANDIDATE}}", input.text);
  const reply = yield* input.textGeneration
    .generateTranscriptionPostProcessing({
      cwd: input.workspaceRoot,
      prompt,
      modelSelection,
    })
    .pipe(
      Effect.timeoutOption(CONFLICT_TIMEOUT),
      Effect.orElseSucceed(() => Option.none()),
    );
  if (Option.isNone(reply)) return yield* store.saveMemory(input);
  const verdict = parseConflictVerdict(reply.value.transcription);
  if (verdict === undefined) return yield* store.saveMemory(input);

  if (verdict.contradicts) {
    if (existing.authority === "owner") {
      // Owner items are never modified: the candidate parks as a new
      // needs_review item linked 'contradicts' to the owner memory.
      return yield* store.withTransaction(
        Effect.gen(function* () {
          const created = yield* store.saveMemory(input);
          const fresh = yield* store.getMemory(created.id);
          if (fresh === undefined) return created;
          yield* store
            .updateMemory({
              id: created.id,
              revision: fresh.revision,
              status: "needs_review",
              conflict: {
                candidate: existing.text,
                reason: verdict.reason || "This clashes with a memory you own.",
                withId: existing.id,
              },
              by: input.threadId ?? "agent",
            })
            .pipe(Effect.catch(() => Effect.void));
          yield* store
            .addMemoryRelation({
              sourceId: created.id,
              targetId: existing.id,
              type: "contradicts",
              confidence: 1,
              origin: "agent",
            })
            .pipe(Effect.catch(() => Effect.void));
          return created;
        }),
      );
    }
    // Non-owner conflict: the OLD item parks as needs_review with the
    // candidate attached; the new text is not written as a separate row.
    return yield* store.withTransaction(
      Effect.gen(function* () {
        const fresh = yield* store.getMemory(existing.id);
        if (fresh === undefined || fresh.status !== "active") {
          return yield* store.saveMemory(input);
        }
        return yield* store.updateMemory({
          id: existing.id,
          revision: fresh.revision,
          status: "needs_review",
          conflict: {
            candidate: input.text.slice(0, 600),
            reason: verdict.reason || "This clashes with a newer memory.",
            withId: null,
          },
          by: input.threadId ?? "agent",
        });
      }),
    );
  }

  // No conflict: merge the texts into the existing row (journaled).
  const mergedText = (verdict.merged ?? `${existing.text} ${input.text}`)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 600);
  return yield* store.withTransaction(
    Effect.gen(function* () {
      const fresh = yield* store.getMemory(existing.id);
      if (fresh === undefined || fresh.authority === "owner") {
        return yield* store.saveMemory(input);
      }
      const aliases = [...new Set([...fresh.aliases, ...(input.aliases ?? [])])].slice(0, 12);
      return yield* store.updateMemory({
        id: existing.id,
        revision: fresh.revision,
        text: mergedText,
        ...(aliases.length !== fresh.aliases.length ? { aliases } : {}),
        by: input.threadId ?? "agent",
      });
    }),
  );
});
