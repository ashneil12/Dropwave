import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as DropwaveStore from "./DropwaveStore.ts";
import type { MemoryEmbeddingsShape } from "./memoryEmbeddings.ts";
import { saveMemoryMerged, updateMemoryMerged } from "./memoryDedupe.ts";

const projectId = ProjectId.make("project:dedupe-test");
const threadId = ThreadId.make("thread:dedupe-test");

const baseInput = {
  projectId,
  botThreadId: threadId,
  scope: "project" as const,
  kind: "preference" as const,
  threadId,
};

const readyEmbeddings = (vector: (text: string) => Float32Array): MemoryEmbeddingsShape => ({
  status: Effect.succeed({
    state: "ready",
    modelId: "test-model",
    dim: 3,
    enabled: true,
  }),
  setEnabled: () => Effect.void,
  embed: (texts) => Effect.succeed(texts.map((text) => vector(text))),
});

const noEmbeddings: MemoryEmbeddingsShape = {
  status: Effect.succeed({ state: "disabled", modelId: "", dim: 0, enabled: false }),
  setEnabled: () => Effect.void,
  embed: () => Effect.succeed([]),
};

const sameVector = readyEmbeddings(() => new Float32Array([1, 0, 0]));
const splitVector = readyEmbeddings((text) =>
  text.includes("deploy") ? new Float32Array([1, 0, 0]) : new Float32Array([0, 1, 0]),
);

const tgLayer = (transcription: string) =>
  Layer.mock(TextGeneration.TextGeneration)({
    generateTranscriptionPostProcessing: () => Effect.succeed({ transcription } as never),
  });

const settingsLayer = ServerSettings.ServerSettingsService.layerTest({
  defaultModelSelection: {
    instanceId: ProviderInstanceId.make("test-provider"),
    model: "test-model",
  },
});

it.effect("exact duplicate touches evidence instead of writing a second row", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    const first = yield* store.saveMemory({
      ...baseInput,
      subject: "Update style",
      text: "The owner prefers concise bullet-point status updates.",
      quote: "keep updates short",
    });
    const second = yield* saveMemoryMerged({
      store,
      embeddings: noEmbeddings,
      ...baseInput,
      subject: "Update style",
      text: "The owner prefers concise bullet-point status updates.",
      quote: "short updates please",
      sourceMessageId: "msg-2",
    });
    expect(second.id).toBe(first.id);
    const all = yield* store.listMemories({ projectId, limit: 50 });
    expect(all.filter((item) => item.subject === "Update style")).toHaveLength(1);
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);

it.effect("subject/alias match routes to the merge verdict when wording differs", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    const first = yield* store.saveMemory({
      ...baseInput,
      subject: "Deploy window",
      text: "Deploys happen on weekday mornings only.",
    });
    const textGeneration = yield* TextGeneration.TextGeneration.pipe(
      Effect.provide(
        tgLayer(
          '{"contradicts":false,"merged":"Deploys happen on weekday mornings, Tuesday through Thursday."}',
        ),
      ),
    );
    const serverSettings = yield* ServerSettings.ServerSettingsService.pipe(
      Effect.provide(settingsLayer),
    );
    const merged = yield* saveMemoryMerged({
      store,
      embeddings: noEmbeddings,
      textGeneration,
      serverSettings,
      workspaceRoot: "/tmp",
      ...baseInput,
      subject: "deploy window",
      text: "Ship fixes Tuesday through Thursday before noon.",
      aliases: ["release window"],
    });
    expect(merged.id).toBe(first.id);
    expect(merged.text).toContain("Tuesday through Thursday");
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);

