import { ProjectId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as DropwaveStore from "./DropwaveStore.ts";
import * as MemoryRecall from "./memoryRecall.ts";

const projectId = ProjectId.make("project:recall-test");
const threadId = ThreadId.make("thread:recall-test");

const baseInput = {
  embeddings: undefined,
  projectId,
  botThreadId: threadId,
  threadId,
  turnKey: "run:test",
};

it("recallGate skips greetings, status questions and empty queries", () => {
  expect(MemoryRecall.recallGate("")).toBe("empty");
  expect(MemoryRecall.recallGate("hello there")).toBe("greeting");
  expect(MemoryRecall.recallGate("are you done yet?")).toBe("status_question");
  expect(MemoryRecall.recallGate("what style do I prefer for updates?")).toBeUndefined();
});

it.effect("recalls the matching memory into a fenced block and shows it once", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    yield* store.saveMemory({
      projectId,
      botThreadId: threadId,
      scope: "owner",
      kind: "preference",
      subject: "Update style",
      text: "The owner prefers concise bullet-point status updates.",
      quote: "keep updates short",
      confidence: "confirmed",
    });
    const first = yield* MemoryRecall.recallMemories({
      ...baseInput,
      store,
      ownerTexts: ["what style do I prefer for status updates?"],
    });
    expect(first.block).toContain("<dropwave_recall>");
    expect(first.block).toContain("concise bullet-point status updates");
    expect(first.itemIds.length).toBeGreaterThan(0);
    expect(first.trace.gate).toBe("hit");

    const second = yield* MemoryRecall.recallMemories({
      ...baseInput,
      store,
      turnKey: "run:test-2",
      ownerTexts: ["what style do I prefer for status updates?"],
    });
    expect(second.itemIds).toHaveLength(0);
    expect(second.block).toBe("");
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);

it.effect("project scope wins over owner scope on the same subject", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    yield* store.saveMemory({
      projectId,
      botThreadId: threadId,
      scope: "owner",
      kind: "rule",
      subject: "Deploys",
      text: "The owner allows deploys any day of the week.",
      quote: "deploy whenever",
      confidence: "learned",
    });
    yield* store.saveMemory({
      projectId,
      botThreadId: threadId,
      scope: "project",
      kind: "rule",
      subject: "Deploys",
      text: "Never deploy on Fridays in this project.",
      quote: "no friday deploys",
      confidence: "confirmed",
    });
    const result = yield* MemoryRecall.recallMemories({
      ...baseInput,
      store,
      ownerTexts: ["what is the deploy rule on fridays?"],
    });
    expect(result.block).toContain("Never deploy on Fridays");
    expect(result.block).not.toContain("deploys any day of the week");
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);

it.effect("records a trace the Memory screen can read", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    yield* store.saveMemory({
      projectId,
      botThreadId: threadId,
      scope: "owner",
      kind: "preference",
      subject: "Update style",
      text: "The owner prefers concise bullet-point status updates.",
      quote: "keep updates short",
      confidence: "confirmed",
    });
    yield* MemoryRecall.recallMemories({
      ...baseInput,
      store,
      ownerTexts: ["what style do I prefer for status updates?"],
    });
    const traces = yield* store.listRecallTraces(threadId, 5);
    expect(traces.length).toBe(1);
    expect(traces[0]!.turnKey).toBe("run:test");
    const trace = traces[0]!.trace as { gate?: string; shown?: Array<{ id: string }> };
    expect(trace.gate).toBe("hit");
    expect(trace.shown!.length).toBeGreaterThan(0);
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);
