// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { expect, it } from "@effect/vitest";

import { initializeDropwaveSchema } from "./DropwaveStore.ts";

// The pre-v2 dropwave_memories shape: base columns plus the scope/persona_id
// ALTERs the old initializer applied.
const LEGACY_MEMORIES_DDL = `
  CREATE TABLE dropwave_memories (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    bot_thread_id TEXT,
    scope TEXT NOT NULL DEFAULT 'project',
    persona_id TEXT,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    quote TEXT,
    source_message_id TEXT,
    confidence TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

function withLegacyDb(run: (db: NodeSqlite.DatabaseSync) => void): void {
  const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "dw-mem-migrate-"));
  try {
    const db = new NodeSqlite.DatabaseSync(NodePath.join(dir, "dropwave.sqlite"));
    try {
      db.exec(LEGACY_MEMORIES_DDL);
      db.prepare(
        `INSERT INTO dropwave_memories
          (id, project_id, bot_thread_id, scope, persona_id, kind, text, quote,
           source_message_id, confidence, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "mem-project",
        "project:alpha",
        "thread:lead",
        "project",
        null,
        "rule",
        "Always run pnpm test before shipping",
        "always run pnpm test",
        "msg-1",
        "confirmed",
        1,
        "2026-11-01T00:00:00.000Z",
        "2026-11-02T00:00:00.000Z",
      );
      db.prepare(
        `INSERT INTO dropwave_memories
          (id, project_id, bot_thread_id, scope, persona_id, kind, text, quote,
           source_message_id, confidence, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "mem-owner",
        "project:alpha",
        null,
        "global",
        null,
        "fact",
        "Owner's name is Ash",
        null,
        null,
        "learned",
        1,
        "2026-11-01T00:00:00.000Z",
        "2026-11-02T00:00:00.000Z",
      );
      db.prepare(
        `INSERT INTO dropwave_memories
          (id, project_id, bot_thread_id, scope, persona_id, kind, text, quote,
           source_message_id, confidence, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "mem-bot",
        "project:alpha",
        null,
        "global",
        "persona-1",
        "lesson",
        "I keep reports short",
        null,
        null,
        "bogus-confidence",
        0,
        "2026-11-01T00:00:00.000Z",
        "2026-11-02T00:00:00.000Z",
      );
      initializeDropwaveSchema(db);
      run(db);
    } finally {
      db.close();
    }
  } finally {
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }
}

it("migrates legacy memories to Memory v2 scopes, statuses and evidence without loss", () => {
  withLegacyDb((db) => {
    const rows = db
      .prepare(
        `SELECT id, scope, persona_id, project_id, kind, subject, tier, status,
                authority, confidence, evidence_json, quote, journal_json, revision,
                active
         FROM dropwave_memories ORDER BY id`,
      )
      .all() as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    const byId = new Map(rows.map((row) => [row.id as string, row]));

    const project = byId.get("mem-project")!;
    expect(project.scope).toBe("project");
    expect(project.project_id).toBe("project:alpha");
    expect(project.status).toBe("active");
    expect(project.tier).toBe("semantic");
    expect(project.authority).toBe("agent");
    expect(project.revision).toBe(1);
    // The legacy quote becomes the first evidence record.
    const evidence = JSON.parse(project.evidence_json as string) as Array<{
      quote: string;
      source_message_id?: string;
    }>;
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.quote).toBe("always run pnpm test");
    expect(evidence[0]!.source_message_id).toBe("msg-1");
    expect(project.quote).toBe("always run pnpm test");

    const owner = byId.get("mem-owner")!;
    expect(owner.scope).toBe("owner");
    expect(owner.project_id).toBeNull();
    expect(owner.persona_id).toBeNull();
    expect(owner.status).toBe("active");

    const bot = byId.get("mem-bot")!;
    expect(bot.scope).toBe("bot");
    expect(bot.persona_id).toBe("persona-1");
    expect(bot.project_id).toBeNull();
    // inactive legacy rows become archived; unknown confidence becomes mentioned.
    expect(bot.status).toBe("archived");
    expect(bot.active).toBe(0);
    expect(bot.confidence).toBe("mentioned");
  });
});

it("is idempotent and backfills the FTS index once", () => {
  withLegacyDb((db) => {
    // Second init on the migrated DB must not duplicate FTS rows or re-migrate.
    initializeDropwaveSchema(db);
    const fts = db.prepare("SELECT COUNT(*) AS n FROM memory_fts").get() as { n: number };
    const memories = db.prepare("SELECT COUNT(*) AS n FROM dropwave_memories").get() as {
      n: number;
    };
    // The archived row is not FTS-indexed; the two live rows are indexed once.
    expect(fts.n).toBe(2);
    expect(memories.n).toBe(3);
    const scopes = db
      .prepare("SELECT DISTINCT scope FROM dropwave_memories ORDER BY scope")
      .all() as Array<{ scope: string }>;
    expect(scopes.map((row) => row.scope)).toEqual(["bot", "owner", "project"]);
  });
});
