import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import * as DropwaveStore from "../dropwave/DropwaveStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as MemoryTidy from "./memoryTidy.ts";

const projectId = ProjectId.make("project:tidy-test");
const threadId = ThreadId.make("thread:tidy-test");

const insertRun = (
  sql: SqlClient.SqlClient,
  input: { readonly id: string; readonly status: string; readonly ordinal: number },
) =>
  sql`INSERT INTO orchestration_v2_projection_runs ${sql.insert({
    run_id: input.id,
    thread_id: threadId,
    ordinal: input.ordinal,
    provider: "codex",
    status: input.status,
    requested_at: "2026-01-01T00:00:00.000Z",
    payload_json: "{}",
  })}`;

it("memoryTidyUpsertInput registers a 03:00 system habit", () => {
  const input = MemoryTidy.memoryTidyUpsertInput({
    projectId,
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5",
    },
  });
  expect(input.id).toBe(MemoryTidy.MEMORY_TIDY_TASK_ID);
  expect(input.schedule).toEqual({ type: "fixed_time", timeOfDay: "03:00" });
  expect(input.createdBy).toBe("system");
  expect(input.creationSource).toBe("server");
  expect(input.threadMode).toBe("new_thread");
  expect(input.enabled).toBe(true);
});

it.effect("orchestrationRunInFlight is false on an empty projection", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    expect(yield* MemoryTidy.orchestrationRunInFlight(sql)).toBe(false);
    yield* insertRun(sql, { id: "run-settled", status: "completed", ordinal: 1 });
    expect(yield* MemoryTidy.orchestrationRunInFlight(sql)).toBe(false);
    yield* insertRun(sql, { id: "run-live", status: "running", ordinal: 2 });
    expect(yield* MemoryTidy.orchestrationRunInFlight(sql)).toBe(true);
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("runMemoryTidy skips without a store and while a turn is in flight", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const noStore = yield* MemoryTidy.runMemoryTidy({
      sql,
      store: Option.none(),
      textGeneration: Option.none(),
      serverSettings: Option.none(),
      projectId,
      workspaceRoot: "/tmp",
    });
    expect(noStore.ran).toBe(false);
    expect(noStore.reason).toBe("memory store unavailable");

    const store = yield* DropwaveStore.DropwaveStore;
    for (let index = 0; index < 20; index += 1) {
      yield* store.saveMemory({
        projectId,
        botThreadId: threadId,
        scope: "owner",
        kind: "fact",
        subject: `Busy ${index}`,
        text: `A distinct memory number ${index} about its own topic.`,
      });
    }
    yield* insertRun(sql, { id: "run-blocking", status: "running", ordinal: 1 });
    const busy = yield* MemoryTidy.runMemoryTidy({
      sql,
      store: Option.some(store),
      textGeneration: Option.none(),
      serverSettings: Option.none(),
      projectId,
      workspaceRoot: "/tmp",
    });
    expect(busy.ran).toBe(false);
    expect(busy.reason).toBe("a turn is in flight");
  }).pipe(Effect.provide(Layer.mergeAll(SqlitePersistence.layerMemory, DropwaveStore.layerMemory))),
);

it.effect("runMemoryTidy runs the dream when idle with enough memories", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const store = yield* DropwaveStore.DropwaveStore;
    for (let index = 0; index < 20; index += 1) {
      yield* store.saveMemory({
        projectId,
        botThreadId: threadId,
        scope: "owner",
        kind: "fact",
        subject: `Pool ${index}`,
        text: `A distinct memory number ${index} about its own topic.`,
      });
    }
    const result = yield* MemoryTidy.runMemoryTidy({
      sql,
      store: Option.some(store),
      textGeneration: Option.none(),
      serverSettings: Option.none(),
      projectId,
      workspaceRoot: "/tmp",
    });
    expect(result.ran).toBe(true);
    const meta = yield* store.getMemoryMeta("dream:last");
    expect(typeof meta).toBe("object");
    expect(typeof (meta as { at?: unknown }).at).toBe("string");
    expect(typeof (meta as { summary?: unknown }).summary).toBe("string");
  }).pipe(Effect.provide(Layer.mergeAll(SqlitePersistence.layerMemory, DropwaveStore.layerMemory))),
);
