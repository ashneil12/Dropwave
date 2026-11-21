// Memory v2 dream: nightly tidy pass (design §5, Row-Bot dream_cycle.py ideas,
// Apache-2.0). Merges duplicates with the lead-authored merge prompt, decays
// dream-origin relations, enriches thin items from their own evidence. Never
// touches owner-authority items; caps changes at 20% of the pool per run.
import type { DropwaveMemoryItem, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as DateTime from "effect/DateTime";
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

  // Phase 1 — merge duplicates: model verdicts happen outside the transaction;
  // every write for the phase lands in one transaction.
  interface MergePlan {
    readonly survivorId: string;
    readonly loserIds: ReadonlyArray<string>;
    readonly mergedText: string;
    readonly mergedSubject: string;
    readonly loserCount: number;
  }
  const mergePlans: Array<MergePlan> = [];
  let plannedCost = 0;
  const undoSnapshots: Array<{
    id: string;
    text: string;
    subject: string;
    kind: string;
    status: string;
    aliases: ReadonlyArray<string>;
  }> = [];
  for (const group of groups) {
    if (group.length < 2) continue;
    // Each plan costs loserCount + 1 changes (survivor update + supersedes).
    if (changes + plannedCost + group.length > changeCap) continue;
    const sorted = [...group].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const survivor = sorted[0]!;
    const losers = sorted.slice(1);
    if (survivor.authority === "owner") continue;
    const identical = losers.every(
      (loser) => normalizeSubject(loser.text) === normalizeSubject(survivor.text),
    );
    let mergedText = survivor.text;
    let mergedSubject = survivor.subject;
    if (!identical) {
      if (modelSelection === undefined || input.textGeneration === undefined) continue;
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
          .pipe(Effect.ignore);
        continue;
      }
      mergedText = verdict.text.slice(0, 600);
      mergedSubject = verdict.subject ?? survivor.subject;
    }
    mergePlans.push({
      survivorId: survivor.id,
      loserIds: losers.map((loser) => loser.id),
      mergedText,
      mergedSubject,
      loserCount: losers.length,
    });
    plannedCost += group.length;
  }
  yield* input.store
    .withTransaction(
      Effect.forEach(
        mergePlans,
        (plan) =>
          Effect.gen(function* () {
            const survivor = yield* input.store.getMemory(plan.survivorId);
            if (
              survivor === undefined ||
              survivor.authority === "owner" ||
              survivor.status !== "active"
            )
              return;
            undoSnapshots.push({
              id: survivor.id,
              text: survivor.text,
              subject: survivor.subject,
              kind: survivor.kind,
              status: survivor.status,
              aliases: survivor.aliases,
            });
            const losers = yield* Effect.forEach(plan.loserIds, (loserId) =>
              input.store.getMemory(loserId).pipe(Effect.orElseSucceed(() => undefined)),
            );
            const liveLosers = losers.filter(
              (loser): loser is DropwaveMemoryItem =>
                loser !== undefined && loser.authority !== "owner",
            );
            const aliases = [
              ...new Set([...survivor.aliases, ...liveLosers.flatMap((loser) => loser.aliases)]),
            ].slice(0, 12);
            yield* input.store
              .updateMemory({
                id: plan.survivorId,
                revision: survivor.revision,
                text: plan.mergedText,
                ...(plan.mergedSubject !== survivor.subject ? { subject: plan.mergedSubject } : {}),
                ...(aliases.length !== survivor.aliases.length ? { aliases } : {}),
                by: "dream",
              })
              .pipe(Effect.ignore);
            for (const loser of liveLosers) {
              undoSnapshots.push({
                id: loser.id,
                text: loser.text,
                subject: loser.subject,
                kind: loser.kind,
                status: loser.status,
                aliases: loser.aliases,
              });
              const relations = yield* input.store
                .listMemoryRelations(loser.id)
                .pipe(Effect.orElseSucceed(() => []));
              for (const relation of relations) {
                const neighborId =
                  relation.targetId === loser.id ? relation.sourceId : relation.targetId;
                if (neighborId === plan.survivorId) continue;
                yield* input.store
                  .addMemoryRelation({
                    sourceId: plan.survivorId,
                    targetId: neighborId,
                    type: relation.type as never,
                    confidence: relation.confidence,
                    origin: "dream",
                  })
                  .pipe(Effect.ignore);
              }
              yield* input.store
                .updateMemory({
                  id: loser.id,
                  revision: loser.revision,
                  status: "superseded",
                  by: "dream",
                })
                .pipe(Effect.ignore);
            }
          }),
        { discard: true },
      ),
    )
    .pipe(Effect.ignore);
  for (const plan of mergePlans) {
    merged += plan.loserCount;
    changes += plan.loserCount + 1;
  }

  // Phase 2 — enrich thin items from their own evidence quotes only, one tx.
  const enrichPlans: Array<{ id: string; text: string }> = [];
  for (const item of items) {
    if (changes + enrichPlans.length >= changeCap) break;
    if (item.authority === "owner" || item.text.length >= THIN_ITEM_CHARS) continue;
    const quote = item.evidence.find(
      (entry) => entry.quote.trim().length > item.text.length,
    )?.quote;
    if (quote === undefined) continue;
    enrichPlans.push({ id: item.id, text: quote.trim().slice(0, 600) });
  }
  yield* input.store
    .withTransaction(
      Effect.forEach(
        enrichPlans,
        (plan) =>
          Effect.gen(function* () {
            const fresh = yield* input.store.getMemory(plan.id);
            if (fresh === undefined) return;
            undoSnapshots.push({
              id: fresh.id,
              text: fresh.text,
              subject: fresh.subject,
              kind: fresh.kind,
              status: fresh.status,
              aliases: fresh.aliases,
            });
            const ok = yield* input.store
              .updateMemory({ id: plan.id, revision: fresh.revision, text: plan.text, by: "dream" })
              .pipe(
                Effect.as(true),
                Effect.orElseSucceed(() => false),
              );
            if (ok) enriched += 1;
          }),
        { discard: true },
      ),
    )
    .pipe(Effect.ignore);
  changes += enrichPlans.length;

  const decay = yield* input.store
    .withTransaction(
      input.store.decayDreamRelations({
        scale: RELATION_DECAY,
        pruneBelow: RELATION_PRUNE_BELOW,
      }),
    )
    .pipe(Effect.orElseSucceed(() => ({ decayed: 0, pruned: 0 })));

  const parts: Array<string> = [];
  if (merged > 0) parts.push(`merged ${merged} duplicates`);
  if (enriched > 0) parts.push(`filled in ${enriched} thin memories`);
  if (decay.pruned > 0) parts.push(`pruned ${decay.pruned} stale links`);
  const summary = parts.length === 0 ? "Nothing needed tidying." : `Tidied: ${parts.join(", ")}.`;
  yield* input.store
    .setMemoryMeta("dream:last", {
      at: DateTime.formatIso(DateTime.nowUnsafe()),
      summary,
      merged,
      enriched,
      relationsDecayed: decay.decayed,
      relationsPruned: decay.pruned,
      ...(undoSnapshots.length > 0 ? { undo: undoSnapshots.slice(0, 200) } : {}),
    })
    .pipe(Effect.ignore);
  return {
    ran: true,
    merged,
    enriched,
    relationsDecayed: decay.decayed,
    relationsPruned: decay.pruned,
    summary,
  };
});
