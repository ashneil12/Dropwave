// Memory v2 dream: nightly tidy pass (design §5, Row-Bot dream_cycle.py ideas,
// Apache-2.0). Merges duplicates with the lead-authored merge prompt, decays
// dream-origin relations, enriches thin items from their own evidence. Never
// touches owner-authority items; caps changes at 20% of the pool per run.
import type { DropwaveMemoryItem, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ServerSettings from "../serverSettings.ts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import type { DropwaveStoreShape } from "./DropwaveStore.ts";
import { DROPWAVE_MEMORY_DREAM_MERGE_PROMPT } from "./memoryPrompts.ts";

const MAX_CHANGE_RATIO = 0.2;
const MIN_ITEMS_FOR_DREAM = 20;
const THIN_ITEM_CHARS = 80;
const RELATION_DECAY = 0.9;
const RELATION_PRUNE_BELOW = 0.3;
const MERGE_TIMEOUT = "30 seconds";

export interface DreamResult {
  readonly ran: boolean;
  readonly reason?: string;
  readonly merged: number;
  readonly enriched: number;
  readonly relationsDecayed: number;
  readonly relationsPruned: number;
  readonly summary: string;
}

function normalizeSubject(subject: string): string {
  return subject.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Groups likely duplicates: same scope+persona+kind and same normalized subject. */
export function dreamMergeGroups(
  items: ReadonlyArray<DropwaveMemoryItem>,
): Array<Array<DropwaveMemoryItem>> {
  const groups = new Map<string, Array<DropwaveMemoryItem>>();
  for (const item of items) {
    const subject = normalizeSubject(item.subject);
    if (subject === "") continue;
    const key = `${item.scope}|${item.personaId ?? ""}|${item.kind}|${subject}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.length > 1);
}

function parseMergeVerdict(raw: string):
  | {
      readonly merge: boolean;
      readonly subject?: string;
      readonly text?: string;
      readonly reason?: string;
    }
  | undefined {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    return {
      merge: parsed.merge === true,
      ...(typeof parsed.subject === "string" ? { subject: parsed.subject } : {}),
      ...(typeof parsed.text === "string" ? { text: parsed.text } : {}),
      ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * One dream pass. `projectId` scopes model calls/settings; items span the whole
 * environment (owner scope is shared). Returns a short note for the Memory screen.
 */
export const runMemoryDream = Effect.fnUntraced(function* (input: {
  readonly store: DropwaveStoreShape;
  readonly textGeneration: TextGeneration.TextGeneration["Service"] | undefined;
  readonly serverSettings: ServerSettings.ServerSettingsService["Service"] | undefined;
  readonly projectId?: ProjectId | undefined;
  readonly workspaceRoot: string;
}): Effect.fn.Return<DreamResult, never, never> {
  const items = yield* input.store
    .listDreamMemoryItems()
    .pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<DropwaveMemoryItem>));
  if (items.length < MIN_ITEMS_FOR_DREAM) {
    return {
      ran: false,
      reason: `only ${items.length} active memories`,
      merged: 0,
      enriched: 0,
      relationsDecayed: 0,
      relationsPruned: 0,
      summary: "",
    };
  }
  const changeCap = Math.max(1, Math.floor(items.length * MAX_CHANGE_RATIO));
  let changes = 0;
  let merged = 0;
  let enriched = 0;

  const groups = dreamMergeGroups(items);
  const modelSelection = yield* Effect.gen(function* () {
    if (
      input.textGeneration === undefined ||
      input.serverSettings === undefined ||
      input.projectId === undefined
    ) {
      return undefined;
    }
    const allSettings = yield* input.serverSettings.getSettings;
    const { settings } = resolveProjectSettings(allSettings, input.projectId);
    return settings.textGenerationModelSelection ?? settings.defaultModelSelection;
  }).pipe(Effect.orElseSucceed(() => undefined));

  for (const group of groups) {
    if (changes >= changeCap) break;
    if (group.length < 2) continue;
    // Deterministic near-duplicates merge without a model call.
    const sorted = [...group].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const survivor = sorted[0]!;
    const losers = sorted.slice(1);
    const identical = losers.every(
      (loser) => normalizeSubject(loser.text) === normalizeSubject(survivor.text),
    );
    let mergedText = survivor.text;
    let mergedSubject = survivor.subject;
    if (!identical && modelSelection !== undefined && input.textGeneration !== undefined) {
      const rejectionKey = `dream-merge:${group
        .map((item) => item.id)
        .sort()
        .join("|")}`;
      const rejected = yield* input.store
        .getMemoryRejection(rejectionKey)
        .pipe(Effect.orElseSucceed(() => undefined));
      if (rejected !== undefined) continue;
      const prompt = DROPWAVE_MEMORY_DREAM_MERGE_PROMPT.replace(
        "{{ITEMS}}",
        group.map((item, index) => `${index + 1}. ${item.text}`).join("\n"),
      );
      const reply = yield* input.textGeneration
        .generateTranscriptionPostProcessing({
          cwd: input.workspaceRoot,
          prompt,
          modelSelection,
        })
        .pipe(
          Effect.timeoutOption(MERGE_TIMEOUT),
          Effect.orElseSucceed(() => Option.none()),
        );
      if (Option.isNone(reply)) continue;
      const verdict = parseMergeVerdict(reply.value.transcription);
      if (verdict?.merge !== true || verdict.text === undefined) {
        yield* input.store
          .putMemoryRejection({ hash: rejectionKey, verdict, ttlDays: 30 })
          .pipe(Effect.catch(() => Effect.void));
        continue;
      }
      mergedText = verdict.text.slice(0, 600);
      mergedSubject = verdict.subject ?? survivor.subject;
    } else if (!identical) {
      continue;
    }
    const fresh = yield* input.store
      .getMemory(survivor.id)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (fresh === undefined || fresh.authority === "owner" || fresh.status !== "active") continue;
    const aliases = [...new Set([...fresh.aliases, ...losers.flatMap((loser) => loser.aliases)])];
    yield* input.store
      .updateMemory({
        id: survivor.id,
        revision: fresh.revision,
        text: mergedText,
        ...(mergedSubject !== fresh.subject ? { subject: mergedSubject } : {}),
        ...(aliases.length !== fresh.aliases.length ? { aliases } : {}),
        by: "dream",
      })
      .pipe(Effect.catch(() => Effect.void));
    // Re-point relations from losers onto the survivor, then supersede losers.
    for (const loser of losers) {
      const relations = yield* input.store
        .listMemoryRelations(loser.id)
        .pipe(Effect.orElseSucceed(() => []));
      for (const relation of relations) {
        const neighborId = relation.targetId === loser.id ? relation.sourceId : relation.targetId;
        if (neighborId === survivor.id) continue;
        yield* input.store
          .addMemoryRelation({
            sourceId: survivor.id,
            targetId: neighborId,
            type: relation.type as never,
            confidence: relation.confidence,
            origin: "dream",
          })
          .pipe(Effect.catch(() => Effect.void));
      }
      const loserFresh = yield* input.store
        .getMemory(loser.id)
        .pipe(Effect.orElseSucceed(() => undefined));
      if (loserFresh !== undefined && loserFresh.authority !== "owner") {
        yield* input.store
          .updateMemory({
            id: loser.id,
            revision: loserFresh.revision,
            status: "superseded",
            by: "dream",
          })
          .pipe(Effect.catch(() => Effect.void));
      }
    }
    merged += losers.length;
    changes += losers.length + 1;
  }

  // Enrich thin items from their own evidence quotes only.
  for (const item of items) {
    if (changes >= changeCap) break;
    if (item.authority === "owner" || item.text.length >= THIN_ITEM_CHARS) continue;
    const quote = item.evidence.find(
      (entry) => entry.quote.trim().length > item.text.length,
    )?.quote;
    if (quote === undefined) continue;
    const fresh = yield* input.store.getMemory(item.id).pipe(Effect.orElseSucceed(() => undefined));
    if (fresh === undefined) continue;
    const ok = yield* input.store
      .updateMemory({
        id: item.id,
        revision: fresh.revision,
        text: quote.trim().slice(0, 600),
        by: "dream",
      })
      .pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      );
    if (ok) {
      enriched += 1;
      changes += 1;
    }
  }

  const decay = yield* input.store
    .decayDreamRelations({ scale: RELATION_DECAY, pruneBelow: RELATION_PRUNE_BELOW })
    .pipe(Effect.orElseSucceed(() => ({ decayed: 0, pruned: 0 })));

  const parts: Array<string> = [];
  if (merged > 0) parts.push(`merged ${merged} duplicates`);
  if (enriched > 0) parts.push(`filled in ${enriched} thin memories`);
  if (decay.pruned > 0) parts.push(`pruned ${decay.pruned} stale links`);
  const summary = parts.length === 0 ? "Nothing needed tidying." : `Tidied: ${parts.join(", ")}.`;
  yield* input.store
    .setMemoryMeta("dream:last", {
      at: new Date().toISOString(),
      summary,
      merged,
      enriched,
      relationsDecayed: decay.decayed,
      relationsPruned: decay.pruned,
    })
    .pipe(Effect.catch(() => Effect.void));
  return {
    ran: true,
    merged,
    enriched,
    relationsDecayed: decay.decayed,
    relationsPruned: decay.pruned,
    summary,
  };
});