it.effect("high vector similarity merges text through the conflict prompt", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    const first = yield* store.saveMemory({
      ...baseInput,
      kind: "rule",
      subject: "Commits",
      text: "Commit work with clear conventional messages.",
    });
    const textGeneration = yield* TextGeneration.TextGeneration.pipe(
      Effect.provide(
        tgLayer(
          '{"contradicts":false,"merged":"Commit work with clear conventional messages, signed off."}',
        ),
      ),
    );
    const serverSettings = yield* ServerSettings.ServerSettingsService.pipe(
      Effect.provide(settingsLayer),
    );
    const merged = yield* saveMemoryMerged({
      store,
      embeddings: sameVector,
      textGeneration,
      serverSettings,
      workspaceRoot: "/tmp",
      ...baseInput,
      kind: "rule",
      subject: "Commits",
      text: "Always sign off commits before pushing them upstream.",
    });
    expect(merged.id).toBe(first.id);
    expect(merged.text).toContain("signed off");
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);

it.effect("new text contained in old text only touches evidence", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    const longText =
      "The owner prefers concise bullet-point status updates with file links and exact check results every single time.";
    const first = yield* store.saveMemory({
      ...baseInput,
      subject: "Update style",
      text: longText,
    });
    const result = yield* saveMemoryMerged({
      store,
      embeddings: noEmbeddings,
      ...baseInput,
      subject: "Update style",
      text: "concise bullet-point status updates",
      quote: "keep updates short",
      sourceMessageId: "msg-9",
    });
    expect(result.id).toBe(first.id);
    expect(result.text).toBe(longText);
    expect(result.evidence.length).toBeGreaterThan(0);
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);

it.effect("old text contained in new text replaces it and journals the change", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    const first = yield* store.saveMemory({
      ...baseInput,
      subject: "Standup",
      text: "The team syncs every weekday morning.",
    });
    const result = yield* saveMemoryMerged({
      store,
      embeddings: noEmbeddings,
      ...baseInput,
      subject: "Standup",
      text: "The team syncs every weekday morning at 9:30 sharp in the main channel.",
    });
    expect(result.id).toBe(first.id);
    expect(result.text).toContain("9:30 sharp");
    expect(result.journal.length).toBeGreaterThan(0);
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);

it.effect("conflict verdict parks the old item as needs_review with the candidate", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    const first = yield* store.saveMemory({
      ...baseInput,
      kind: "decision",
      subject: "Database",
      text: "Use SQLite for all local persistence in this project.",
    });
    const textGeneration = yield* TextGeneration.TextGeneration.pipe(
      Effect.provide(
        tgLayer('{"contradicts":true,"reason":"Owner now wants Postgres for writes."}'),
      ),
    );
    const serverSettings = yield* ServerSettings.ServerSettingsService.pipe(
      Effect.provide(settingsLayer),
    );
    const result = yield* saveMemoryMerged({
      store,
      embeddings: sameVector,
      textGeneration,
      serverSettings,
      workspaceRoot: "/tmp",
      ...baseInput,
      kind: "decision",
      subject: "Database",
      text: "Switch all persistence to Postgres for this project.",
    });
    expect(result.id).toBe(first.id);
    const parked = yield* store.getMemory(first.id);
    expect(parked?.status).toBe("needs_review");
    expect(parked?.conflict?.candidate).toContain("Postgres");
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);

