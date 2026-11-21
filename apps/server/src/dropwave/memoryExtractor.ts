// Memory v2 writers: windowed extraction over owner messages, idle/count
// triggered, quote-verified, score >= 0.8. Prompts verbatim in memoryPrompts.ts.
import type {
  DropwaveMemoryConfidence,
  DropwaveMemoryItem,
  DropwaveMemoryKind,
  DropwaveMemoryScope,
  DropwaveOperationError as DropwaveOperationErrorType,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { DropwaveOperationError } from "@t3tools/contracts";
import type { OrchestrationV2ConversationMessage } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as ServerSettings from "../serverSettings.ts";
import type * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { isOwnerTypedMessage, quoteInMessage } from "./askExtraction.ts";
import { saveMemoryMerged } from "./memoryDedupe.ts";
import type * as MemoryEmbeddings from "./memoryEmbeddings.ts";
import type { DropwaveStoreShape } from "./DropwaveStore.ts";
import { DROPWAVE_MEMORY_EXTRACTION_PROMPT } from "./memoryPrompts.ts";

const VALID_SCOPES = new Set<DropwaveMemoryScope>(["owner", "bot", "project"]);
const VALID_KINDS = new Set<DropwaveMemoryKind>([
  "fact",
  "preference",
  "rule",
  "decision",
  "lesson",
  "person",
  "project",
  "tool",
]);
const MAX_OPS_PER_WINDOW = 8;
const MIN_OP_CONFIDENCE = 0.8;
const WINDOW_MESSAGE_LIMIT = 60;
const WINDOW_CHAR_BUDGET = 8000;

const dependencyError =
  (what: string) =>
  (cause: unknown): DropwaveOperationErrorType =>
    new DropwaveOperationError({
      code: "storage_error",
      message: `Memory extraction could not ${what}: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
const ASSISTANT_CLIP = 200;

export interface MemoryExtractionOp {
  readonly op: "add" | "update";
  readonly id?: string;
  readonly scope: DropwaveMemoryScope;
  readonly kind: DropwaveMemoryKind;
  readonly subject: string;
  readonly text: string;
  readonly quote: string;
  readonly score: number;
  readonly confidence: DropwaveMemoryConfidence;
}

export function confidenceFromScore(score: number): DropwaveMemoryConfidence {
  if (score >= 0.9) return "confirmed";
  if (score >= 0.8) return "learned";
  return "mentioned";
}

function parseFirstJsonArray(raw: string): Array<unknown> | undefined {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start === -1 || end <= start) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isOwnerMessage(message: OrchestrationV2ConversationMessage): boolean {
  return isOwnerTypedMessage(message);
}

/** Format the extraction window: owner lines full, assistant clipped, rest skipped. */
export function formatExtractionWindow(
  messages: ReadonlyArray<OrchestrationV2ConversationMessage>,
): { readonly window: string; readonly ownerTexts: ReadonlyArray<string> } {
  const lines: Array<string> = [];
  const ownerTexts: Array<string> = [];
  let budget = WINDOW_CHAR_BUDGET;
  for (const message of messages) {
    if (budget <= 0) break;
    if (isOwnerMessage(message)) {
      const text = message.text.trim();
      if (!text) continue;
      ownerTexts.push(text);
      const clipped = text.length > budget ? text.slice(0, budget) : text;
      lines.push(`Owner: ${clipped}`);
      budget -= clipped.length;
    } else if (message.role === "assistant") {
      const text = message.text.replace(/\s+/g, " ").trim();
      if (!text) continue;
      const clipped = text.length > ASSISTANT_CLIP ? `${text.slice(0, ASSISTANT_CLIP)}…` : text;
      lines.push(`Assistant: ${clipped}`);
      budget -= clipped.length;
    }
    // system/tool output never enters the window.
  }
  return { window: lines.join("\n"), ownerTexts };
}

/**
 * Parse + quote-verify extraction ops against the window's owner messages.
 * The raw 0..1 score is kept; the caller applies the 0.8 floor.
 */
export function parseExtractionOps(
  rawReply: string,
  ownerTexts: ReadonlyArray<string>,
): Array<MemoryExtractionOp> {
  const items = parseFirstJsonArray(rawReply);
  if (!items) return [];
  const ops: Array<MemoryExtractionOp> = [];
  for (const entry of items) {
    if (ops.length >= MAX_OPS_PER_WINDOW) break;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const op = record.op === "update" ? "update" : "add";
    const scope = typeof record.scope === "string" ? record.scope : "project";
    const kind = typeof record.kind === "string" ? record.kind : "fact";
    const text = typeof record.text === "string" ? record.text.trim().slice(0, 600) : "";
    const quote = typeof record.quote === "string" ? record.quote : "";
    const subject = typeof record.subject === "string" ? record.subject.trim().slice(0, 120) : "";
    if (!text || !VALID_SCOPES.has(scope as DropwaveMemoryScope)) continue;
    if (!VALID_KINDS.has(kind as DropwaveMemoryKind)) continue;
    // Every op must carry the owner's exact words from SOME owner line in the window.
    if (!quote || !ownerTexts.some((ownerText) => quoteInMessage(quote, ownerText))) {
      continue;
    }
    const score =
      typeof record.confidence === "number" && Number.isFinite(record.confidence)
        ? Math.min(1, Math.max(0, record.confidence))
        : 0;
    ops.push({
      op,
      ...(op === "update" && typeof record.id === "string" ? { id: record.id } : {}),
      scope: scope as DropwaveMemoryScope,
      kind: kind as DropwaveMemoryKind,
      subject,
      text,
      quote: quote.slice(0, 500),
      score,
      confidence: confidenceFromScore(score),
    });
  }
  return ops;
}

export function formatExistingMemories(items: ReadonlyArray<DropwaveMemoryItem>): string {
  if (items.length === 0) return "(none)";
  return items
    .slice(0, 40)
    .map(
      (item) =>
        `${item.id} | ${item.scope}/${item.kind}${item.subject ? `/${item.subject}` : ""} | ${item.text}`,
    )
    .join("\n");
}

export function buildExtractionPrompt(input: {
  readonly botName: string;
  readonly botRole: string;
  readonly projectName: string;
  readonly existing: ReadonlyArray<DropwaveMemoryItem>;
  readonly window: string;
}): string {
  return DROPWAVE_MEMORY_EXTRACTION_PROMPT.replace("{{BOT_NAME}}", input.botName)
    .replace("{{BOT_ROLE}}", input.botRole)
    .replace("{{PROJECT_NAME}}", input.projectName)
    .replace("{{EXISTING}}", formatExistingMemories(input.existing))
    .replace("{{WINDOW}}", input.window);
}

interface ExtractorWatermark {
  readonly lastMessageId?: string;
  readonly contentHash?: string;
}

function readWatermark(raw: unknown): ExtractorWatermark {
  if (raw === null || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;
  return {
    ...(typeof record.lastMessageId === "string" ? { lastMessageId: record.lastMessageId } : {}),
    ...(typeof record.contentHash === "string" ? { contentHash: record.contentHash } : {}),
  };
}

const MODEL_TIMEOUT = "60 seconds";

async function contentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * One extraction pass over the messages newer than the watermark. Idempotent:
 * same window content -> same hash -> no model call, no writes.
 */
export const extractMemoriesForThread = Effect.fnUntraced(function* (input: {
  readonly store: DropwaveStoreShape;
  readonly projections: ProjectionStore.ProjectionStoreV2Shape;
  readonly textGeneration: TextGeneration.TextGeneration["Service"];
  readonly serverSettings: ServerSettings.ServerSettingsService["Service"];
  readonly embeddings?: MemoryEmbeddings.MemoryEmbeddingsShape | undefined;
  readonly projectId: ProjectId;
  readonly botThreadId: ThreadId;
  readonly personaId?: string | undefined;
  readonly botName: string;
  readonly botRole: string;
  readonly projectName: string;
  readonly workspaceRoot: string;
}): Effect.fn.Return<{ readonly applied: number }, DropwaveOperationErrorType, never> {
  const watermarkKey = `extractor:${input.botThreadId}`;
  const watermark = readWatermark(yield* input.store.getMemoryMeta(watermarkKey));

  const records = yield* input.projections
    .getThreadRecords(input.botThreadId, ["messages"], {
      messageRoles: ["user", "assistant"],
    })
    .pipe(Effect.mapError(dependencyError("read thread messages")));
  const all = [...records.messages].sort(
    (a, b) => a.createdAt.epochMilliseconds - b.createdAt.epochMilliseconds,
  );
  const watermarkIndex =
    watermark.lastMessageId === undefined
      ? -1
      : all.findIndex((message) => message.id === watermark.lastMessageId);
  // Unknown watermark (compacted history): take the recent tail only.
  const windowMessages =
    watermarkIndex >= 0 ? all.slice(watermarkIndex + 1) : all.slice(-WINDOW_MESSAGE_LIMIT);
  const { window, ownerTexts } = formatExtractionWindow(windowMessages);
  const lastMessageId = all.at(-1)?.id ?? watermark.lastMessageId;
  if (ownerTexts.length === 0 || window.trim().length === 0) {
    if (lastMessageId !== undefined) {
      yield* input.store.setMemoryMeta(watermarkKey, {
        lastMessageId,
        ...(watermark.contentHash !== undefined ? { contentHash: watermark.contentHash } : {}),
      });
    }
    return { applied: 0 };
  }
  const hash = yield* Effect.promise(() => contentHash(window));
  if (hash === watermark.contentHash) return { applied: 0 };

  const allSettings = yield* input.serverSettings.getSettings.pipe(
    Effect.mapError(dependencyError("read server settings")),
  );
  const { settings } = resolveProjectSettings(allSettings, input.projectId);
  const modelSelection = settings.textGenerationModelSelection ?? settings.defaultModelSelection;
  if (modelSelection === undefined) return { applied: 0 };

  const existing = yield* input.store.listMemories({
    projectId: input.projectId,
    botThreadId: input.botThreadId,
    ...(input.personaId !== undefined ? { personaId: input.personaId } : {}),
    limit: 60,
  });
  const prompt = buildExtractionPrompt({
    botName: input.botName,
    botRole: input.botRole,
    projectName: input.projectName,
    existing,
    window,
  });
  const reply = yield* input.textGeneration
    .generateTranscriptionPostProcessing({
      cwd: input.workspaceRoot,
      prompt,
      modelSelection,
    })
    .pipe(
      Effect.mapError(dependencyError("run the memory model")),
      Effect.timeoutOption(MODEL_TIMEOUT),
      Effect.orElseSucceed(() => Option.none()),
    );
  if (Option.isNone(reply)) {
    yield* Effect.logWarning("dropwave memory extraction timed out", {
      botThreadId: input.botThreadId,
    });
    return { applied: 0 };
  }
  const ops = parseExtractionOps(reply.value.transcription, ownerTexts).filter(
    (op) => op.score >= MIN_OP_CONFIDENCE,
  );

  let applied = 0;
  const sourceMessageId = windowMessages.findLast(isOwnerMessage)?.id ?? null;
  for (const op of ops) {
    // bot scope needs a persona; without one it degrades to project scope.
    const scope: DropwaveMemoryScope =
      op.scope === "bot" && input.personaId === undefined ? "project" : op.scope;
    const personaId = scope === "bot" ? (input.personaId ?? null) : null;
    if (op.op === "update" && op.id !== undefined) {
      const current = yield* input.store.getMemory(op.id);
      if (current === undefined) continue;
      // Automated writers never overwrite owner-authority records.
      if (current.authority === "owner") continue;
      yield* input.store
        .updateMemory({
          id: op.id,
          revision: current.revision,
          ...(op.text !== current.text ? { text: op.text } : {}),
          ...(op.subject !== current.subject ? { subject: op.subject } : {}),
          kind: op.kind,
          by: "agent",
        })
        .pipe(Effect.ignore);
      applied += 1;
      continue;
    }
    const item = yield* saveMemoryMerged({
      store: input.store,
      embeddings: input.embeddings,
      textGeneration: input.textGeneration,
      serverSettings: input.serverSettings,
      workspaceRoot: input.workspaceRoot,
      projectId: input.projectId,
      botThreadId: input.botThreadId,
      scope,
      personaId,
      kind: op.kind,
      subject: op.subject,
      text: op.text,
      quote: op.quote,
      sourceMessageId,
      threadId: input.botThreadId,
      confidence: op.confidence,
    }).pipe(Effect.orElseSucceed(() => undefined));
    if (item === undefined) continue;
    applied += 1;
  }
  yield* input.store.setMemoryMeta(watermarkKey, {
    ...(lastMessageId !== undefined ? { lastMessageId } : {}),
    contentHash: hash,
  });
  return { applied };
});

const OWNER_MESSAGES_PER_EXTRACTION = 6;
export const EXTRACTION_IDLE_MS = 2 * 60 * 1000;

interface TriggerState {
  ownerCount: number;
  lastOwnerAt: number;
  scheduled: boolean;
}

function readTriggerState(raw: unknown): TriggerState {
  const record = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    ownerCount: typeof record.ownerCount === "number" ? record.ownerCount : 0,
    lastOwnerAt: typeof record.lastOwnerAt === "number" ? record.lastOwnerAt : 0,
    scheduled: record.scheduled === true,
  };
}

/**
 * Records an owner message and decides whether extraction should run now.
 * Returns "run" when the count threshold hit; "schedule" asks the caller to
 * arm the idle timer; "skip" means an idle check is already pending.
 */
export const noteOwnerMessage = Effect.fnUntraced(function* (input: {
  readonly store: DropwaveStoreShape;
  readonly botThreadId: ThreadId;
  readonly now: number;
}): Effect.fn.Return<"run" | "schedule" | "skip", DropwaveOperationErrorType, never> {
  const key = `extractor-trigger:${input.botThreadId}`;
  const state = readTriggerState(yield* input.store.getMemoryMeta(key));
  const next: TriggerState = {
    ownerCount: state.ownerCount + 1,
    lastOwnerAt: input.now,
    scheduled: state.scheduled,
  };
  if (next.ownerCount >= OWNER_MESSAGES_PER_EXTRACTION) {
    yield* input.store.setMemoryMeta(key, { ...next, ownerCount: 0, scheduled: false });
    return "run";
  }
  yield* input.store.setMemoryMeta(key, next);
  return next.scheduled ? "skip" : "schedule";
});

/** Marks the idle timer armed; the delayed fiber calls this before extract. */
export const markExtractionScheduled = Effect.fnUntraced(function* (input: {
  readonly store: DropwaveStoreShape;
  readonly botThreadId: ThreadId;
}): Effect.fn.Return<void, DropwaveOperationErrorType, never> {
  const key = `extractor-trigger:${input.botThreadId}`;
  const state = readTriggerState(yield* input.store.getMemoryMeta(key));
  yield* input.store.setMemoryMeta(key, { ...state, scheduled: true });
});

export const clearExtractionSchedule = Effect.fnUntraced(function* (input: {
  readonly store: DropwaveStoreShape;
  readonly botThreadId: ThreadId;
}): Effect.fn.Return<void, DropwaveOperationErrorType, never> {
  const key = `extractor-trigger:${input.botThreadId}`;
  const state = readTriggerState(yield* input.store.getMemoryMeta(key));
  yield* input.store.setMemoryMeta(key, { ...state, scheduled: false });
});

/** Idle check: true when no owner message arrived within the idle window. */
export const extractionIdleDue = Effect.fnUntraced(function* (input: {
  readonly store: DropwaveStoreShape;
  readonly botThreadId: ThreadId;
  readonly now: number;
}): Effect.fn.Return<boolean, DropwaveOperationErrorType, never> {
  const key = `extractor-trigger:${input.botThreadId}`;
  const state = readTriggerState(yield* input.store.getMemoryMeta(key));
  return input.now - state.lastOwnerAt >= EXTRACTION_IDLE_MS;
});
