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
  type DropwaveMemoryAuthority,
  type DropwaveMemoryConfidence,
  type DropwaveMemoryItem,
  type DropwaveMemoryKind,
  type DropwaveMemoryScope,
  type DropwaveMemoryStatus,
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

export function initializeDropwaveSchema(db: NodeSqlite.DatabaseSync): void {
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

    CREATE TABLE IF NOT EXISTS dropwave_habit_summaries (
      task_id TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      project_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (task_id, prompt_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_dropwave_habit_summaries_project
      ON dropwave_habit_summaries (project_id);
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
  initializeMemoryV2Schema(db);
}

// Memory v2 (Row-Bot knowledge_graph.py / memory_policy.py, Apache-2.0):
// scope 'global' splits into 'owner' (no persona) and 'bot' (persona set);
// 'project' stays. project_id becomes nullable for owner/bot rows.
function initializeMemoryV2Schema(db: NodeSqlite.DatabaseSync): void {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(dropwave_memories)").all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  );
  if (!columns.has("subject")) {
    // Pre-v2 table: rebuild with the full column set and migrate rows in one
    // transaction so no memory is lost. Scope 'global' + persona_id NULL becomes
    // 'owner', 'global' + persona_id becomes 'bot', 'project' is unchanged.
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`
        CREATE TABLE dropwave_memories_v2 (
          id TEXT PRIMARY KEY,
          scope TEXT NOT NULL,
          persona_id TEXT,
          project_id TEXT,
          bot_thread_id TEXT,
          kind TEXT NOT NULL,
          subject TEXT NOT NULL DEFAULT '',
          text TEXT NOT NULL,
          aliases_json TEXT NOT NULL DEFAULT '[]',
          tags_json TEXT NOT NULL DEFAULT '[]',
          tier TEXT NOT NULL DEFAULT 'semantic',
          status TEXT NOT NULL DEFAULT 'active',
          authority TEXT NOT NULL DEFAULT 'agent',
          confidence TEXT NOT NULL,
          evidence_json TEXT NOT NULL DEFAULT '[]',
          quote TEXT,
          source_message_id TEXT,
          supersedes_id TEXT,
          superseded_by_id TEXT,
          conflict_json TEXT,
          journal_json TEXT NOT NULL DEFAULT '[]',
          revision INTEGER NOT NULL DEFAULT 1,
          last_user_modified_at TEXT,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO dropwave_memories_v2 (
          id, scope, persona_id, project_id, bot_thread_id, kind, subject, text,
          aliases_json, tags_json, tier, status, authority, confidence,
          evidence_json, quote, source_message_id, supersedes_id, superseded_by_id,
          conflict_json, journal_json, revision, last_user_modified_at, active,
          created_at, updated_at
        )
        SELECT
          id,
          CASE
            WHEN scope = 'global' AND persona_id IS NULL THEN 'owner'
            WHEN scope = 'global' THEN 'bot'
            ELSE 'project'
          END,
          persona_id,
          CASE WHEN scope = 'project' THEN project_id ELSE NULL END,
          bot_thread_id,
          kind,
          '',
          text,
          '[]',
          '[]',
          'semantic',
          CASE WHEN active = 0 THEN 'archived' ELSE 'active' END,
          'agent',
          CASE WHEN confidence IN ('mentioned', 'learned', 'confirmed') THEN confidence ELSE 'mentioned' END,
          CASE
            WHEN quote IS NOT NULL AND quote != '' THEN
              json_array(json_object('quote', quote, 'source_message_id', source_message_id, 'at', updated_at))
            ELSE '[]'
          END,
          quote,
          source_message_id,
          NULL,
          NULL,
          NULL,
          '[]',
          1,
          NULL,
          CASE WHEN active = 0 THEN 0 ELSE 1 END,
          created_at,
          updated_at
        FROM dropwave_memories;
        DROP TABLE dropwave_memories;
        ALTER TABLE dropwave_memories_v2 RENAME TO dropwave_memories;
      `);
      db.exec("COMMIT");
    } catch (cause) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // ignore rollback failure; surface the original error
      }
      throw cause;
    }
  } else {
    // v2 table exists; fill any column a partial migration may have missed.
    const v2Defaults: Record<string, string> = {
      subject: "TEXT NOT NULL DEFAULT ''",
      aliases_json: "TEXT NOT NULL DEFAULT '[]'",
      tags_json: "TEXT NOT NULL DEFAULT '[]'",
      tier: "TEXT NOT NULL DEFAULT 'semantic'",
      status: "TEXT NOT NULL DEFAULT 'active'",
      authority: "TEXT NOT NULL DEFAULT 'agent'",
      evidence_json: "TEXT NOT NULL DEFAULT '[]'",
      journal_json: "TEXT NOT NULL DEFAULT '[]'",
      revision: "INTEGER NOT NULL DEFAULT 1",
      active: "INTEGER NOT NULL DEFAULT 1",
    };
    for (const [name, ddl] of Object.entries(v2Defaults)) {
      if (!columns.has(name)) {
        db.exec(`ALTER TABLE dropwave_memories ADD COLUMN ${name} ${ddl}`);
      }
    }
    for (const name of [
      "persona_id",
      "project_id",
      "bot_thread_id",
      "quote",
      "source_message_id",
      "supersedes_id",
      "superseded_by_id",
      "conflict_json",
      "last_user_modified_at",
    ]) {
      if (!columns.has(name)) {
        db.exec(`ALTER TABLE dropwave_memories ADD COLUMN ${name} TEXT`);
      }
    }
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_dropwave_memories_scope_v2
      ON dropwave_memories (scope, persona_id, status);
    CREATE INDEX IF NOT EXISTS idx_dropwave_memories_project_v2
      ON dropwave_memories (project_id, status, updated_at DESC);

    -- Controlled relation types (Row-Bot knowledge_graph.py RELATION_ALIASES,
    -- trimmed to the set Dropwave memory actually uses).
    CREATE TABLE IF NOT EXISTS memory_relations (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      type TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 1,
      origin TEXT NOT NULL DEFAULT 'agent',
      created_at TEXT NOT NULL,
      UNIQUE (source_id, target_id, type),
      CHECK (source_id != target_id),
      CHECK (type IN ('about', 'part_of', 'depends_on', 'replaces', 'contradicts', 'owned_by', 'uses', 'decided_in'))
    );
    CREATE INDEX IF NOT EXISTS idx_memory_relations_source
      ON memory_relations (source_id);
    CREATE INDEX IF NOT EXISTS idx_memory_relations_target
      ON memory_relations (target_id);

    -- FTS5 keyword index over the meaning fields only (Row-Bot knowledge_graph.py
    -- search index); provenance columns are never indexed.
    CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
      item_id UNINDEXED,
      subject,
      text,
      aliases,
      tags
    );

    CREATE TABLE IF NOT EXISTS memory_vectors (
      item_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      dim INTEGER NOT NULL,
      vector BLOB NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (item_id, model_id)
    );

    -- Recall stamps live apart from the item so a recall never rewrites it
    -- (Row-Bot memory_recall_stamps).
    CREATE TABLE IF NOT EXISTS memory_recall_stamps (
      item_id TEXT PRIMARY KEY,
      last_recalled_at TEXT NOT NULL,
      recall_count INTEGER NOT NULL DEFAULT 0
    );

    -- Diff-only recall: an item is shown once per conversation segment
    -- (Row-Bot turn_context.py shown-ids diff).
    CREATE TABLE IF NOT EXISTS memory_shown (
      thread_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      shown_at TEXT NOT NULL,
      PRIMARY KEY (thread_id, item_id)
    );

    -- Dream rejection cache: hash(model + exact prompt) -> verdict, 30 days.
    CREATE TABLE IF NOT EXISTS memory_rejections (
      hash TEXT PRIMARY KEY,
      verdict_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    -- Per-turn recall traces for the Memory screen's "why did it remember".
    CREATE TABLE IF NOT EXISTS memory_recall_traces (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      trace_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_recall_traces_thread
      ON memory_recall_traces (thread_id, created_at DESC);
  `);

  // Backfill FTS for rows that predate the index. The NOT EXISTS guard keeps
  // this idempotent regardless of how many rows are already indexed.
  db.exec(`
    INSERT INTO memory_fts (item_id, subject, text, aliases, tags)
    SELECT m.id, m.subject, m.text, m.aliases_json, m.tags_json
    FROM dropwave_memories m
    WHERE m.status NOT IN ('archived', 'superseded')
      AND NOT EXISTS (SELECT 1 FROM memory_fts f WHERE f.item_id = m.id);
  `);
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
  readonly scope: string;
  readonly persona_id: string | null;
  readonly project_id: string | null;
  readonly bot_thread_id: string | null;
  readonly kind: string;
  readonly subject: string;
  readonly text: string;
  readonly aliases_json: string;
  readonly tags_json: string;
  readonly tier: string;
  readonly status: string;
  readonly authority: string;
  readonly confidence: string;
  readonly evidence_json: string;
  readonly quote: string | null;
  readonly source_message_id: string | null;
  readonly supersedes_id: string | null;
  readonly superseded_by_id: string | null;
  readonly conflict_json: string | null;
  readonly journal_json: string;
  readonly revision: number;
  readonly last_user_modified_at: string | null;
  readonly active: number;
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
  const evidence = parseJsonArray<{
    quote: string;
    source_message_id?: string | null;
    thread_id?: string | null;
    at: string;
  }>(row.evidence_json).map((entry) => ({
    quote: entry.quote,
    ...(entry.source_message_id !== undefined ? { sourceMessageId: entry.source_message_id } : {}),
    ...(entry.thread_id !== undefined ? { threadId: entry.thread_id } : {}),
    at: asIsoDateTime(entry.at),
  }));
  const conflictRaw = row.conflict_json ? parseJsonObject(row.conflict_json) : null;
  const conflict =
    conflictRaw && typeof conflictRaw.candidate === "string"
      ? {
          candidate: conflictRaw.candidate,
          reason: typeof conflictRaw.reason === "string" ? conflictRaw.reason : "",
          at: asIsoDateTime(typeof conflictRaw.at === "string" ? conflictRaw.at : row.updated_at),
          ...(typeof conflictRaw.with_id === "string" ? { withId: conflictRaw.with_id } : {}),
        }
      : undefined;
  return {
    id: row.id,
    projectId: row.project_id ? ProjectId.make(row.project_id) : null,
    botThreadId: row.bot_thread_id ? ThreadId.make(row.bot_thread_id) : null,
    scope: (row.scope === "owner" || row.scope === "bot"
      ? row.scope
      : "project") as DropwaveMemoryScope,
    personaId: row.persona_id ?? null,
    kind: row.kind as DropwaveMemoryKind,
    subject: row.subject ?? "",
    text: row.text,
    aliases: parseJsonArray<string>(row.aliases_json ?? "[]"),
    tags: parseJsonArray<string>(row.tags_json ?? "[]"),
    tier: (row.tier === "core" || row.tier === "episodic" ? row.tier : "semantic") as
      | "core"
      | "semantic"
      | "episodic",
    status: (row.status === "needs_review" ||
    row.status === "superseded" ||
    row.status === "archived"
      ? row.status
      : "active") as DropwaveMemoryStatus,
    authority: (row.authority === "owner" || row.authority === "import"
      ? row.authority
      : "agent") as DropwaveMemoryAuthority,
    evidence,
    ...(row.quote ? { quote: row.quote } : {}),
    ...(row.source_message_id ? { sourceMessageId: row.source_message_id } : {}),
    ...(row.supersedes_id ? { supersedesId: row.supersedes_id } : {}),
    ...(row.superseded_by_id ? { supersededById: row.superseded_by_id } : {}),
    ...(conflict ? { conflict } : {}),
    journal: parseJsonArray<{
      at: string;
      by: string;
      action: string;
      before?: unknown;
      after?: unknown;
    }>(row.journal_json ?? "[]").map((entry) => ({
      at: asIsoDateTime(entry.at),
      by: entry.by,
      action: entry.action,
      ...(entry.before !== undefined ? { before: entry.before } : {}),
      ...(entry.after !== undefined ? { after: entry.after } : {}),
    })),
    revision: row.revision ?? 1,
    ...(row.last_user_modified_at
      ? { lastUserModifiedAt: asIsoDateTime(row.last_user_modified_at) }
      : {}),
    confidence: row.confidence as DropwaveMemoryConfidence,
    createdAt: asIsoDateTime(row.created_at),
    updatedAt: asIsoDateTime(row.updated_at),
  };
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const MEMORY_JOURNAL_LIMIT = 50;

function appendJournal(
  journalJson: string,
  by: string,
  action: string,
  before?: unknown,
  after?: unknown,
): string {
  const journal = parseJsonArray<{
    at: string;
    by: string;
    action: string;
    before?: unknown;
    after?: unknown;
  }>(journalJson);
  journal.push({
    at: nowIso(),
    by,
    action,
    ...(before !== undefined ? { before } : {}),
    ...(after !== undefined ? { after } : {}),
  });
  return JSON.stringify(journal.slice(-MEMORY_JOURNAL_LIMIT));
}

function mergeEvidenceJson(existingJson: string, additions: ReadonlyArray<unknown>): string {
  const merged = parseJsonArray<Record<string, unknown>>(existingJson);
  const seen = new Set(
    merged.map((entry) => `${entry.quote ?? ""}|${entry.source_message_id ?? ""}`),
  );
  for (const addition of additions) {
    const record = addition as Record<string, unknown>;
    const key = `${record.quote ?? ""}|${record.source_message_id ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(record as never);
    if (merged.length >= 8) break;
  }
  return JSON.stringify(merged.slice(-8));
}

function ftsTextList(json: string): string {
  return parseJsonArray<string>(json).join(" ");
}

// Keep the FTS index in step with the row: provenance columns never indexed.
function syncMemoryFts(db: NodeSqlite.DatabaseSync, row: MemoryRow): void {
  db.prepare("DELETE FROM memory_fts WHERE item_id = ?").run(row.id);
  if (row.status === "archived" || row.status === "superseded") return;
  db.prepare(
    "INSERT INTO memory_fts (item_id, subject, text, aliases, tags) VALUES (?, ?, ?, ?, ?)",
  ).run(
    row.id,
    row.subject ?? "",
    row.text,
    ftsTextList(row.aliases_json ?? "[]"),
    ftsTextList(row.tags_json ?? "[]"),
  );
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

export interface DropwaveHabitSummaryItem {
  readonly taskId: string;
  readonly summary: string;
  readonly updatedAt: IsoDateTime;
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
    readonly statuses?: ReadonlyArray<DropwaveMemoryStatus> | undefined;
    readonly scope?: DropwaveMemoryScope | undefined;
    readonly limit?: number | undefined;
  }) => Effect.Effect<ReadonlyArray<DropwaveMemoryItem>, DropwaveOperationError>;

  readonly listDreamMemoryItems: () => Effect.Effect<
    ReadonlyArray<DropwaveMemoryItem>,
    DropwaveOperationError
  >;

  readonly decayDreamRelations: (input: {
    readonly scale: number;
    readonly pruneBelow: number;
  }) => Effect.Effect<
    { readonly decayed: number; readonly pruned: number },
    DropwaveOperationError
  >;

  readonly searchMemoryFts: (input: {
    readonly query: string;
    readonly projectId: ProjectId;
    readonly botThreadId?: ThreadId | undefined;
    readonly personaId?: string | undefined;
    readonly limit?: number | undefined;
  }) => Effect.Effect<
    ReadonlyArray<{ readonly id: string; readonly rank: number }>,
    DropwaveOperationError
  >;

  readonly saveMemory: (input: {
    readonly projectId: ProjectId;
    readonly botThreadId?: ThreadId | null | undefined;
    readonly scope?: DropwaveMemoryScope | undefined;
    readonly personaId?: string | null | undefined;
    readonly kind: DropwaveMemoryKind;
    readonly subject?: string | undefined;
    readonly text: string;
    readonly aliases?: ReadonlyArray<string> | undefined;
    readonly tags?: ReadonlyArray<string> | undefined;
    readonly tier?: "core" | "semantic" | "episodic" | undefined;
    readonly quote?: string | undefined;
    readonly sourceMessageId?: string | null | undefined;
    readonly threadId?: string | null | undefined;
    readonly evidence?:
      | ReadonlyArray<{
          readonly quote: string;
          readonly sourceMessageId?: string | null;
          readonly threadId?: string | null;
          readonly at: string;
        }>
      | undefined;
    readonly authority?: "owner" | "agent" | "import" | undefined;
    readonly confidence?: DropwaveMemoryConfidence | undefined;
    readonly supersedesId?: string | null | undefined;
  }) => Effect.Effect<DropwaveMemoryItem, DropwaveOperationError>;

  readonly updateMemory: (input: {
    readonly id: string;
    readonly revision: number;
    readonly text?: string | undefined;
    readonly subject?: string | undefined;
    readonly aliases?: ReadonlyArray<string> | undefined;
    readonly tags?: ReadonlyArray<string> | undefined;
    readonly kind?: DropwaveMemoryKind | undefined;
    readonly status?: DropwaveMemoryStatus | undefined;
    readonly conflict?:
      | {
          readonly candidate: string;
          readonly reason: string;
          readonly withId?: string | null;
        }
      | null
      | undefined;
    readonly by?: string | undefined;
  }) => Effect.Effect<DropwaveMemoryItem, DropwaveOperationError>;

  readonly removeMemory: (
    id: string,
    by?: string,
  ) => Effect.Effect<boolean, DropwaveOperationError>;

  readonly setMemoryScope: (
    id: string,
    scope: DropwaveMemoryScope,
    context?: { readonly projectId?: ProjectId; readonly personaId?: string | null },
  ) => Effect.Effect<DropwaveMemoryItem, DropwaveOperationError>;

  readonly getMemory: (
    id: string,
  ) => Effect.Effect<DropwaveMemoryItem | undefined, DropwaveOperationError>;

  readonly undoMemory: (
    id: string,
    by?: string,
  ) => Effect.Effect<DropwaveMemoryItem, DropwaveOperationError>;

  readonly resolveMemoryReview: (
    id: string,
    action: "keep_old" | "use_new" | "keep_both",
    by?: string,
  ) => Effect.Effect<DropwaveMemoryItem, DropwaveOperationError>;

  readonly addMemoryRelation: (input: {
    readonly sourceId: string;
    readonly targetId: string;
    readonly type:
      | "about"
      | "part_of"
      | "depends_on"
      | "replaces"
      | "contradicts"
      | "owned_by"
      | "uses"
      | "decided_in";
    readonly confidence?: number | undefined;
    readonly origin?: "owner" | "agent" | "import" | "dream" | undefined;
  }) => Effect.Effect<{ readonly id: string }, DropwaveOperationError>;

  readonly listMemoryRelations: (memoryId: string) => Effect.Effect<
    ReadonlyArray<{
      readonly id: string;
      readonly sourceId: string;
      readonly targetId: string;
      readonly type: string;
      readonly confidence: number;
      readonly origin: string;
    }>,
    DropwaveOperationError
  >;

  readonly removeMemoryRelation: (
    relationId: string,
  ) => Effect.Effect<boolean, DropwaveOperationError>;

  readonly stampMemoryRecall: (
    itemIds: ReadonlyArray<string>,
  ) => Effect.Effect<void, DropwaveOperationError>;

  readonly getShownMemoryIds: (
    threadId: string,
  ) => Effect.Effect<ReadonlyArray<string>, DropwaveOperationError>;

  readonly markMemoriesShown: (
    threadId: string,
    itemIds: ReadonlyArray<string>,
  ) => Effect.Effect<void, DropwaveOperationError>;

  readonly recordRecallTrace: (input: {
    readonly threadId: string;
    readonly turnKey: string;
    readonly trace: unknown;
  }) => Effect.Effect<void, DropwaveOperationError>;

  readonly listRecallTraces: (
    threadId: string,
    limit?: number,
  ) => Effect.Effect<
    ReadonlyArray<{
      readonly id: string;
      readonly turnKey: string;
      readonly createdAt: string;
      readonly trace: unknown;
    }>,
    DropwaveOperationError
  >;

  readonly getMemoryRejection: (
    hash: string,
  ) => Effect.Effect<unknown | undefined, DropwaveOperationError>;

  readonly putMemoryRejection: (input: {
    readonly hash: string;
    readonly verdict: unknown;
    readonly ttlDays?: number | undefined;
  }) => Effect.Effect<void, DropwaveOperationError>;

  readonly getMemoryVectors: (
    itemIds: ReadonlyArray<string>,
    modelId: string,
  ) => Effect.Effect<
    ReadonlyMap<
      string,
      { readonly dim: number; readonly vector: Float32Array; readonly contentHash: string }
    >,
    DropwaveOperationError
  >;

  readonly putMemoryVector: (input: {
    readonly itemId: string;
    readonly modelId: string;
    readonly dim: number;
    readonly vector: Float32Array;
    readonly contentHash: string;
  }) => Effect.Effect<void, DropwaveOperationError>;

  readonly deleteMemoryVector: (
    itemId: string,
    modelId?: string,
  ) => Effect.Effect<void, DropwaveOperationError>;

  readonly getMemoryMeta: (
    key: string,
  ) => Effect.Effect<unknown | undefined, DropwaveOperationError>;

  readonly setMemoryMeta: (
    key: string,
    value: unknown,
  ) => Effect.Effect<void, DropwaveOperationError>;

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

  readonly deletePersona: (id: string) => Effect.Effect<boolean, DropwaveOperationError>;

  readonly saveHabitSummary: (input: {
    readonly taskId: string;
    readonly projectId: ProjectId;
    readonly promptHash: string;
    readonly summary: string;
  }) => Effect.Effect<void, DropwaveOperationError>;

  readonly listHabitSummaries: (input: {
    readonly projectId: ProjectId;
  }) => Effect.Effect<ReadonlyArray<DropwaveHabitSummaryItem>, DropwaveOperationError>;

  readonly deleteProjectData: (input: {
    readonly projectId: ProjectId;
    readonly threadIds: ReadonlyArray<ThreadId>;
  }) => Effect.Effect<
    {
      readonly asks: number;
      readonly counters: number;
      readonly memories: number;
      readonly summaryNodes: number;
      readonly habitSummaries: number;
    },
    DropwaveOperationError
  >;

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
             WHERE source_message_id = ? AND status IN ('heard', 'maybe') AND kind != 'idea'
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
            "scope = 'owner'",
          ];
          const params: Array<string> = [input.projectId];
          if (input.botThreadId !== undefined) params.push(input.botThreadId);
          if (input.personaId !== undefined) {
            scopeClauses.push("(scope = 'bot' AND persona_id = ?)");
            params.push(input.personaId);
          }
          const statuses = input.statuses ?? ["active"];
          const clauses = [
            `(${scopeClauses.join(" OR ")})`,
            `status IN (${statuses.map(() => "?").join(",")})`,
          ];
          params.push(...statuses);
          if (input.scope !== undefined) {
            clauses.push("scope = ?");
            params.push(input.scope);
          }
          if (input.query?.trim()) {
            const like = `%${input.query.trim().toLowerCase()}%`;
            clauses.push(
              "(LOWER(text) LIKE ? OR LOWER(COALESCE(subject, '')) LIKE ? OR LOWER(COALESCE(quote, '')) LIKE ?)",
            );
            params.push(like, like, like);
          }
          const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
          const rows = getAll<MemoryRow>(
            `SELECT * FROM dropwave_memories
             WHERE ${clauses.join(" AND ")}
             ORDER BY CASE confidence WHEN 'confirmed' THEN 0 WHEN 'learned' THEN 1 ELSE 2 END, updated_at DESC
             LIMIT ${limit}`,
            ...params,
          );
          return rows.map(rowToMemory);
        },
        catch: storageError,
      }),

    listDreamMemoryItems: () =>
      Effect.try({
        try: () =>
          getAll<MemoryRow>(
            `SELECT * FROM dropwave_memories
             WHERE status = 'active' AND authority != 'owner'
             ORDER BY updated_at DESC
             LIMIT 2000`,
          ).map(rowToMemory),
        catch: storageError,
      }),

    decayDreamRelations: (input) =>
      Effect.try({
        try: () => {
          const decayed = db
            .prepare(
              `UPDATE memory_relations
               SET confidence = confidence * ?
               WHERE origin = 'dream'`,
            )
            .run(input.scale).changes;
          const pruned = db
            .prepare(
              `DELETE FROM memory_relations
               WHERE origin = 'dream' AND confidence < ?`,
            )
            .run(input.pruneBelow).changes;
          return { decayed, pruned };
        },
        catch: storageError,
      }),

    searchMemoryFts: (input) =>
      Effect.try({
        try: () => {
          const STOPWORDS = new Set([
            "a",
            "an",
            "and",
            "are",
            "as",
            "at",
            "be",
            "but",
            "by",
            "do",
            "does",
            "for",
            "from",
            "had",
            "has",
            "have",
            "he",
            "her",
            "his",
            "how",
            "i",
            "if",
            "in",
            "is",
            "it",
            "its",
            "me",
            "my",
            "of",
            "on",
            "or",
            "our",
            "she",
            "so",
            "that",
            "the",
            "their",
            "them",
            "they",
            "this",
            "to",
            "was",
            "we",
            "were",
            "what",
            "when",
            "where",
            "which",
            "who",
            "why",
            "will",
            "with",
            "you",
            "your",
          ]);
          const tokens = (input.query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
            .filter((token) => !STOPWORDS.has(token))
            .slice(0, 12)
            .map((token) => `"${token.replace(/"/g, "")}"`);
          if (tokens.length === 0) return [];
          const scopeClauses = [
            "(m.scope = 'project' AND m.project_id = ?" +
              (input.botThreadId !== undefined
                ? " AND (m.bot_thread_id IS NULL OR m.bot_thread_id = ?)"
                : "") +
              ")",
            "m.scope = 'owner'",
          ];
          const params: Array<string> = [input.projectId];
          if (input.botThreadId !== undefined) params.push(input.botThreadId);
          if (input.personaId !== undefined) {
            scopeClauses.push("(m.scope = 'bot' AND m.persona_id = ?)");
            params.push(input.personaId);
          }
          const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
          const rows = getAll<{ id: string }>(
            `SELECT m.id
             FROM memory_fts
             JOIN dropwave_memories m ON m.id = memory_fts.item_id
             WHERE memory_fts MATCH ?
               AND (${scopeClauses.join(" OR ")})
               AND m.status = 'active'
             ORDER BY bm25(memory_fts)
             LIMIT ${limit}`,
            tokens.join(" OR "),
            ...params,
          );
          // bm25 is negative (lower = better); expose a 0..1 rank, 0 = best.
          return rows.map((row, index) => ({
            id: row.id,
            rank: rows.length <= 1 ? 0 : index / (rows.length - 1),
          }));
        },
        catch: storageError,
      }),

    saveMemory: (input) =>
      Effect.try({
        try: () => {
          const text = oneLine(input.text).slice(0, 600);
          const timestamp = nowIso();
          const scope: DropwaveMemoryScope = input.scope ?? "project";
          const personaId = scope === "bot" ? (input.personaId ?? null) : null;
          const projectId = scope === "project" ? input.projectId : null;
          const authority = input.authority ?? "agent";
          const evidenceJson = JSON.stringify(
            (
              input.evidence ??
              (input.quote
                ? [
                    {
                      quote: clipQuote(input.quote),
                      sourceMessageId: input.sourceMessageId ?? null,
                      threadId: input.threadId ?? null,
                      at: timestamp,
                    },
                  ]
                : [])
            ).slice(0, 8),
          );
          const quote = input.quote ? clipQuote(input.quote) : null;
          // Exact-text or same-quote duplicates inside the same scope fold into
          // the existing row (evidence + confidence upgrade); richer dedupe,
          // merge and conflict handling lives in memoryDedupe.ts.
          const duplicate = getOne<MemoryRow>(
            scope === "project"
              ? `SELECT * FROM dropwave_memories
                 WHERE scope = 'project' AND project_id = ? AND status = 'active'
                   AND (LOWER(text) = LOWER(?) OR (? IS NOT NULL AND LOWER(quote) = LOWER(?)))
                 LIMIT 1`
              : `SELECT * FROM dropwave_memories
                 WHERE scope = ? AND persona_id IS ? AND status = 'active'
                   AND (LOWER(text) = LOWER(?) OR (? IS NOT NULL AND LOWER(quote) = LOWER(?)))
                 LIMIT 1`,
            ...(scope === "project"
              ? [input.projectId, text, quote, quote]
              : [scope, personaId, text, quote, quote]),
          );
          if (duplicate) {
            const confidence = input.confidence ?? duplicate.confidence;
            const mergedEvidence = mergeEvidenceJson(
              duplicate.evidence_json,
              input.evidence ??
                (quote
                  ? [
                      {
                        quote,
                        sourceMessageId: input.sourceMessageId ?? null,
                        threadId: input.threadId ?? null,
                        at: timestamp,
                      },
                    ]
                  : []),
            );
            db.prepare(
              `UPDATE dropwave_memories
               SET confidence = ?, updated_at = ?, quote = COALESCE(?, quote),
                   evidence_json = ?, revision = revision + 1
               WHERE id = ?`,
            ).run(confidence, timestamp, quote, mergedEvidence, duplicate.id);
            const row = getOne<MemoryRow>(
              "SELECT * FROM dropwave_memories WHERE id = ?",
              duplicate.id,
            )!;
            syncMemoryFts(db, row);
            return rowToMemory(row);
          }
          const id = makeId("mem");
          const journal = JSON.stringify([
            {
              at: timestamp,
              by: authority === "owner" ? "owner" : (input.threadId ?? "agent"),
              action: "create",
              after: { text, kind: input.kind, scope },
            },
          ]);
          db.prepare(
            `INSERT INTO dropwave_memories
              (id, scope, persona_id, project_id, bot_thread_id, kind, subject, text,
               aliases_json, tags_json, tier, status, authority, confidence,
               evidence_json, quote, source_message_id, journal_json, revision,
               last_user_modified_at, active, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, 1, ?, 1, ?, ?)`,
          ).run(
            id,
            scope,
            personaId,
            projectId,
            scope === "project" ? (input.botThreadId ?? null) : null,
            input.kind,
            (input.subject ?? "").slice(0, 120),
            text,
            JSON.stringify((input.aliases ?? []).slice(0, 12)),
            JSON.stringify((input.tags ?? []).slice(0, 12)),
            input.tier ?? "semantic",
            authority,
            input.confidence ?? "learned",
            evidenceJson,
            quote,
            input.sourceMessageId ?? null,
            journal,
            authority === "owner" ? timestamp : null,
            timestamp,
            timestamp,
          );
          const row = getOne<MemoryRow>("SELECT * FROM dropwave_memories WHERE id = ?", id)!;
          syncMemoryFts(db, row);
          return rowToMemory(row);
        },
        catch: storageError,
      }),

    updateMemory: (input) =>
      Effect.try({
        try: () => {
          const existing = getOne<MemoryRow>(
            "SELECT * FROM dropwave_memories WHERE id = ?",
            input.id,
          );
          if (!existing) {
            throw new DropwaveOperationError({
              code: "not_found",
              message: `Memory "${input.id}" not found.`,
            });
          }
          // Compare-and-swap: a write against a moved revision is rejected, not merged.
          if (existing.revision !== input.revision) {
            throw new DropwaveOperationError({
              code: "conflict",
              message: `Memory "${input.id}" changed since it was read (revision ${existing.revision}).`,
            });
          }
          const timestamp = nowIso();
          const by = input.by ?? "agent";
          const isOwnerEdit = by === "owner";
          const nextText =
            input.text !== undefined ? oneLine(input.text).slice(0, 600) : existing.text;
          const nextSubject =
            input.subject !== undefined ? input.subject.slice(0, 120) : existing.subject;
          const nextKind = input.kind ?? (existing.kind as DropwaveMemoryKind);
          const nextStatus = input.status ?? (existing.status as DropwaveMemoryStatus);
          const nextAliases =
            input.aliases !== undefined
              ? JSON.stringify(input.aliases.slice(0, 12))
              : existing.aliases_json;
          const nextTags =
            input.tags !== undefined ? JSON.stringify(input.tags.slice(0, 12)) : existing.tags_json;
          const nextConflict =
            input.conflict === undefined
              ? existing.conflict_json
              : input.conflict === null
                ? null
                : JSON.stringify({
                    candidate: input.conflict.candidate,
                    reason: input.conflict.reason,
                    at: timestamp,
                    ...(input.conflict.withId ? { with_id: input.conflict.withId } : {}),
                  });
          const journal = appendJournal(
            existing.journal_json,
            by,
            input.status !== undefined && input.status !== existing.status
              ? `status:${existing.status}->${nextStatus}`
              : "update",
            {
              text: existing.text,
              subject: existing.subject,
              kind: existing.kind,
              status: existing.status,
            },
            {
              text: nextText,
              subject: nextSubject,
              kind: nextKind,
              status: nextStatus,
            },
          );
          const active = nextStatus === "active" || nextStatus === "needs_review" ? 1 : 0;
          db.prepare(
            `UPDATE dropwave_memories
             SET text = ?, subject = ?, kind = ?, status = ?, aliases_json = ?, tags_json = ?,
                 conflict_json = ?,
                 journal_json = ?, revision = revision + 1, updated_at = ?,
                 last_user_modified_at = ?, active = ?,
                 authority = CASE WHEN ? = 'owner' THEN 'owner' ELSE authority END
             WHERE id = ?`,
          ).run(
            nextText,
            nextSubject,
            nextKind,
            nextStatus,
            nextAliases,
            nextTags,
            nextConflict,
            journal,
            timestamp,
            isOwnerEdit ? timestamp : existing.last_user_modified_at,
            active,
            isOwnerEdit ? "owner" : "agent",
            input.id,
          );
          const row = getOne<MemoryRow>("SELECT * FROM dropwave_memories WHERE id = ?", input.id)!;
          syncMemoryFts(db, row);
          return rowToMemory(row);
        },
        catch: (cause) => (isDropwaveError(cause) ? cause : storageError(cause)),
      }),

    removeMemory: (id, by) =>
      Effect.try({
        try: () => {
          const existing = getOne<MemoryRow>("SELECT * FROM dropwave_memories WHERE id = ?", id);
          if (!existing || existing.status === "archived") {
            return false;
          }
          const timestamp = nowIso();
          const journal = appendJournal(existing.journal_json, by ?? "agent", "archive", {
            status: existing.status,
          });
          db.prepare(
            `UPDATE dropwave_memories
             SET status = 'archived', active = 0, journal_json = ?, revision = revision + 1, updated_at = ?
             WHERE id = ?`,
          ).run(journal, timestamp, id);
          db.prepare("DELETE FROM memory_fts WHERE item_id = ?").run(id);
          return true;
        },
        catch: storageError,
      }),

    setMemoryScope: (id, scope, context) =>
      Effect.try({
        try: () => {
          const existing = getOne<MemoryRow>(
            "SELECT * FROM dropwave_memories WHERE id = ? AND status != 'archived'",
            id,
          );
          if (!existing) {
            throw new DropwaveOperationError({
              code: "not_found",
              message: `Memory "${id}" not found.`,
            });
          }
          const projectId = scope === "project" ? (context?.projectId ?? null) : null;
          const personaId = scope === "bot" ? (context?.personaId ?? existing.persona_id) : null;
          if (scope === "project" && projectId === null) {
            throw new DropwaveOperationError({
              code: "invalid_input",
              message: "Moving a memory to project scope needs a project.",
            });
          }
          const timestamp = nowIso();
          const journal = appendJournal(existing.journal_json, "owner", "scope", {
            scope: existing.scope,
            project_id: existing.project_id,
            persona_id: existing.persona_id,
          });
          db.prepare(
            `UPDATE dropwave_memories
             SET scope = ?, project_id = ?, persona_id = ?, bot_thread_id = ?,
                 journal_json = ?, revision = revision + 1, updated_at = ?,
                 last_user_modified_at = ?, authority = 'owner'
             WHERE id = ?`,
          ).run(
            scope,
            projectId,
            personaId,
            scope === "project" ? existing.bot_thread_id : null,
            journal,
            timestamp,
            timestamp,
            id,
          );
          const row = getOne<MemoryRow>("SELECT * FROM dropwave_memories WHERE id = ?", id)!;
          syncMemoryFts(db, row);
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

    getMemory: (id) =>
      Effect.try({
        try: () => {
          const row = getOne<MemoryRow>("SELECT * FROM dropwave_memories WHERE id = ?", id);
          return row ? rowToMemory(row) : undefined;
        },
        catch: storageError,
      }),

    undoMemory: (id, by) =>
      Effect.try({
        try: () => {
          const existing = getOne<MemoryRow>("SELECT * FROM dropwave_memories WHERE id = ?", id);
          if (!existing) {
            throw new DropwaveOperationError({
              code: "not_found",
              message: `Memory "${id}" not found.`,
            });
          }
          const journal = parseJsonArray<{
            at: string;
            by: string;
            action: string;
            before?: {
              text?: string;
              subject?: string;
              kind?: string;
              status?: string;
              scope?: string;
              project_id?: string | null;
              persona_id?: string | null;
            };
            after?: unknown;
          }>(existing.journal_json);
          const last = journal[journal.length - 1];
          if (!last || last.action === "undo" || last.action === "create") {
            throw new DropwaveOperationError({
              code: "invalid_input",
              message: `Memory "${id}" has no change to undo.`,
            });
          }
          const before = last.before;
          const timestamp = nowIso();
          const nextStatus =
            before?.status === "active" || before?.status === "needs_review"
              ? before.status
              : existing.status === "archived"
                ? "active"
                : existing.status;
          const journalNext = appendJournal(existing.journal_json, by ?? "owner", "undo", {
            status: existing.status,
          });
          db.prepare(
            `UPDATE dropwave_memories
             SET text = COALESCE(?, text), subject = COALESCE(?, subject),
                 kind = COALESCE(?, kind), status = ?, scope = COALESCE(?, scope),
                 project_id = COALESCE(?, project_id), persona_id = COALESCE(?, persona_id),
                 journal_json = ?, revision = revision + 1, updated_at = ?,
                 active = ?, authority = CASE WHEN ? = 'owner' THEN 'owner' ELSE authority END
             WHERE id = ?`,
          ).run(
            before?.text ?? null,
            before?.subject ?? null,
            before?.kind ?? null,
            nextStatus,
            before?.scope ?? null,
            before?.project_id ?? null,
            before?.persona_id ?? null,
            journalNext,
            timestamp,
            nextStatus === "active" || nextStatus === "needs_review" ? 1 : 0,
            by ?? "owner",
            id,
          );
          const row = getOne<MemoryRow>("SELECT * FROM dropwave_memories WHERE id = ?", id)!;
          syncMemoryFts(db, row);
          return rowToMemory(row);
        },
        catch: (cause) => (isDropwaveError(cause) ? cause : storageError(cause)),
      }),

    resolveMemoryReview: (id, action, by) =>
      Effect.try({
        try: () => {
          const existing = getOne<MemoryRow>("SELECT * FROM dropwave_memories WHERE id = ?", id);
          if (!existing) {
            throw new DropwaveOperationError({
              code: "not_found",
              message: `Memory "${id}" not found.`,
            });
          }
          if (existing.status !== "needs_review") {
            throw new DropwaveOperationError({
              code: "invalid_input",
              message: `Memory "${id}" is not awaiting review.`,
            });
          }
          const timestamp = nowIso();
          const conflict = parseJsonObject(existing.conflict_json ?? "");
          const conflictsWith =
            conflict && typeof conflict.with_id === "string" ? conflict.with_id : null;
          let nextStatus: string;
          if (action === "keep_old") {
            nextStatus = "archived";
          } else {
            nextStatus = "active";
            // use_new retires the memory it contradicts; keep_both leaves it.
            if (action === "use_new" && conflictsWith !== null) {
              const old = getOne<MemoryRow>(
                "SELECT * FROM dropwave_memories WHERE id = ?",
                conflictsWith,
              );
              if (old && old.authority !== "owner" && old.status === "active") {
                db.prepare(
                  `UPDATE dropwave_memories
                   SET status = 'superseded', superseded_by_id = ?, active = 0,
                       journal_json = ?, revision = revision + 1, updated_at = ?
                   WHERE id = ?`,
                ).run(
                  id,
                  appendJournal(old.journal_json, by ?? "owner", "superseded", {
                    status: old.status,
                  }),
                  timestamp,
                  old.id,
                );
                db.prepare("DELETE FROM memory_fts WHERE item_id = ?").run(old.id);
              }
            }
          }
          const journal = appendJournal(
            existing.journal_json,
            by ?? "owner",
            `review:${action}`,
            { status: existing.status },
            { status: nextStatus },
          );
          db.prepare(
            `UPDATE dropwave_memories
             SET status = ?, active = ?, conflict_json = NULL, journal_json = ?,
                 revision = revision + 1, updated_at = ?,
                 authority = CASE WHEN ? = 'owner' THEN 'owner' ELSE authority END
             WHERE id = ?`,
          ).run(nextStatus, nextStatus === "active" ? 1 : 0, journal, timestamp, by ?? "owner", id);
          const row = getOne<MemoryRow>("SELECT * FROM dropwave_memories WHERE id = ?", id)!;
          syncMemoryFts(db, row);
          return rowToMemory(row);
        },
        catch: (cause) => (isDropwaveError(cause) ? cause : storageError(cause)),
      }),

    addMemoryRelation: (input) =>
      Effect.try({
        try: () => {
          if (input.sourceId === input.targetId) {
            throw new DropwaveOperationError({
              code: "invalid_input",
              message: "A memory cannot relate to itself.",
            });
          }
          for (const id of [input.sourceId, input.targetId]) {
            const exists = getOne<{ id: string }>(
              "SELECT id FROM dropwave_memories WHERE id = ?",
              id,
            );
            if (!exists) {
              throw new DropwaveOperationError({
                code: "not_found",
                message: `Memory "${id}" not found.`,
              });
            }
          }
          const id = makeId("mrel");
          db.prepare(
            `INSERT INTO memory_relations
              (id, source_id, target_id, type, confidence, origin, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (source_id, target_id, type) DO UPDATE SET
               confidence = excluded.confidence, origin = excluded.origin`,
          ).run(
            id,
            input.sourceId,
            input.targetId,
            input.type,
            Math.min(Math.max(input.confidence ?? 1, 0), 1),
            input.origin ?? "agent",
            nowIso(),
          );
          const row = getOne<{ id: string }>(
            "SELECT id FROM memory_relations WHERE source_id = ? AND target_id = ? AND type = ?",
            input.sourceId,
            input.targetId,
            input.type,
          );
          return { id: row?.id ?? id };
        },
        catch: (cause) => (isDropwaveError(cause) ? cause : storageError(cause)),
      }),

    listMemoryRelations: (memoryId) =>
      Effect.try({
        try: () =>
          getAll<{
            id: string;
            source_id: string;
            target_id: string;
            type: string;
            confidence: number;
            origin: string;
          }>(
            `SELECT * FROM memory_relations
             WHERE source_id = ? OR target_id = ?
             ORDER BY created_at DESC`,
            memoryId,
            memoryId,
          ).map((row) => ({
            id: row.id,
            sourceId: row.source_id,
            targetId: row.target_id,
            type: row.type,
            confidence: row.confidence,
            origin: row.origin,
          })),
        catch: storageError,
      }),

    removeMemoryRelation: (relationId) =>
      Effect.try({
        try: () => {
          const res = db.prepare("DELETE FROM memory_relations WHERE id = ?").run(relationId);
          return Number(res.changes) > 0;
        },
        catch: storageError,
      }),

    stampMemoryRecall: (itemIds) =>
      Effect.try({
        try: () => {
          if (itemIds.length === 0) return;
          const timestamp = nowIso();
          const stmt = db.prepare(
            `INSERT INTO memory_recall_stamps (item_id, last_recalled_at, recall_count)
             VALUES (?, ?, 1)
             ON CONFLICT (item_id) DO UPDATE SET
               last_recalled_at = excluded.last_recalled_at,
               recall_count = recall_count + 1`,
          );
          for (const itemId of itemIds) stmt.run(itemId, timestamp);
        },
        catch: storageError,
      }),

    getShownMemoryIds: (threadId) =>
      Effect.try({
        try: () =>
          getAll<{ item_id: string }>(
            "SELECT item_id FROM memory_shown WHERE thread_id = ?",
            threadId,
          ).map((row) => row.item_id),
        catch: storageError,
      }),

    markMemoriesShown: (threadId, itemIds) =>
      Effect.try({
        try: () => {
          if (itemIds.length === 0) return;
          const timestamp = nowIso();
          const stmt = db.prepare(
            `INSERT INTO memory_shown (thread_id, item_id, shown_at)
             VALUES (?, ?, ?)
             ON CONFLICT (thread_id, item_id) DO NOTHING`,
          );
          for (const itemId of itemIds) stmt.run(threadId, itemId, timestamp);
        },
        catch: storageError,
      }),

    recordRecallTrace: (input) =>
      Effect.try({
        try: () => {
          const timestamp = nowIso();
          db.prepare(
            `INSERT INTO memory_recall_traces (id, thread_id, turn_key, created_at, trace_json)
             VALUES (?, ?, ?, ?, ?)`,
          ).run(
            makeId("mtrace"),
            input.threadId,
            input.turnKey,
            timestamp,
            JSON.stringify(input.trace),
          );
          // Retain the last 50 turns per thread.
          db.prepare(
            `DELETE FROM memory_recall_traces WHERE thread_id = ? AND id NOT IN (
               SELECT id FROM memory_recall_traces WHERE thread_id = ?
               ORDER BY created_at DESC LIMIT 50
             )`,
          ).run(input.threadId, input.threadId);
        },
        catch: storageError,
      }),

    listRecallTraces: (threadId, limit) =>
      Effect.try({
        try: () =>
          getAll<{ id: string; turn_key: string; created_at: string; trace_json: string }>(
            `SELECT id, turn_key, created_at, trace_json FROM memory_recall_traces
             WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?`,
            threadId,
            Math.min(Math.max(limit ?? 10, 1), 50),
          ).map((row) => ({
            id: row.id,
            turnKey: row.turn_key,
            createdAt: row.created_at,
            trace: parseJsonObject(row.trace_json),
          })),
        catch: storageError,
      }),

    getMemoryRejection: (hash) =>
      Effect.try({
        try: () => {
          const row = getOne<{ verdict_json: string }>(
            "SELECT verdict_json FROM memory_rejections WHERE hash = ? AND expires_at > ?",
            hash,
            nowIso(),
          );
          return row ? parseJsonObject(row.verdict_json) : undefined;
        },
        catch: storageError,
      }),

    putMemoryRejection: (input) =>
      Effect.try({
        try: () => {
          const ttlDays = input.ttlDays ?? 30;
          const expires = DateTime.formatIso(DateTime.add(DateTime.nowUnsafe(), { days: ttlDays }));
          db.prepare(
            `INSERT INTO memory_rejections (hash, verdict_json, created_at, expires_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (hash) DO UPDATE SET
               verdict_json = excluded.verdict_json,
               created_at = excluded.created_at,
               expires_at = excluded.expires_at`,
          ).run(input.hash, JSON.stringify(input.verdict), nowIso(), expires);
        },
        catch: storageError,
      }),

    getMemoryVectors: (itemIds, modelId) =>
      Effect.try({
        try: () => {
          const result = new Map<
            string,
            { dim: number; vector: Float32Array; contentHash: string }
          >();
          if (itemIds.length === 0) return result;
          const placeholders = itemIds.map(() => "?").join(",");
          const rows = getAll<{
            item_id: string;
            dim: number;
            vector: Uint8Array;
            content_hash: string;
          }>(
            `SELECT item_id, dim, vector, content_hash FROM memory_vectors
             WHERE model_id = ? AND item_id IN (${placeholders})`,
            modelId,
            ...itemIds,
          );
          for (const row of rows) {
            const bytes = new Uint8Array(row.dim * 4);
            bytes.set(row.vector.subarray(0, row.dim * 4));
            result.set(row.item_id, {
              dim: row.dim,
              vector: new Float32Array(bytes.buffer),
              contentHash: row.content_hash,
            });
          }
          return result;
        },
        catch: storageError,
      }),

    putMemoryVector: (input) =>
      Effect.try({
        try: () => {
          const bytes = new Uint8Array(input.dim * 4);
          new Float32Array(bytes.buffer).set(input.vector.subarray(0, input.dim));
          db.prepare(
            `INSERT INTO memory_vectors (item_id, model_id, dim, vector, content_hash, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (item_id, model_id) DO UPDATE SET
               dim = excluded.dim, vector = excluded.vector,
               content_hash = excluded.content_hash, updated_at = excluded.updated_at`,
          ).run(input.itemId, input.modelId, input.dim, bytes, input.contentHash, nowIso());
        },
        catch: storageError,
      }),

    deleteMemoryVector: (itemId, modelId) =>
      Effect.try({
        try: () => {
          if (modelId === undefined) {
            db.prepare("DELETE FROM memory_vectors WHERE item_id = ?").run(itemId);
          } else {
            db.prepare("DELETE FROM memory_vectors WHERE item_id = ? AND model_id = ?").run(
              itemId,
              modelId,
            );
          }
        },
        catch: storageError,
      }),

    getMemoryMeta: (key) =>
      Effect.try({
        try: () => {
          const row = getOne<{ value_json: string }>(
            "SELECT value_json FROM dropwave_supervisor_kv WHERE key = ?",
            `memory:${key}`,
          );
          return row ? parseJsonObject(row.value_json) : undefined;
        },
        catch: storageError,
      }),

    setMemoryMeta: (key, value) =>
      Effect.try({
        try: () => {
          db.prepare(
            `INSERT INTO dropwave_supervisor_kv (key, value_json, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
          ).run(`memory:${key}`, JSON.stringify(value), nowIso());
        },
        catch: storageError,
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

    deletePersona: (id) =>
      Effect.try({
        try: () => {
          const result = db.prepare("DELETE FROM dropwave_personas WHERE id = ?").run(id);
          return result.changes > 0;
        },
        catch: storageError,
      }),

    saveHabitSummary: (input) =>
      Effect.try({
        try: () => {
          const now = nowIso();
          db.prepare(
            `INSERT INTO dropwave_habit_summaries (task_id, prompt_hash, project_id, summary, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(task_id, prompt_hash) DO UPDATE SET
               project_id = excluded.project_id,
               summary = excluded.summary,
               updated_at = excluded.updated_at`,
          ).run(input.taskId, input.promptHash, input.projectId, input.summary, now, now);
        },
        catch: storageError,
      }),

    listHabitSummaries: (input) =>
      Effect.try({
        try: () => {
          const rows = db
            .prepare(
              `SELECT task_id, summary, updated_at FROM dropwave_habit_summaries
               WHERE project_id = ? ORDER BY updated_at DESC`,
            )
            .all(input.projectId) as Array<{
            task_id: string;
            summary: string;
            updated_at: string;
          }>;
          const seen = new Set<string>();
          const items: Array<DropwaveHabitSummaryItem> = [];
          for (const row of rows) {
            if (seen.has(row.task_id)) continue;
            seen.add(row.task_id);
            items.push({
              taskId: row.task_id,
              summary: row.summary,
              updatedAt: asIsoDateTime(row.updated_at),
            });
          }
          return items;
        },
        catch: storageError,
      }),

    deleteProjectData: (input) =>
      Effect.try({
        try: () => {
          db.exec("BEGIN IMMEDIATE");
          try {
            const asks = Number(
              db.prepare("DELETE FROM dropwave_asks WHERE project_id = ?").run(input.projectId)
                .changes,
            );
            const counters = Number(
              db
                .prepare("DELETE FROM dropwave_ask_counters WHERE project_id = ?")
                .run(input.projectId).changes,
            );
            const memories = Number(
              db
                .prepare("DELETE FROM dropwave_memories WHERE project_id = ? AND scope = 'project'")
                .run(input.projectId).changes,
            );
            const habitSummaries = Number(
              db
                .prepare("DELETE FROM dropwave_habit_summaries WHERE project_id = ?")
                .run(input.projectId).changes,
            );
            let summaryNodes = 0;
            if (input.threadIds.length > 0) {
              const placeholders = input.threadIds.map(() => "?").join(", ");
              summaryNodes = Number(
                db
                  .prepare(
                    `DELETE FROM dropwave_summary_nodes WHERE thread_id IN (${placeholders})`,
                  )
                  .run(...input.threadIds).changes,
              );
            }
            db.exec("COMMIT");
            return { asks, counters, memories, summaryNodes, habitSummaries };
          } catch (error) {
            try {
              db.exec("ROLLBACK");
            } catch {
              // ignore rollback errors
            }
            throw error;
          }
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