it.effect(
  "owner-authority conflicts create a linked candidate and never touch the owner item",
  () =>
    Effect.gen(function* () {
      const store = yield* DropwaveStore.DropwaveStore;
      const ownerItem = yield* store.saveMemory({
        ...baseInput,
        scope: "owner",
        kind: "rule",
        subject: "Tone",
        text: "Always answer in British English spelling.",
        authority: "owner",
      });
      const textGeneration = yield* TextGeneration.TextGeneration.pipe(
        Effect.provide(tgLayer('{"contradicts":true,"reason":"New spelling preference."}')),
      );
      const serverSettings = yield* ServerSettings.ServerSettingsService.pipe(
        Effect.provide(settingsLayer),
      );
      const candidate = yield* saveMemoryMerged({
        store,
        embeddings: sameVector,
        textGeneration,
        serverSettings,
        workspaceRoot: "/tmp",
        ...baseInput,
        scope: "owner",
        kind: "rule",
        subject: "Tone",
        text: "Switch to American English spelling everywhere.",
      });
      expect(candidate.id).not.toBe(ownerItem.id);
      const parkedCandidate = yield* store.getMemory(candidate.id);
      expect(parkedCandidate?.status).toBe("needs_review");
      const ownerAfter = yield* store.getMemory(ownerItem.id);
      expect(ownerAfter?.text).toBe("Always answer in British English spelling.");
      expect(ownerAfter?.status).toBe("active");
      const relations = yield* store.listMemoryRelations(candidate.id);
      expect(relations.some((relation) => relation.type === "contradicts")).toBe(true);
    }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);

it.effect("dissimilar candidates still save as a new row", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    yield* store.saveMemory({
      ...baseInput,
      subject: "Deploys",
      text: "Deploy the service every Tuesday morning.",
    });
    const created = yield* saveMemoryMerged({
      store,
      embeddings: splitVector,
      ...baseInput,
      subject: "Coffee",
      text: "The owner drinks pour-over coffee before standup.",
    });
    expect(created.subject).toBe("Coffee");
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);

it.effect("withTransaction rolls back every write when the effect fails", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    const before = yield* store.listMemories({ projectId, limit: 50 });
    yield* store
      .withTransaction(
        Effect.gen(function* () {
          yield* store.saveMemory({
            ...baseInput,
            subject: "Rollback",
            text: "This row must not survive the failed transaction.",
          });
          return yield* Effect.fail({
            _tag: "TestRollback" as const,
            message: "boom",
          });
        }),
      )
      .pipe(Effect.ignore);
    const after = yield* store.listMemories({ projectId, limit: 50 });
    expect(after.length).toBe(before.length);
    expect(after.some((item) => item.subject === "Rollback")).toBe(false);
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);

it.effect("updateMemory rejects a stale revision (CAS)", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    const item = yield* store.saveMemory({
      ...baseInput,
      subject: "CAS",
      text: "Original text for the CAS check.",
    });
    yield* store.updateMemory({ id: item.id, revision: item.revision, text: "First write." });
    const stale = yield* store
      .updateMemory({ id: item.id, revision: item.revision, text: "Stale write." })
      .pipe(Effect.flip);
    expect(stale._tag).toBe("DropwaveOperationError");
    const fresh = yield* store.getMemory(item.id);
    expect(fresh?.text).toBe("First write.");
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);

it.effect("overlapping evidence quotes route paraphrased rewrites to the merge verdict", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    const first = yield* store.saveMemory({
      ...baseInput,
      kind: "rule",
      text: "Require npm test before declaring work done in this project.",
      quote: "in THIS project, always run npm test before you say anything is done",
    });
    const textGeneration = yield* TextGeneration.TextGeneration.pipe(
      Effect.provide(
        tgLayer(
          '{"contradicts":false,"merged":"Always run npm test before declaring work done in PulseBilling."}',
        ),
      ),
    );
    const serverSettings = yield* ServerSettings.ServerSettingsService.pipe(
      Effect.provide(settingsLayer),
    );
    // Same owner quote extended by a scope note; text is a paraphrase whose
    // bag-of-words Jaccard sits far below every lexical threshold.
    const merged = yield* saveMemoryMerged({
      store,
      embeddings: noEmbeddings,
      textGeneration,
      serverSettings,
      workspaceRoot: "/tmp",
      ...baseInput,
      kind: "rule",
      subject: "PulseBilling completion verification",
      text: "In PulseBilling, always run npm test before claiming work is done. This rule applies only to this project.",
      quote:
        "in THIS project, always run npm test before you say anything is done - that's a project rule only.",
      sourceMessageId: "msg-2",
    });
    expect(merged.id).toBe(first.id);
    const all = yield* store.listMemories({ projectId, limit: 50 });
    expect(all.filter((item) => item.kind === "rule")).toHaveLength(1);
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);

it.effect("update replaces text and the newest quote becomes the primary evidence", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    const item = yield* store.saveMemory({
      projectId,
      botThreadId: threadId,
      scope: "project",
      kind: "fact",
      subject: "Favorite editor",
      text: "Ash's favorite code editor is Helix.",
      quote: "my favorite code editor is Helix",
      sourceMessageId: "msg-1",
      threadId,
    });
    const updated = yield* store.updateMemory({
      id: item.id,
      revision: item.revision,
      text: "Ash's favorite code editor is Neovim.",
      quote: "my favorite code editor is Neovim",
      evidence: [
        {
          quote: "my favorite code editor is Neovim",
          sourceMessageId: "msg-2",
          threadId,
          at: "2026-11-21T00:00:00.000Z",
        },
      ],
      by: "agent",
    });
    expect(updated.quote).toBe("my favorite code editor is Neovim");
    expect(updated.evidence.map((entry) => entry.quote)).toContain(
      "my favorite code editor is Neovim",
    );
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);

it.effect("update that duplicates another item merges there and retires the stale row", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    const keep = yield* store.saveMemory({
      projectId,
      botThreadId: threadId,
      scope: "project",
      kind: "rule",
      subject: "Test rule",
      text: "Always run npm test before declaring work done in PulseBilling.",
      threadId,
    });
    const stale = yield* store.saveMemory({
      projectId,
      botThreadId: threadId,
      scope: "project",
      kind: "fact",
      subject: "Test rule",
      text: "An older unrelated note about testing.",
      threadId,
    });
    const merged = yield* updateMemoryMerged({
      store,
      embeddings: noEmbeddings,
      projectId,
      id: stale.id,
      revision: stale.revision,
      text: "Always run npm test before declaring work done.",
      kind: "rule",
    });
    expect(merged.id).toBe(keep.id);
    const retired = yield* store.getMemory(stale.id);
    expect(retired?.status).toBe("archived");
    const kept = yield* store.getMemory(keep.id);
    expect(kept?.status).toBe("active");
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);

it.effect("project save matching an owner memory touches evidence instead of duplicating", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    const owner = yield* store.saveMemory({
      projectId,
      botThreadId: threadId,
      scope: "owner",
      kind: "preference",
      authority: "owner",
      subject: "Answer style",
      text: "Ash prefers short, direct answers with no filler.",
      quote: "I prefer short, direct answers",
      sourceMessageId: "msg-owner",
      threadId,
    });
    const result = yield* saveMemoryMerged({
      store,
      embeddings: noEmbeddings,
      ...baseInput,
      kind: "rule",
      subject: "Answer style",
      text: "Ash prefers short, direct answers.",
      quote: "I prefer short, direct answers, always",
      sourceMessageId: "msg-project",
    });
    expect(result.id).toBe(owner.id);
    const all = yield* store.listMemories({ projectId, limit: 50 });
    expect(all.filter((entry) => entry.scope === "project")).toHaveLength(0);
    const refreshed = yield* store.getMemory(owner.id);
    expect(refreshed?.evidence.map((entry) => entry.quote)).toContain(
      "I prefer short, direct answers, always",
    );
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);

it.effect("project override of an owner memory saves a project row linked replaces", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    const owner = yield* store.saveMemory({
      projectId,
      botThreadId: threadId,
      scope: "owner",
      kind: "preference",
      authority: "owner",
      subject: "Answer style",
      text: "Ash prefers answers written in the Devin CLI.",
      quote: "I like answers in the Devin CLI",
      sourceMessageId: "msg-owner",
      threadId,
    });
    const override = yield* saveMemoryMerged({
      store,
      embeddings: noEmbeddings,
      ...baseInput,
      kind: "rule",
      subject: "Answer style",
      text: "In this project, always answer in T3 chat instead.",
      quote: "in THIS project always answer in T3 chat",
      sourceMessageId: "msg-project",
    });
    expect(override.id).not.toBe(owner.id);
    expect(override.scope).toBe("project");
    const relations = yield* store.listMemoryRelations(override.id);
    expect(relations.some((relation) => relation.type === "replaces")).toBe(true);
    const refreshedOwner = yield* store.getMemory(owner.id);
    expect(refreshedOwner?.text).toBe("Ash prefers answers written in the Devin CLI.");
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);
