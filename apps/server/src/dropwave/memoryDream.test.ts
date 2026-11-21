import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
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

const dreamSettingsLayer = ServerSettings.ServerSettingsService.layerTest({
  defaultModelSelection: {
    instanceId: ProviderInstanceId.make("test-provider"),
    model: "test-model",
  },
});

it.effect("runMemoryDream enforces the 20 percent change cap across merge groups", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    const save = (subject: string, text: string) =>
      store.saveMemory({
        projectId,
        botThreadId: threadId,
        scope: "owner",
        kind: "preference",
        subject,
        text,
      });
    // Two duplicate groups of 3 plus 14 fillers = 20 items, cap = 4 changes.
    // Distinct texts on the same subject need the model merge verdict.
    const textsA = [
      "The owner reviews every pull request before it merges.",
      "Pull requests get a careful owner review pre-merge.",
      "Owner sign-off on pull requests happens before merging.",
    ];
    const textsB = [
      "Feature branches get squashed on a weekly cadence.",
      "The owner squashes feature branches every week.",
      "Weekly squash merges keep feature branches tidy.",
    ];
    for (let index = 0; index < 3; index += 1) {
      yield* save("CapA", textsA[index]!);
      yield* save("CapB", textsB[index]!);
    }
    for (let index = 0; index < 14; index += 1) {
      yield* save(`Filler ${index}`, `Filler memory number ${index} about workspace ${index}.`);
    }
    const textGeneration = yield* TextGeneration.TextGeneration.pipe(
      Effect.provide(
        Layer.mock(TextGeneration.TextGeneration)({
          generateTranscriptionPostProcessing: () =>
            Effect.succeed({
              transcription: '{"merge":true,"text":"Merged duplicate preference."}',
            } as never),
        }),
      ),
    );
    const serverSettings = yield* ServerSettings.ServerSettingsService.pipe(
      Effect.provide(dreamSettingsLayer),
    );
    const result = yield* MemoryDream.runMemoryDream({
      store,
      textGeneration,
      serverSettings,
      projectId,
      workspaceRoot: "/tmp",
    });
    expect(result.ran).toBe(true);
    expect(result.merged).toBe(2);
    const items = yield* store.listDreamMemoryItems();
    const activeA = items.filter((item) => item.subject === "CapA" && item.status === "active");
    const activeB = items.filter((item) => item.subject === "CapB" && item.status === "active");
    // Exactly one group merged (2 losers superseded); the other stayed intact.
    expect([activeA.length, activeB.length].sort()).toEqual([1, 3]);
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);

it.effect("runMemoryDream caches merge rejections and does not re-ask the model", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    let calls = 0;
    const countingLayer = Layer.mock(TextGeneration.TextGeneration)({
      generateTranscriptionPostProcessing: () =>
        Effect.sync(() => {
          calls += 1;
          return { transcription: '{"merge":false,"reason":"different facts"}' } as never;
        }),
    });
    const textGeneration = yield* TextGeneration.TextGeneration.pipe(Effect.provide(countingLayer));
    const serverSettings = yield* ServerSettings.ServerSettingsService.pipe(
      Effect.provide(dreamSettingsLayer),
    );
    const save = (subject: string, text: string) =>
      store.saveMemory({
        projectId,
        botThreadId: threadId,
        scope: "owner",
        kind: "fact",
        subject,
        text,
      });
    yield* save("Deploys", "Deploys run every Tuesday at 9am.");
    yield* save("Deploys", "Deploys are frozen during the holiday code freeze window.");
    for (let index = 0; index < 18; index += 1) {
      yield* save(`Solo ${index}`, `Unique solo memory ${index} about topic ${index}.`);
    }
    const first = yield* MemoryDream.runMemoryDream({
      store,
      textGeneration,
      serverSettings,
      projectId,
      workspaceRoot: "/tmp",
    });
    const second = yield* MemoryDream.runMemoryDream({
      store,
      textGeneration,
      serverSettings,
      projectId,
      workspaceRoot: "/tmp",
    });
    expect(calls).toBe(1);
    expect(first.merged).toBe(0);
    expect(second.merged).toBe(0);
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);
