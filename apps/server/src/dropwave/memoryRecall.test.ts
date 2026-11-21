import { ProjectId, ThreadId } from "@t3tools/contracts";
import type { DropwaveMemoryItem } from "@t3tools/contracts";
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

function fakeItem(overrides: Partial<DropwaveMemoryItem>): DropwaveMemoryItem {
  return {
    id: "mem_test",
    projectId,
    botThreadId: threadId,
    scope: "owner",
    personaId: null,
    kind: "preference",
    subject: "",
    text: "memory text",
    aliases: [],
    tags: [],
    tier: "semantic",
    status: "active",
    authority: "agent",
    evidence: [],
    journal: [],
    revision: 1,
    confidence: "learned",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as DropwaveMemoryItem;
}

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

it("rerankScore weights semantic .45, lexical .25, recency .15, tier .10, evidence .05", () => {
  const now = Date.parse("2026-06-01T00:00:00.000Z");
  const item = fakeItem({
    tier: "core",
    evidence: [
      { quote: "q", sourceMessageId: null, threadId: null, at: "2026-01-01T00:00:00.000Z" },
    ],
    updatedAt: "2026-06-01T00:00:00.000Z",
  });
  const candidate = { item, semantic: 1, lexical: 0.5, graph: 0, via: undefined };
  // semantic .45*1 + lexical .25*.5 + recency .15*1 + tier .10*1 + evidence .05*0.7 + best .1*1
  const expected = 0.45 + 0.125 + 0.15 + 0.1 + 0.035 + 0.1;
  expect(MemoryRecall.rerankScore(candidate, now)).toBeCloseTo(expected, 5);
  // Each weight moves the score in isolation.
  const base = { item, semantic: 0, lexical: 0, graph: 0, via: undefined };
  const withSemantic = { ...base, semantic: 0.4 };
  const deltaSemantic =
    MemoryRecall.rerankScore(withSemantic, now) - MemoryRecall.rerankScore(base, now);
  expect(deltaSemantic).toBeCloseTo(0.45 * 0.4 + 0.1 * 0.4, 5);
  const stale = fakeItem({ updatedAt: "2025-01-01T00:00:00.000Z" }); // >90d -> recency .7
  const freshItem = fakeItem({ updatedAt: "2026-06-01T00:00:00.000Z" });
  const staleScore = MemoryRecall.rerankScore(
    { item: stale, semantic: 0, lexical: 0, graph: 0, via: undefined },
    now,
  );
  const freshScore = MemoryRecall.rerankScore(
    { item: freshItem, semantic: 0, lexical: 0, graph: 0, via: undefined },
    now,
  );
  expect(freshScore - staleScore).toBeCloseTo(0.15 * 0.3, 5);
  const episodic = MemoryRecall.rerankScore(
    { item: fakeItem({ tier: "episodic" }), semantic: 0, lexical: 0, graph: 0, via: undefined },
    now,
  );
  const semanticTier = MemoryRecall.rerankScore(
    { item: fakeItem({ tier: "semantic" }), semantic: 0, lexical: 0, graph: 0, via: undefined },
    now,
  );
  expect(semanticTier - episodic).toBeCloseTo(0.1 * 0.3, 5);
});

it("lexicalScore rewards subject matches on top of the FTS rank", () => {
  const withSubject = MemoryRecall.lexicalScore(fakeItem({ subject: "Deploys" }), 2);
  const withoutSubject = MemoryRecall.lexicalScore(fakeItem({ subject: "" }), 2);
  expect(withSubject - withoutSubject).toBeCloseTo(0.12, 5);
  expect(MemoryRecall.lexicalScore(fakeItem({}), undefined)).toBe(0);
});

it.effect("broad queries keep only the top item when the margin is under 0.08", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    for (const subject of ["Alpha", "Beta"]) {
      yield* store.saveMemory({
        projectId,
        botThreadId: threadId,
        scope: "owner",
        kind: "fact",
        subject,
        text: `The deploy runbook covers rollback steps for service ${subject.toLowerCase()}.`,
      });
    }
    const result = yield* MemoryRecall.recallMemories({
      ...baseInput,
      store,
      turnKey: "run:margin",
      ownerTexts: ["what do you know about the deploy runbook?"],
    });
    expect(result.itemIds.length).toBeLessThanOrEqual(1);
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);

it.effect("episodic memories need a history hint; relation neighbours expand one hop", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    const seed = yield* store.saveMemory({
      projectId,
      botThreadId: threadId,
      scope: "owner",
      kind: "fact",
      subject: "Cache",
      text: "The edge cache TTL is ten minutes for catalog pages.",
    });
    const neighbour = yield* store.saveMemory({
      projectId,
      botThreadId: threadId,
      scope: "owner",
      kind: "decision",
      tier: "episodic",
      subject: "Cache migration",
      text: "We migrated the catalog cache to Redis last quarter.",
    });
    yield* store.addMemoryRelation({
      sourceId: seed.id,
      targetId: neighbour.id,
      type: "about",
      confidence: 0.9,
    });
    const plain = yield* MemoryRecall.recallMemories({
      ...baseInput,
      store,
      turnKey: "run:hist-1",
      ownerTexts: ["what is the edge cache TTL?"],
    });
    expect(plain.itemIds).toContain(seed.id);
    expect(plain.itemIds).not.toContain(neighbour.id);
    const history = yield* MemoryRecall.recallMemories({
      ...baseInput,
      store,
      turnKey: "run:hist-2",
      ownerTexts: ["what did we decide before about the cache migration?"],
    });
    expect(history.itemIds).toContain(neighbour.id);
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);

it.effect("recall caps at five items and reports budget drops", () =>
  Effect.gen(function* () {
    const store = yield* DropwaveStore.DropwaveStore;
    for (let index = 0; index < 12; index += 1) {
      yield* store.saveMemory({
        projectId,
        botThreadId: threadId,
        scope: "owner",
        kind: "fact",
        subject: `Budget ${index}`,
        text: `The quarterly budget review covers line item ${index} for the analytics workspace.`,
      });
    }
    const result = yield* MemoryRecall.recallMemories({
      ...baseInput,
      store,
      turnKey: "run:budget",
      ownerTexts: ["the quarterly budget review covers line item"],
    });
    expect(result.itemIds.length).toBeLessThanOrEqual(5);
    expect(result.trace.drops.some((drop) => drop.reason === "budget")).toBe(true);
  }).pipe(Effect.provide(DropwaveStore.layerMemory)),
);
