import {
  MessageId,
  PlanId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { buildDropwaveChatTimeline } from "./DropwaveChatTimeline.logic";

const now = DateTime.makeUnsafe("2026-06-20T00:00:00.000Z");
const threadId = ThreadId.make("thread-1");
const runId = RunId.make("run-1");

function base(id: string, ordinal: number) {
  return {
    id: TurnItemId.make(id),
    threadId,
    runId,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed" as const,
    title: null,
    startedAt: now,
    completedAt: now,
    updatedAt: now,
  };
}

function userMessage(id: string, ordinal: number, messageId: string) {
  return {
    ...base(id, ordinal),
    type: "user_message" as const,
    messageId: MessageId.make(messageId),
    inputIntent: "turn_start" as const,
    text: `owner ${messageId}`,
    attachments: [],
    createdBy: "user" as const,
    creationSource: "web" as const,
  } satisfies OrchestrationV2TurnItem;
}

function assistantMessage(id: string, ordinal: number, messageId: string) {
  return {
    ...base(id, ordinal),
    type: "assistant_message" as const,
    messageId: MessageId.make(messageId),
    text: `bot ${messageId}`,
    streaming: false,
  } satisfies OrchestrationV2TurnItem;
}

function toolCall(id: string, ordinal: number) {
  return {
    ...base(id, ordinal),
    type: "command_execution" as const,
    input: "ls",
    output: "ok",
    exitCode: 0,
  } satisfies OrchestrationV2TurnItem;
}

function reasoning(id: string, ordinal: number) {
  return {
    ...base(id, ordinal),
    type: "reasoning" as const,
    text: "thinking",
    streaming: false,
  } satisfies OrchestrationV2TurnItem;
}

function todoList(id: string, ordinal: number) {
  return {
    ...base(id, ordinal),
    type: "todo_list" as const,
    planId: PlanId.make(`plan-${id}`),
    explanation: "plan",
    steps: [{ id: "s1", text: "step", status: "pending" as const }],
  } satisfies OrchestrationV2TurnItem;
}

function entry(item: OrchestrationV2TurnItem, position: number): OrchestrationV2ProjectedTurnItem {
  return {
    position,
    visibility: "local",
    sourceThreadId: threadId,
    sourceItemId: item.id,
    item,
  };
}

function kinds(segments: ReturnType<typeof buildDropwaveChatTimeline>) {
  return segments.map((s) => s.kind);
}

describe("buildDropwaveChatTimeline", () => {
  it("places a work run between the messages that surround it", () => {
    const segments = buildDropwaveChatTimeline([
      entry(userMessage("i1", 0, "m-user-1"), 0),
      entry(toolCall("i2", 1), 1),
      entry(toolCall("i3", 2), 2),
      entry(assistantMessage("i4", 3, "m-bot-1"), 3),
      entry(userMessage("i5", 4, "m-user-2"), 4),
      entry(assistantMessage("i6", 5, "m-bot-2"), 5),
    ]);
    expect(kinds(segments)).toEqual(["message", "work", "message", "message", "message"]);
    expect(segments[1]).toMatchObject({ kind: "work" });
    if (segments[1]?.kind === "work") {
      expect(segments[1].entries.map((e) => e.item.id)).toEqual(["i2", "i3"]);
    }
  });

  it("merges consecutive work items into one group", () => {
    const segments = buildDropwaveChatTimeline([
      entry(userMessage("i1", 0, "m1"), 0),
      entry(reasoning("i2", 1), 1),
      entry(toolCall("i3", 2), 2),
      entry(todoList("i4", 3), 3),
      entry(toolCall("i5", 4), 4),
      entry(assistantMessage("i6", 5, "m2"), 5),
    ]);
    expect(kinds(segments)).toEqual(["message", "work", "message"]);
    if (segments[1]?.kind === "work") {
      expect(segments[1].entries).toHaveLength(4);
    }
  });

  it("keeps a trailing work group as the last segment so it can run live", () => {
    const segments = buildDropwaveChatTimeline([
      entry(userMessage("i1", 0, "m1"), 0),
      entry(assistantMessage("i2", 1, "m2"), 1),
      entry(toolCall("i3", 2), 2),
      entry(toolCall("i4", 3), 3),
    ]);
    expect(kinds(segments)).toEqual(["message", "message", "work"]);
    const last = segments.at(-1);
    expect(last?.kind).toBe("work");
  });

  it("keeps work that follows a later user message in its own group", () => {
    const segments = buildDropwaveChatTimeline([
      entry(userMessage("i1", 0, "m1"), 0),
      entry(toolCall("i2", 1), 1),
      entry(assistantMessage("i3", 2, "m2"), 2),
      entry(userMessage("i4", 3, "m3"), 3),
      entry(toolCall("i5", 4), 4),
      entry(toolCall("i6", 5), 5),
      entry(assistantMessage("i7", 6, "m4"), 6),
    ]);
    expect(kinds(segments)).toEqual(["message", "work", "message", "message", "work", "message"]);
    if (segments[4]?.kind === "work") {
      expect(segments[4].entries.map((e) => e.item.id)).toEqual(["i5", "i6"]);
    }
  });

  it("returns message anchors with the message id the chat renders", () => {
    const segments = buildDropwaveChatTimeline([
      entry(userMessage("i1", 0, "msg-a"), 0),
      entry(assistantMessage("i2", 1, "msg-b"), 1),
    ]);
    expect(segments).toEqual([
      { kind: "message", messageId: "msg-a" },
      { kind: "message", messageId: "msg-b" },
    ]);
  });
});
