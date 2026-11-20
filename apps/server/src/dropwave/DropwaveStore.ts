// @effect-diagnostics nodeBuiltinImport:off
// @effect-diagnostics globalJsonInEffect:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import {
  type DropwaveAsk,
  type DropwaveAskActor,
  type DropwaveAskKind,
  type DropwaveAskStatus,
  type DropwaveAskStep,
  type DropwaveMemoryConfidence,
  type DropwaveMemoryItem,
  type DropwaveMemoryKind,
  type DropwaveMemoryScope,
  DropwaveOperationError,
  type DropwavePersona,
  type DropwavePersonaRole,
  type DropwaveSummaryNode,
  type IsoDateTime,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { PERSONALITY_SOURCES } from "./personality/sources.ts";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import {
  clipQuote,
  clipSummary,
  compactTurnSummary,
  extractRuleAsks,
  mergeSummaryPair,
  oneLine,
  type ExtractedAsk,
} from "./askExtraction.ts";

const MAX_HISTORY_STEPS = 20;
const MAX_JOBS_PER_ASK = 10;
const isDropwaveError = Schema.is(DropwaveOperationError);

function nowIso(): IsoDateTime {
  return DateTime.formatIso(DateTime.nowUnsafe()) as IsoDateTime;
}

function asIsoDateTime(value: string): IsoDateTime {
  return value as IsoDateTime;
}

