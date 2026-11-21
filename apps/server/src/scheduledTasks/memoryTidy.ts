// Memory v2 dream scheduling (design §5): a built-in system habit that runs the
// nightly tidy through ScheduledTaskService. The task row is what makes the tidy
// visible and pausable in Habits; runTask intercepts it and runs the dream
// directly instead of dispatching a prompt to a thread.
import {
  ScheduledTaskId,
  type ModelSelection,
  type ProjectId,
  type ScheduledTaskUpsertInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";

import type { DropwaveStoreShape } from "../dropwave/DropwaveStore.ts";
import { runMemoryDream, type DreamResult } from "../dropwave/memoryDream.ts";
import type * as ServerSettings from "../serverSettings.ts";
import type * as TextGeneration from "../textGeneration/TextGeneration.ts";

export const MEMORY_TIDY_TASK_ID = ScheduledTaskId.make("scheduled-task:memory-tidy");

export const isMemoryTidyTaskId = (id: string): boolean => id === MEMORY_TIDY_TASK_ID;

const EMPTY_DREAM: Omit<DreamResult, "reason"> = {
  ran: false,
  merged: 0,
  enriched: 0,
  relationsDecayed: 0,
  relationsPruned: 0,
  summary: "",
};

export function memoryTidyUpsertInput(input: {
  readonly projectId: ProjectId;
  readonly modelSelection: ModelSelection;
}): ScheduledTaskUpsertInput {
  return {
    id: MEMORY_TIDY_TASK_ID,
    title: "Memory tidy",
    prompt:
      "Tidy Dropwave memory: merge duplicate memories, fill thin ones from their evidence, and prune stale links. Runs locally overnight; nothing is posted to chat.",
    enabled: true,
    schedule: { type: "fixed_time", timeOfDay: "03:00" },
    projectId: input.projectId,
    threadMode: "new_thread",
    workspaceStrategy: { type: "root" },
    modelSelection: input.modelSelection,
    // The tidy never launches a provider thread; the lowest mode also keeps the
    // save acceptable under the strictest managed runtime policy.
    runtimeMode: "approval-required",
    interactionMode: "default",
    createdBy: "system",
    creationSource: "server",
  };
}

/**
 * Idle gate: any live orchestration run means a turn is in flight. A failed read
 * counts as busy so an uncertain state never tidies mid-turn.
 */
export const orchestrationRunInFlight = (
  sql: SqlClient.SqlClient,
): Effect.Effect<boolean, never, never> =>
  sql<{ readonly active: number }>`
    SELECT EXISTS (
      SELECT 1 FROM orchestration_v2_projection_runs
      WHERE status IN ('queued', 'preparing', 'starting', 'running', 'waiting')
    ) AS active
  `.pipe(
    Effect.map((rows) => rows[0]?.active === 1),
    Effect.catch((cause) =>
      Effect.logWarning("memory tidy could not check for active runs", { cause }).pipe(
        Effect.as(true),
      ),
    ),
  );

/**
 * One scheduled tidy: skip while a turn is in flight, then run the dream. The
 * dream itself gates on the active-item floor and never fails the run.
 */
export const runMemoryTidy = Effect.fnUntraced(function* (input: {
  readonly sql: SqlClient.SqlClient;
  readonly store: Option.Option<DropwaveStoreShape>;
  readonly textGeneration: Option.Option<TextGeneration.TextGeneration["Service"]>;
  readonly serverSettings: Option.Option<ServerSettings.ServerSettingsService["Service"]>;
  readonly projectId: ProjectId;
  readonly workspaceRoot: string;
}): Effect.fn.Return<DreamResult, never, never> {
  if (Option.isNone(input.store)) {
    return { ...EMPTY_DREAM, reason: "memory store unavailable" };
  }
  if (yield* orchestrationRunInFlight(input.sql)) {
    return { ...EMPTY_DREAM, reason: "a turn is in flight" };
  }
  return yield* runMemoryDream({
    store: input.store.value,
    textGeneration: Option.isSome(input.textGeneration) ? input.textGeneration.value : undefined,
    serverSettings: Option.isSome(input.serverSettings) ? input.serverSettings.value : undefined,
    projectId: input.projectId,
    workspaceRoot: input.workspaceRoot,
  });
});
