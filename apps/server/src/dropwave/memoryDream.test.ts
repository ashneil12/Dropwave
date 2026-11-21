import { ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as DropwaveStore from "./DropwaveStore.ts";
import * as MemoryDream from "./memoryDream.ts";

const projectId = ProjectId.make("project:dream-test");
const threadId = ThreadId.make("thread:dream-test");

it("dreamMergeGroups groups same scope+kind+subject duplicates only", () => {
  const base = {
    id: "m1",
    projectId,
    botThreadId: threadId,
    scope: "owner" as const,
    personaId: null,
    kind: "preference" as const,
    subject: "Tone",
    text: "Be brief.",
    aliases: [],
    tags: [],
    tier: "semantic" as const,
    status: "active" as const,
    authority: "agent" as const,
    evidence: [],
    journal: [],
    revision: 1,
    confidence: "learned" as const,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  const groups = MemoryDream.dreamMergeGroups([
    base,
    { ...base, id: "m2" },
    { ...base, id: "m3", subject: "Other" },
    { ...base, id: "m4", scope: "project" as const },
    { ...base, id: "m5", subject: "" },
  ]);
  expect(groups).toHaveLength(1);
  expect(groups[0]!.map((item) => item.id).sort()).toEqual(["m1", "m2"]);
});

it.effect("runMemoryDream skips below the minimum pool", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    yield* store.saveMemory({
      projectId,
      botThreadId: threadId,
      scope: "owner",
      kind: "fact",
      subject: "Solo",
      text: "Only one memory exists.",
    });
    const result = yield* MemoryDream.runMemoryDream({
      store,
      textGeneration: undefined,
      serverSettings: undefined,
      workspaceRoot: "/tmp",
    });
    expect(result.ran).toBe(false);
    expect(result.summary).toBe("");
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);