function makeId(prefix: string): string {
  return `${prefix}_${NodeCrypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function isOpenAskStatus(status: DropwaveAskStatus): boolean {
  return status !== "done" && status !== "dropped";
}

function initializeDropwaveSchema(db: NodeSqlite.DatabaseSync): void {
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS dropwave_ask_counters (
      project_id TEXT PRIMARY KEY,
      next_n INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dropwave_asks (
      id TEXT PRIMARY KEY,
      n INTEGER NOT NULL,
      project_id TEXT NOT NULL,
      bot_thread_id TEXT NOT NULL,
      source_message_id TEXT,
      quote TEXT NOT NULL,
      summary TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      note TEXT,
      proof TEXT,
      heard_by TEXT NOT NULL,
      jobs_json TEXT NOT NULL DEFAULT '[]',
      chase_checks INTEGER NOT NULL DEFAULT 0,
      raised_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      history_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS idx_dropwave_asks_project_status
      ON dropwave_asks (project_id, status, n);
    CREATE INDEX IF NOT EXISTS idx_dropwave_asks_bot_status
      ON dropwave_asks (bot_thread_id, status, n);
    CREATE INDEX IF NOT EXISTS idx_dropwave_asks_source_message
      ON dropwave_asks (source_message_id);

    CREATE TABLE IF NOT EXISTS dropwave_memories (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      bot_thread_id TEXT,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      quote TEXT,
      source_message_id TEXT,
      confidence TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dropwave_memories_project
      ON dropwave_memories (project_id, active, updated_at DESC);

    CREATE TABLE IF NOT EXISTS dropwave_summary_nodes (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      level INTEGER NOT NULL,
      start_ordinal INTEGER NOT NULL,
      end_ordinal INTEGER NOT NULL,
      summary TEXT NOT NULL,
      child_ids_json TEXT NOT NULL DEFAULT '[]',
      message_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dropwave_summary_thread_level
      ON dropwave_summary_nodes (thread_id, level, start_ordinal);

    CREATE TABLE IF NOT EXISTS dropwave_supervisor_kv (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dropwave_personas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      role_label TEXT NOT NULL,
      soul TEXT NOT NULL DEFAULT '',
      identity TEXT NOT NULL DEFAULT '',
      avatar_seed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  const memoryColumns = new Set(
    (db.prepare("PRAGMA table_info(dropwave_memories)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!memoryColumns.has("scope")) {
    db.exec("ALTER TABLE dropwave_memories ADD COLUMN scope TEXT NOT NULL DEFAULT 'project'");
  }
  if (!memoryColumns.has("persona_id")) {
    db.exec("ALTER TABLE dropwave_memories ADD COLUMN persona_id TEXT");
  }
  db.exec(
    "CREATE INDEX IF NOT EXISTS idx_dropwave_memories_scope ON dropwave_memories (scope, persona_id, active)",
  );
}

interface AskRow {
  readonly id: string;
  readonly n: number;
  readonly project_id: string;
  readonly bot_thread_id: string;
  readonly source_message_id: string | null;
  readonly quote: string;
  readonly summary: string;
  readonly kind: string;
  readonly status: string;
  readonly note: string | null;
  readonly proof: string | null;
  readonly heard_by: string;
  readonly jobs_json: string;
  readonly chase_checks: number;
  readonly raised_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly history_json: string;
}

interface MemoryRow {
  readonly id: string;
  readonly project_id: string;
  readonly bot_thread_id: string | null;
  readonly scope: string;
  readonly persona_id: string | null;
  readonly kind: string;
  readonly text: string;
  readonly quote: string | null;
  readonly source_message_id: string | null;
  readonly confidence: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface SummaryNodeRow {
  readonly id: string;
  readonly thread_id: string;
  readonly level: number;
  readonly start_ordinal: number;
  readonly end_ordinal: number;
  readonly summary: string;
  readonly child_ids_json: string;
  readonly message_ids_json: string;
  readonly created_at: string;
}

function parseJsonArray<T>(raw: string): Array<T> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Array<T>) : [];
  } catch {
    return [];
  }
}

function rowToAsk(row: AskRow): DropwaveAsk {
  return {
    id: row.id,
    n: row.n,
    projectId: ProjectId.make(row.project_id),
    botThreadId: ThreadId.make(row.bot_thread_id),
    sourceMessageId: row.source_message_id,
    quote: row.quote,
    summary: row.summary,
    kind: row.kind as DropwaveAskKind,
    status: row.status as DropwaveAskStatus,
    ...(row.note ? { note: row.note } : {}),
    ...(row.proof ? { proof: row.proof } : {}),
    heardBy: row.heard_by as "rules" | "model" | "owner",
    jobs: parseJsonArray<string>(row.jobs_json),
    chaseChecks: row.chase_checks,
    ...(row.raised_at ? { raisedAt: asIsoDateTime(row.raised_at) } : {}),
    createdAt: asIsoDateTime(row.created_at),
    updatedAt: asIsoDateTime(row.updated_at),
    history: parseJsonArray<DropwaveAskStep>(row.history_json),
  };
}

interface PersonaRow {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly role_label: string;
  readonly soul: string;
  readonly identity: string;
  readonly avatar_seed: number;
  readonly created_at: string;
  readonly updated_at: string;
}

function rowToMemory(row: MemoryRow): DropwaveMemoryItem {
  return {
    id: row.id,
    projectId: ProjectId.make(row.project_id),
    botThreadId: row.bot_thread_id ? ThreadId.make(row.bot_thread_id) : null,
    scope: (row.scope === "global" ? "global" : "project") as DropwaveMemoryScope,
    personaId: row.persona_id ?? null,
    kind: row.kind as DropwaveMemoryKind,
    text: row.text,
    ...(row.quote ? { quote: row.quote } : {}),
    ...(row.source_message_id ? { sourceMessageId: row.source_message_id } : {}),
    confidence: row.confidence as DropwaveMemoryConfidence,
    createdAt: asIsoDateTime(row.created_at),
    updatedAt: asIsoDateTime(row.updated_at),
  };
}

function rowToPersona(row: PersonaRow): DropwavePersona {
  return {
    id: row.id,
    name: row.name,
    role: row.role as DropwavePersonaRole,
    roleLabel: row.role_label,
    soul: row.soul,
    identity: row.identity,
    avatarSeed: row.avatar_seed,
    createdAt: asIsoDateTime(row.created_at),
    updatedAt: asIsoDateTime(row.updated_at),
  };
}

function rowToSummaryNode(row: SummaryNodeRow): DropwaveSummaryNode {
  return {
    id: row.id,
    threadId: ThreadId.make(row.thread_id),
    level: row.level,
    startOrdinal: row.start_ordinal,
    endOrdinal: row.end_ordinal,
    summary: row.summary,
    childIds: parseJsonArray<string>(row.child_ids_json),
    messageIds: parseJsonArray<string>(row.message_ids_json),
    createdAt: asIsoDateTime(row.created_at),
  };
}

export interface DropwaveStoreShape {
  readonly captureMessageAsks: (input: {
    readonly projectId: ProjectId;
    readonly botThreadId: ThreadId;
    readonly messageId: string;
    readonly text: string;
    readonly extracted?: ReadonlyArray<ExtractedAsk> | undefined;
    readonly heardBy?: "rules" | "model" | undefined;
  }) => Effect.Effect<ReadonlyArray<DropwaveAsk>, DropwaveOperationError>;

  readonly listAsks: (input: {
    readonly projectId?: ProjectId | undefined;
    readonly botThreadId?: ThreadId | undefined;
    readonly includeClosed?: boolean | undefined;
  }) => Effect.Effect<ReadonlyArray<DropwaveAsk>, DropwaveOperationError>;

  readonly addAsk: (input: {
    readonly projectId: ProjectId;
    readonly botThreadId: ThreadId;
    readonly text: string;
    readonly kind?: DropwaveAskKind | undefined;
  }) => Effect.Effect<DropwaveAsk, DropwaveOperationError>;

  readonly updateAsk: (input: {
    readonly askId: string;
    readonly actor: DropwaveAskActor;
    readonly status?: DropwaveAskStatus | undefined;
    readonly note?: string | null | undefined;
    readonly proof?: string | null | undefined;
    readonly summary?: string | undefined;
  }) => Effect.Effect<DropwaveAsk, DropwaveOperationError>;

  readonly linkJobToAsks: (input: {
    readonly askIds: ReadonlyArray<string>;
    readonly jobId: string;
    readonly title?: string | undefined;
  }) => Effect.Effect<ReadonlyArray<DropwaveAsk>, DropwaveOperationError>;

  readonly applyJobOutcome: (input: {
    readonly jobId: string;
    readonly status: "running" | "completed" | "failed" | "cancelled";
    readonly title?: string | undefined;
    readonly detail?: string | undefined;
  }) => Effect.Effect<ReadonlyArray<DropwaveAsk>, DropwaveOperationError>;

  readonly listUntouchedAsksForMessage: (
    messageId: string,
  ) => Effect.Effect<ReadonlyArray<DropwaveAsk>, DropwaveOperationError>;

  readonly listMemories: (input: {
    readonly projectId: ProjectId;
    readonly botThreadId?: ThreadId | undefined;
    readonly personaId?: string | undefined;
    readonly query?: string | undefined;
  }) => Effect.Effect<ReadonlyArray<DropwaveMemoryItem>, DropwaveOperationError>;

  readonly saveMemory: (input: {
    readonly projectId: ProjectId;
    readonly botThreadId?: ThreadId | null | undefined;
    readonly scope?: DropwaveMemoryScope | undefined;
    readonly personaId?: string | null | undefined;
    readonly kind: DropwaveMemoryKind;
    readonly text: string;
    readonly quote?: string | undefined;
    readonly sourceMessageId?: string | null | undefined;
    readonly confidence?: DropwaveMemoryConfidence | undefined;
  }) => Effect.Effect<DropwaveMemoryItem, DropwaveOperationError>;

  readonly removeMemory: (id: string) => Effect.Effect<boolean, DropwaveOperationError>;

  readonly setMemoryScope: (
    id: string,
    scope: DropwaveMemoryScope,
  ) => Effect.Effect<DropwaveMemoryItem, DropwaveOperationError>;

  readonly listPersonas: () => Effect.Effect<
    ReadonlyArray<DropwavePersona>,
    DropwaveOperationError
  >;

  readonly getPersona: (
    id: string,
  ) => Effect.Effect<DropwavePersona | undefined, DropwaveOperationError>;

  readonly upsertPersona: (input: {
    readonly id?: string | undefined;
    readonly name?: string | undefined;
    readonly role?: DropwavePersonaRole | undefined;
    readonly roleLabel?: string | undefined;
    readonly soul?: string | undefined;
    readonly identity?: string | undefined;
  }) => Effect.Effect<DropwavePersona, DropwaveOperationError>;

  readonly appendTurnSummary: (input: {
    readonly threadId: ThreadId;
    readonly messageId: string;
    readonly role: "owner" | "bot";
    readonly text: string;
  }) => Effect.Effect<DropwaveSummaryNode, DropwaveOperationError>;

  readonly getThreadTreeOverview: (
    threadId: ThreadId,
    maxLines?: number,
  ) => Effect.Effect<ReadonlyArray<DropwaveSummaryNode>, DropwaveOperationError>;

  readonly zoomSummaryNode: (
    nodeId: string,
  ) => Effect.Effect<
    { readonly node: DropwaveSummaryNode; readonly children: ReadonlyArray<DropwaveSummaryNode> },
    DropwaveOperationError
  >;

  readonly searchSummaryTree: (
    threadId: ThreadId,
    query: string,
    limit?: number,
  ) => Effect.Effect<ReadonlyArray<DropwaveSummaryNode>, DropwaveOperationError>;

  readonly getSupervisorCounter: (key: string) => Effect.Effect<number, DropwaveOperationError>;
  readonly incrementSupervisorCounter: (
    key: string,
  ) => Effect.Effect<number, DropwaveOperationError>;
  readonly resetSupervisorCounter: (key: string) => Effect.Effect<void, DropwaveOperationError>;
}

export class DropwaveStore extends Context.Service<DropwaveStore, DropwaveStoreShape>()(
  "t3/dropwave/DropwaveStore",
) {}

function storageError(cause: unknown): DropwaveOperationError {
  return new DropwaveOperationError({
    code: "storage_error",
    message: cause instanceof Error ? cause.message : String(cause),
  });
}

function makeDropwaveStore(db: NodeSqlite.DatabaseSync): DropwaveStoreShape {
  const getOne = <T>(sql: string, ...params: Array<NodeSqlite.SQLInputValue>): T | undefined =>
    db.prepare(sql).get(...params) as unknown as T | undefined;

  const getAll = <T>(sql: string, ...params: Array<NodeSqlite.SQLInputValue>): Array<T> =>
    db.prepare(sql).all(...params) as unknown as Array<T>;

  const allocateAskNumber = (projectId: string): number => {
    const existing = getOne<{ next_n: number }>(
      "SELECT next_n FROM dropwave_ask_counters WHERE project_id = ?",
      projectId,
    );
    if (existing) {
      db.prepare("UPDATE dropwave_ask_counters SET next_n = ? WHERE project_id = ?").run(
        existing.next_n + 1,
        projectId,
      );
      return existing.next_n;
    }
    db.prepare("INSERT INTO dropwave_ask_counters (project_id, next_n) VALUES (?, ?)").run(
      projectId,
      2,
    );
    return 1;
  };

  const findAskRow = (askIdOrNumber: string): AskRow | undefined => {
    const byId = getOne<AskRow>("SELECT * FROM dropwave_asks WHERE id = ?", askIdOrNumber);
    if (byId) return byId;
    const match = /^#?(\d+)$/.exec(askIdOrNumber.trim());
    if (!match) return undefined;
    const n = Number(match[1]);
    return getOne<AskRow>(
      "SELECT * FROM dropwave_asks WHERE n = ? ORDER BY updated_at DESC LIMIT 1",
      n,
    );
  };

  const updateAskRow = (
    row: AskRow,
    patch: {
      readonly actor: DropwaveAskActor;
      readonly status?: DropwaveAskStatus | undefined;
      readonly note?: string | null | undefined;
      readonly proof?: string | null | undefined;
      readonly summary?: string | undefined;
      readonly jobs?: ReadonlyArray<string> | undefined;
    },
  ): DropwaveAsk | DropwaveOperationError => {
    const currentStatus = row.status as DropwaveAskStatus;
    const nextStatus = patch.status ?? currentStatus;

    if (nextStatus === "dropped" && patch.actor !== "owner") {
      return new DropwaveOperationError({
        code: "forbidden",
        message: "Only the owner can drop an ask.",
      });
    }
    if (currentStatus === "dropped" && patch.actor !== "owner") {
      return new DropwaveOperationError({
        code: "forbidden",
        message: "Only the owner can reopen a dropped ask.",
      });
    }
    const nextProof = patch.proof === undefined ? row.proof : patch.proof;
    const nextNote = patch.note === undefined ? row.note : patch.note;
    if (nextStatus === "done" && patch.actor === "bot" && !nextProof?.trim()) {
      return new DropwaveOperationError({
        code: "invalid_input",
        message: "Marking an ask done requires proof (PR, test result, file, or chat answer).",
      });
    }
    if (nextStatus === "waiting" && patch.actor === "bot" && !nextNote?.trim()) {
      return new DropwaveOperationError({
        code: "invalid_input",
        message: "Marking an ask waiting requires a note explaining what is needed.",
      });
    }

    const timestamp = nowIso();
    const history = parseJsonArray<DropwaveAskStep>(row.history_json);
    const stepNote = patch.note?.trim() || patch.proof?.trim() || undefined;
    if (patch.status !== undefined || stepNote !== undefined) {
      history.push({
        at: timestamp,
        status: nextStatus,
        by: patch.actor,
        ...(stepNote ? { note: stepNote.slice(0, 400) } : {}),
      });
    }
    const trimmedHistory = history.slice(-MAX_HISTORY_STEPS);
    const nextSummary = patch.summary !== undefined ? clipSummary(patch.summary) : row.summary;
    const nextJobs = patch.jobs ?? parseJsonArray<string>(row.jobs_json);

    db.prepare(
      `UPDATE dropwave_asks
       SET status = ?, note = ?, proof = ?, summary = ?, jobs_json = ?, updated_at = ?, history_json = ?,
           chase_checks = CASE WHEN status != ? THEN 0 ELSE chase_checks END,
           raised_at = CASE WHEN status != ? THEN NULL ELSE raised_at END
       WHERE id = ?`,
    ).run(
      nextStatus,
      nextNote?.trim() ? oneLine(nextNote).slice(0, 400) : null,
      nextProof?.trim() ? oneLine(nextProof).slice(0, 400) : null,
      nextSummary,
      JSON.stringify(nextJobs.slice(-MAX_JOBS_PER_ASK)),
      timestamp,
      JSON.stringify(trimmedHistory),
      nextStatus,
      nextStatus,
      row.id,
    );
    const updated = getOne<AskRow>("SELECT * FROM dropwave_asks WHERE id = ?", row.id)!;
    return rowToAsk(updated);
  };

  const compressLevelIfReady = (threadId: string, level: number): void => {
    const nodes = getAll<SummaryNodeRow>(
      `SELECT * FROM dropwave_summary_nodes
       WHERE thread_id = ? AND level = ?
       ORDER BY start_ordinal ASC`,
      threadId,
      level,
    );
    const parentRows = getAll<{ child_ids_json: string }>(
      `SELECT child_ids_json FROM dropwave_summary_nodes
       WHERE thread_id = ? AND level = ?`,
      threadId,
      level + 1,
    );
    const covered = new Set<string>();
    for (const parent of parentRows) {
      for (const childId of parseJsonArray<string>(parent.child_ids_json)) {
        covered.add(childId);
      }
    }
    const uncovered = nodes.filter((node) => !covered.has(node.id));
    const reserveTail = level === 0 ? 4 : 1;
    if (uncovered.length < 2 + reserveTail) return;
    const left = uncovered[0]!;
    const right = uncovered[1]!;
    const mergedId = makeId("sum");
    const createdAt = nowIso();
    const messageIds = [
      ...parseJsonArray<string>(left.message_ids_json),
      ...parseJsonArray<string>(right.message_ids_json),
    ];
    db.prepare(
      `INSERT INTO dropwave_summary_nodes
        (id, thread_id, level, start_ordinal, end_ordinal, summary, child_ids_json, message_ids_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      mergedId,
      threadId,
      level + 1,
      left.start_ordinal,
      right.end_ordinal,
      mergeSummaryPair(left.summary, right.summary),
      JSON.stringify([left.id, right.id]),
      JSON.stringify(messageIds),
      createdAt,
    );
    if (level < 6) {
      compressLevelIfReady(threadId, level + 1);
    }
  };

  return {
    captureMessageAsks: (input) =>
      Effect.try({
        try: () => {
          const items = input.extracted ?? extractRuleAsks(input.text);
          const heardBy = input.heardBy ?? "rules";
          if (items.length === 0) return [];
          const existing = getAll<AskRow>(
            "SELECT * FROM dropwave_asks WHERE source_message_id = ? ORDER BY n ASC",
            input.messageId,
          );
          if (existing.length > 0 && heardBy === "rules") {
            return existing.map(rowToAsk);
          }
          const touchedQuotes = new Set<string>();
          for (const row of existing) {
            const history = parseJsonArray<DropwaveAskStep>(row.history_json);
            const untouched =
              (row.status === "heard" || row.status === "maybe") &&
              history.length <= 1 &&
              !row.note &&
              parseJsonArray<string>(row.jobs_json).length === 0;
            if (untouched) {
              db.prepare("DELETE FROM dropwave_asks WHERE id = ?").run(row.id);
            } else {
              touchedQuotes.add(oneLine(row.quote).toLowerCase());
            }
          }
          const created: Array<DropwaveAsk> = [];
          const timestamp = nowIso();
          for (const item of items) {
            if (touchedQuotes.has(oneLine(item.quote).toLowerCase())) continue;
            const n = allocateAskNumber(input.projectId);
            const id = `ask-${n}-${NodeCrypto.randomUUID().slice(0, 8)}`;
            const status: DropwaveAskStatus = item.maybe ? "maybe" : "heard";
            const history: Array<DropwaveAskStep> = [{ at: timestamp, status, by: "system" }];
            db.prepare(
              `INSERT INTO dropwave_asks
                (id, n, project_id, bot_thread_id, source_message_id, quote, summary, kind, status, heard_by, jobs_json, chase_checks, created_at, updated_at, history_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 0, ?, ?, ?)`,
            ).run(
              id,
              n,
              input.projectId,
              input.botThreadId,
              input.messageId,
              clipQuote(item.quote),
              clipSummary(item.summary),
              item.kind,
              status,
              heardBy,
              timestamp,
              timestamp,
              JSON.stringify(history),
            );
            const row = getOne<AskRow>("SELECT * FROM dropwave_asks WHERE id = ?", id)!;
            created.push(rowToAsk(row));
          }
          return created;
        },
        catch: storageError,
      }),

    listAsks: (input) =>
      Effect.try({
        try: () => {
          const clauses: Array<string> = [];
          const params: Array<string> = [];
          if (input.projectId !== undefined) {
            clauses.push("project_id = ?");
            params.push(input.projectId);
          }
          if (input.botThreadId !== undefined) {
            clauses.push("bot_thread_id = ?");
            params.push(input.botThreadId);
          }
          if (!input.includeClosed) {
            clauses.push("status NOT IN ('done', 'dropped')");
          }
          const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
          const rows = getAll<AskRow>(
            `SELECT * FROM dropwave_asks ${where} ORDER BY n ASC LIMIT 200`,
            ...params,
          );
          return rows.map(rowToAsk);
        },
        catch: storageError,
      }),

    addAsk: (input) =>
      Effect.try({
        try: () => {
          const n = allocateAskNumber(input.projectId);
          const id = `ask-${n}-${NodeCrypto.randomUUID().slice(0, 8)}`;
          const timestamp = nowIso();
          const kind = input.kind ?? "do";
          const history: Array<DropwaveAskStep> = [{ at: timestamp, status: "heard", by: "owner" }];
          db.prepare(
            `INSERT INTO dropwave_asks
              (id, n, project_id, bot_thread_id, source_message_id, quote, summary, kind, status, heard_by, jobs_json, chase_checks, created_at, updated_at, history_json)
             VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'heard', 'owner', '[]', 0, ?, ?, ?)`,
          ).run(
            id,
            n,
            input.projectId,
            input.botThreadId,
            clipQuote(input.text),
            clipSummary(input.text),
            kind,
            timestamp,
            timestamp,
            JSON.stringify(history),
          );
          const row = getOne<AskRow>("SELECT * FROM dropwave_asks WHERE id = ?", id)!;
          return rowToAsk(row);
        },
        catch: storageError,
      }),

    updateAsk: (input) =>
      Effect.try({
        try: () => findAskRow(input.askId),
        catch: storageError,
      }).pipe(
        Effect.flatMap((row) => {
          if (!row) {
            return Effect.fail(
              new DropwaveOperationError({
                code: "not_found",
                message: `Ask "${input.askId}" was not found.`,
              }),
            );
          }
          const updated = updateAskRow(row, input);
          return isDropwaveError(updated) ? Effect.fail(updated) : Effect.succeed(updated);
        }),
      ),

    linkJobToAsks: (input) =>
      Effect.try({
        try: () => {
          const updated: Array<DropwaveAsk> = [];
          for (const askId of input.askIds) {
            const row = findAskRow(askId);
            if (!row || !isOpenAskStatus(row.status as DropwaveAskStatus)) continue;
            const existingJobs = parseJsonArray<string>(row.jobs_json);
            const nextJobs = existingJobs.includes(input.jobId)
              ? existingJobs
              : [...existingJobs, input.jobId];
            const nextStatus = row.status === "heard" ? ("started" as const) : undefined;
            const note =
              nextStatus === "started"
                ? input.title
                  ? `Handed to worker: ${input.title}`
                  : "Handed to worker"
                : undefined;
            const res = updateAskRow(row, {
              actor: "system",
              ...(nextStatus ? { status: nextStatus } : {}),
              ...(note ? { note } : {}),
              jobs: nextJobs,
            });
            if (!isDropwaveError(res)) updated.push(res);
          }
          return updated;
        },
        catch: storageError,
      }),

    applyJobOutcome: (input) =>
      Effect.try({
        try: () => {
          const rows = getAll<AskRow>(
            "SELECT * FROM dropwave_asks WHERE status NOT IN ('done', 'dropped')",
          );
          const affected: Array<DropwaveAsk> = [];
          for (const row of rows) {
            const jobs = parseJsonArray<string>(row.jobs_json);
            if (!jobs.includes(input.jobId)) continue;
            if (input.status === "running" && row.status === "heard") {
              const res = updateAskRow(row, {
                actor: "system",
                status: "started",
                note: input.title ? `Working: ${input.title}` : "Worker running",
              });
              if (!isDropwaveError(res)) affected.push(res);
            } else if (input.status === "failed" || input.status === "cancelled") {
              if (row.status === "started") {
                const reason =
                  input.detail?.trim() ||
                  (input.status === "cancelled" ? "worker was stopped" : "worker failed");
                const res = updateAskRow(row, {
                  actor: "system",
                  status: "heard",
                  note: `Worker ${input.status}${input.title ? ` (${input.title})` : ""}: ${reason}. Back on the list.`,
                });
                if (!isDropwaveError(res)) affected.push(res);
              }
            }
          }
          return affected;
        },
        catch: storageError,
      }),

    listUntouchedAsksForMessage: (messageId) =>
      Effect.try({
        try: () => {
          const rows = getAll<AskRow>(
            `SELECT * FROM dropwave_asks
             WHERE source_message_id = ? AND status = 'heard' AND kind != 'idea'
             ORDER BY n ASC`,
            messageId,
          );
          return rows.map(rowToAsk);
        },
        catch: storageError,
      }),

    listMemories: (input) =>
      Effect.try({
        try: () => {
          const scopeClauses = [
            "(scope = 'project' AND project_id = ?" +
              (input.botThreadId !== undefined
                ? " AND (bot_thread_id IS NULL OR bot_thread_id = ?)"
                : "") +
              ")",
            "(scope = 'global' AND persona_id IS NULL)",
          ];
          const params: Array<string> = [input.projectId];
          if (input.botThreadId !== undefined) params.push(input.botThreadId);
          if (input.personaId !== undefined) {
            scopeClauses.push("(scope = 'global' AND persona_id = ?)");
            params.push(input.personaId);
          }
          const clauses = [`(${scopeClauses.join(" OR ")})`, "active = 1"];
          if (input.query?.trim()) {
            const like = `%${input.query.trim().toLowerCase()}%`;
            clauses.push("(LOWER(text) LIKE ? OR LOWER(COALESCE(quote, '')) LIKE ?)");
            params.push(like, like);
          }
          const rows = getAll<MemoryRow>(
            `SELECT * FROM dropwave_memories
             WHERE ${clauses.join(" AND ")}
             ORDER BY CASE confidence WHEN 'confirmed' THEN 0 WHEN 'learned' THEN 1 ELSE 2 END, updated_at DESC
             LIMIT 100`,
            ...params,
          );
          return rows.map(rowToMemory);
        },
        catch: storageError,
      }),

    saveMemory: (input) =>
      Effect.try({
        try: () => {
          const text = oneLine(input.text).slice(0, 600);
          const timestamp = nowIso();
          const scope: DropwaveMemoryScope = input.scope ?? "project";
          const personaId = scope === "global" ? (input.personaId ?? null) : null;
          const duplicate = getOne<MemoryRow>(
            scope === "global"
              ? `SELECT * FROM dropwave_memories
                 WHERE scope = 'global' AND active = 1 AND LOWER(text) = LOWER(?)
                   AND persona_id IS ?
                 LIMIT 1`
              : `SELECT * FROM dropwave_memories
                 WHERE scope = 'project' AND project_id = ? AND active = 1 AND LOWER(text) = LOWER(?)
                 LIMIT 1`,
            ...(scope === "global" ? [text, personaId] : [input.projectId, text]),
          );
          if (duplicate) {
            const confidence = input.confidence ?? duplicate.confidence;
            db.prepare(
              `UPDATE dropwave_memories SET confidence = ?, updated_at = ?, quote = COALESCE(?, quote) WHERE id = ?`,
            ).run(confidence, timestamp, input.quote ? clipQuote(input.quote) : null, duplicate.id);
            const row = getOne<MemoryRow>(
              "SELECT * FROM dropwave_memories WHERE id = ?",
              duplicate.id,
            )!;
            return rowToMemory(row);
          }
          const id = makeId("mem");
          db.prepare(
            `INSERT INTO dropwave_memories
              (id, project_id, bot_thread_id, scope, persona_id, kind, text, quote, source_message_id, confidence, active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          ).run(
            id,
            input.projectId,
            scope === "global" ? null : (input.botThreadId ?? null),
            scope,
            personaId,
            input.kind,
            text,
            input.quote ? clipQuote(input.quote) : null,
            input.sourceMessageId ?? null,
            input.confidence ?? "learned",
            timestamp,
            timestamp,
          );
          const row = getOne<MemoryRow>("SELECT * FROM dropwave_memories WHERE id = ?", id)!;
          return rowToMemory(row);
        },
        catch: storageError,
      }),

    removeMemory: (id) =>
      Effect.try({
        try: () => {
          const res = db
            .prepare("UPDATE dropwave_memories SET active = 0, updated_at = ? WHERE id = ?")
            .run(nowIso(), id);
          return Number(res.changes) > 0;
        },
        catch: storageError,
      }),

    setMemoryScope: (id, scope) =>
      Effect.try({
        try: () => {
          const existing = getOne<MemoryRow>(
            "SELECT * FROM dropwave_memories WHERE id = ? AND active = 1",
            id,
          );
          if (!existing) {
            throw new DropwaveOperationError({
              code: "not_found",
              message: `Memory "${id}" not found.`,
            });
          }
          // Promoting to global detaches it from a single bot; demoting reattaches to the origin.
          const botThreadId = scope === "global" ? null : existing.bot_thread_id;
          const personaId = scope === "global" ? existing.persona_id : null;
          db.prepare(
            "UPDATE dropwave_memories SET scope = ?, bot_thread_id = ?, persona_id = ?, updated_at = ? WHERE id = ?",
          ).run(scope, botThreadId, personaId, nowIso(), id);
          const row = getOne<MemoryRow>("SELECT * FROM dropwave_memories WHERE id = ?", id)!;
          return rowToMemory(row);
        },
        catch: (cause) =>
          isDropwaveError(cause)
            ? cause
            : new DropwaveOperationError({
                code: "storage_error",
                message: cause instanceof Error ? cause.message : String(cause),
              }),
      }),

    listPersonas: () =>
      Effect.try({
        try: () =>
          getAll<PersonaRow>(
            "SELECT * FROM dropwave_personas ORDER BY role ASC, updated_at DESC",
          ).map(rowToPersona),
        catch: storageError,
      }),

    getPersona: (id) =>
      Effect.try({
        try: () => {
          const row = getOne<PersonaRow>("SELECT * FROM dropwave_personas WHERE id = ?", id);
          return row ? rowToPersona(row) : undefined;
        },
        catch: storageError,
      }),

    upsertPersona: (input) =>
      Effect.try({
        try: () => {
          const timestamp = nowIso();
          if (input.id !== undefined) {
            const existing = getOne<PersonaRow>(
              "SELECT * FROM dropwave_personas WHERE id = ?",
              input.id,
            );
            if (!existing) {
              throw new DropwaveOperationError({
                code: "not_found",
                message: `Persona "${input.id}" not found.`,
              });
            }
            db.prepare(
              `UPDATE dropwave_personas
               SET name = ?, role = ?, role_label = ?, soul = ?, identity = ?, updated_at = ?
               WHERE id = ?`,
            ).run(
              input.name?.trim() || existing.name,
              input.role ?? existing.role,
              input.roleLabel ?? existing.role_label,
              input.soul ?? existing.soul,
              input.identity ?? existing.identity,
              timestamp,
              input.id,
            );
            const row = getOne<PersonaRow>(
              "SELECT * FROM dropwave_personas WHERE id = ?",
              input.id,
            )!;
            return rowToPersona(row);
          }
          if (!input.name?.trim()) {
            throw new DropwaveOperationError({
              code: "invalid_input",
              message: "Creating a persona requires a name.",
            });
          }
          const id = makeId("persona");
          db.prepare(
            `INSERT INTO dropwave_personas
              (id, name, role, role_label, soul, identity, avatar_seed, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            id,
            input.name.trim().slice(0, 80),
            input.role ?? "specialist",
            (input.roleLabel ?? "").slice(0, 160),
            (input.soul ?? "").slice(0, 4000),
            // New personas start with the IDENTITY.md template so the bot can fill it in.
            (input.identity ?? PERSONALITY_SOURCES.identityTemplate).slice(0, 40000),
            NodeCrypto.randomInt(0, 2 ** 31 - 1),
            timestamp,
            timestamp,
          );
          const row = getOne<PersonaRow>("SELECT * FROM dropwave_personas WHERE id = ?", id)!;
          return rowToPersona(row);
        },
        catch: (cause) =>
          isDropwaveError(cause)
            ? cause
            : new DropwaveOperationError({
                code: "storage_error",
                message: cause instanceof Error ? cause.message : String(cause),
              }),
      }),

    appendTurnSummary: (input) =>
      Effect.try({
        try: () => {
          const existing = getOne<SummaryNodeRow>(
            `SELECT * FROM dropwave_summary_nodes
             WHERE thread_id = ? AND level = 0 AND message_ids_json = ?
             LIMIT 1`,
            input.threadId,
            JSON.stringify([input.messageId]),
          );
          if (existing) return rowToSummaryNode(existing);

          const maxRow = getOne<{ max_ord: number }>(
            `SELECT COALESCE(MAX(end_ordinal), -1) AS max_ord
             FROM dropwave_summary_nodes WHERE thread_id = ? AND level = 0`,
            input.threadId,
          );
          const ordinal = (maxRow?.max_ord ?? -1) + 1;
          const id = makeId("sum");
          const createdAt = nowIso();
          db.prepare(
            `INSERT INTO dropwave_summary_nodes
              (id, thread_id, level, start_ordinal, end_ordinal, summary, child_ids_json, message_ids_json, created_at)
             VALUES (?, ?, 0, ?, ?, ?, '[]', ?, ?)`,
          ).run(
            id,
            input.threadId,
            ordinal,
            ordinal,
            compactTurnSummary(input.role, input.text),
            JSON.stringify([input.messageId]),
            createdAt,
          );
          compressLevelIfReady(input.threadId, 0);
          const row = getOne<SummaryNodeRow>(
            "SELECT * FROM dropwave_summary_nodes WHERE id = ?",
            id,
          )!;
          return rowToSummaryNode(row);
        },
        catch: storageError,
      }),

    getThreadTreeOverview: (threadId, maxLines = 12) =>
      Effect.try({
        try: () => {
          const all = getAll<SummaryNodeRow>(
            `SELECT * FROM dropwave_summary_nodes
             WHERE thread_id = ?
             ORDER BY level DESC, start_ordinal ASC`,
            threadId,
          );
          if (all.length === 0) return [];
          const coveredByParent = new Set<string>();
          for (const node of all) {
            for (const childId of parseJsonArray<string>(node.child_ids_json)) {
              coveredByParent.add(childId);
            }
          }
          const frontier = all
            .filter((node) => !coveredByParent.has(node.id))
            .toSorted((a, b) => a.start_ordinal - b.start_ordinal);
          return frontier.slice(-maxLines).map(rowToSummaryNode);
        },
        catch: storageError,
      }),

    zoomSummaryNode: (nodeId) =>
      Effect.try({
        try: () => {
          const node = getOne<SummaryNodeRow>(
            "SELECT * FROM dropwave_summary_nodes WHERE id = ?",
            nodeId,
          );
          if (!node) return undefined;
          const childIds = parseJsonArray<string>(node.child_ids_json);
          const children: Array<DropwaveSummaryNode> = [];
          for (const childId of childIds) {
            const child = getOne<SummaryNodeRow>(
              "SELECT * FROM dropwave_summary_nodes WHERE id = ?",
              childId,
            );
            if (child) children.push(rowToSummaryNode(child));
          }
          return { node: rowToSummaryNode(node), children };
        },
        catch: storageError,
      }).pipe(
        Effect.filterOrFail(
          (result): result is NonNullable<typeof result> => result !== undefined,
          () =>
            new DropwaveOperationError({
              code: "not_found",
              message: `Summary node "${nodeId}" not found.`,
            }),
        ),
      ),

    searchSummaryTree: (threadId, query, limit = 12) =>
      Effect.try({
        try: () => {
          const like = `%${query.trim().toLowerCase()}%`;
          const rows = getAll<SummaryNodeRow>(
            `SELECT * FROM dropwave_summary_nodes
             WHERE thread_id = ? AND LOWER(summary) LIKE ?
             ORDER BY level ASC, start_ordinal DESC
             LIMIT ?`,
            threadId,
            like,
            limit,
          );
          return rows.map(rowToSummaryNode);
        },
        catch: storageError,
      }),

    getSupervisorCounter: (key) =>
      Effect.try({
        try: () => {
          const row = getOne<{ value_json: string }>(
            "SELECT value_json FROM dropwave_supervisor_kv WHERE key = ?",
            key,
          );
          if (!row) return 0;
          const parsed = Number(JSON.parse(row.value_json));
          return Number.isFinite(parsed) ? parsed : 0;
        },
        catch: storageError,
      }),

    incrementSupervisorCounter: (key) =>
      Effect.try({
        try: () => {
          const row = getOne<{ value_json: string }>(
            "SELECT value_json FROM dropwave_supervisor_kv WHERE key = ?",
            key,
          );
          const current = row ? Number(JSON.parse(row.value_json)) || 0 : 0;
          const next = current + 1;
          db.prepare(
            `INSERT INTO dropwave_supervisor_kv (key, value_json, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
          ).run(key, JSON.stringify(next), nowIso());
          return next;
        },
        catch: storageError,
      }),

    resetSupervisorCounter: (key) =>
      Effect.try({
        try: () => {
          db.prepare("DELETE FROM dropwave_supervisor_kv WHERE key = ?").run(key);
        },
        catch: storageError,
      }),
  };
}

export const layer: Layer.Layer<DropwaveStore, DropwaveOperationError, ServerConfig.ServerConfig> =
  Layer.effect(
    DropwaveStore,
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const dbPath = NodePath.join(config.stateDir, "dropwave.sqlite");
      const db = yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            NodeFS.mkdirSync(config.stateDir, { recursive: true });
            const handle = new NodeSqlite.DatabaseSync(dbPath);
            initializeDropwaveSchema(handle);
            return handle;
          },
          catch: storageError,
        }),
        (handle) =>
          Effect.sync(() => {
            try {
              handle.close();
            } catch {
              // ignore close errors on shutdown
            }
          }),
      );
      return DropwaveStore.of(makeDropwaveStore(db));
    }),
  );

export const layerMemory: Layer.Layer<DropwaveStore, DropwaveOperationError> = Layer.effect(
  DropwaveStore,
  Effect.acquireRelease(
    Effect.try({
      try: () => {
        const handle = new NodeSqlite.DatabaseSync(":memory:");
        initializeDropwaveSchema(handle);
        return handle;
      },
      catch: storageError,
    }),
    (handle) =>
      Effect.sync(() => {
        try {
          handle.close();
        } catch {
          // ignore
        }
      }),
  ).pipe(Effect.map((db) => DropwaveStore.of(makeDropwaveStore(db)))),
);
