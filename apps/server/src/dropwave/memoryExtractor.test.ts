import type { OrchestrationV2ConversationMessage } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  buildExtractionPrompt,
  confidenceFromScore,
  formatExtractionWindow,
  formatExistingMemories,
  parseExtractionOps,
} from "./memoryExtractor.ts";

const OWNER_MESSAGE =
  "From now on always reply in British English. Also remember that I hate long status updates.";

let messageSeq = 0;
function msg(partial: {
  role: "user" | "assistant" | "system";
  createdBy?: "user" | "agent" | "system";
  text: string;
}): OrchestrationV2ConversationMessage {
  messageSeq += 1;
  return {
    id: `m_${messageSeq}` as never,
    threadId: "t1" as never,
    runId: null,
    nodeId: null,
    role: partial.role,
    text: partial.text,
    attachments: [],
    streaming: false,
    createdBy: partial.createdBy ?? (partial.role === "user" ? "user" : "agent"),
    creationSource: "web",
    createdAt: DateTime.nowUnsafe() as never,
    updatedAt: DateTime.nowUnsafe() as never,
  } as OrchestrationV2ConversationMessage;
}

describe("formatExtractionWindow", () => {
  it("keeps owner lines full, clips assistant to 200 chars, skips system", () => {
    const longAssistant = "a".repeat(500);
    const { window, ownerTexts } = formatExtractionWindow([
      msg({ role: "user", text: "remember I prefer tea" }),
      msg({ role: "assistant", text: longAssistant }),
      msg({ role: "system", text: "tool output noise" }),
      msg({ role: "user", createdBy: "agent", text: "agent-sent user-role line" }),
      msg({ role: "user", text: "and always sign off as Ash" }),
    ]);
    expect(window).toContain("Owner: remember I prefer tea");
    expect(window).toContain("Owner: and always sign off as Ash");
    expect(window).toContain(`Assistant: ${"a".repeat(200)}…`);
    expect(window).not.toContain("tool output noise");
    expect(window).not.toContain("agent-sent user-role line");
    expect(ownerTexts).toEqual(["remember I prefer tea", "and always sign off as Ash"]);
  });
});

describe("parseExtractionOps", () => {
  it("keeps verified ops with scope/kind/subject/score", () => {
    const raw = JSON.stringify([
      {
        op: "add",
        scope: "owner",
        kind: "preference",
        subject: "Reply language",
        text: "The owner prefers replies in British English.",
        quote: "always reply in British English",
        confidence: 0.9,
      },
      {
        op: "add",
        scope: "project",
        kind: "preference",
        subject: "Status updates",
        text: "The owner dislikes long status updates.",
        quote: "I hate long status updates",
        confidence: 0.7,
      },
    ]);
    const ops = parseExtractionOps(raw, [OWNER_MESSAGE]);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({
      op: "add",
      scope: "owner",
      kind: "preference",
      subject: "Reply language",
      score: 0.9,
      confidence: "confirmed",
    });
    expect(ops[1]).toMatchObject({ scope: "project", score: 0.7, confidence: "mentioned" });
  });

  it("verifies a quote against ANY owner message in the window", () => {
    const raw = JSON.stringify([
      {
        op: "add",
        scope: "owner",
        kind: "fact",
        subject: "Drink",
        text: "The owner prefers tea.",
        quote: "I prefer tea",
        confidence: 0.85,
      },
    ]);
    const ops = parseExtractionOps(raw, [
      "unrelated first message",
      "btw I prefer tea over coffee",
    ]);
    expect(ops).toHaveLength(1);
    expect(ops[0]?.subject).toBe("Drink");
  });

  it("drops ops whose quote is not verbatim in any owner message", () => {
    const raw = JSON.stringify([
      {
        op: "add",
        scope: "owner",
        kind: "fact",
        subject: "Invented",
        text: "The model made this up.",
        quote: "words the owner never said",
        confidence: 0.95,
      },
    ]);
    expect(parseExtractionOps(raw, [OWNER_MESSAGE])).toEqual([]);
  });

  it("drops invalid scope/kind and keeps update ops with ids", () => {
    const raw = JSON.stringify([
      {
        op: "add",
        scope: "everyone",
        kind: "fact",
        text: "Bad scope.",
        quote: "always reply in British English",
        confidence: 0.9,
      },
      {
        op: "update",
        id: "mem_123",
        scope: "owner",
        kind: "preference",
        subject: "Reply language",
        text: "Updated text.",
        quote: "I hate long status updates",
        confidence: 0.85,
      },
    ]);
    const ops = parseExtractionOps(raw, [OWNER_MESSAGE]);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: "update", id: "mem_123" });
  });

  it("returns empty for non-JSON and caps at 8 ops", () => {
    expect(parseExtractionOps("not json at all", [OWNER_MESSAGE])).toEqual([]);
    const many = JSON.stringify(
      Array.from({ length: 12 }, (_, i) => ({
        op: "add",
        scope: "project",
        kind: "fact",
        subject: `s${i}`,
        text: `t${i}`,
        quote: "always reply in British English",
        confidence: 0.9,
      })),
    );
    expect(parseExtractionOps(many, [OWNER_MESSAGE])).toHaveLength(8);
  });
});

describe("confidenceFromScore", () => {
  it("maps the 0..1 score onto stored tiers", () => {
    expect(confidenceFromScore(0.95)).toBe("confirmed");
    expect(confidenceFromScore(0.85)).toBe("learned");
    expect(confidenceFromScore(0.5)).toBe("mentioned");
  });
});

describe("buildExtractionPrompt", () => {
  it("fills placeholders and formats existing memories", () => {
    const prompt = buildExtractionPrompt({
      botName: "Atlas",
      botRole: "Chief of Staff",
      projectName: "Storefront",
      existing: [
        {
          id: "m1",
          scope: "owner",
          kind: "preference",
          subject: "Tone",
          text: "Be brief.",
        } as never,
      ],
      window: "Owner: hello",
    });
    expect(prompt).toContain("Atlas");
    expect(prompt).toContain("Chief of Staff");
    expect(prompt).toContain("Storefront");
    expect(prompt).toContain("m1 | owner/preference/Tone | Be brief.");
    expect(prompt).toContain("Owner: hello");
    expect(prompt).not.toContain("{{");
  });

  it("formatExistingMemories handles empty", () => {
    expect(formatExistingMemories([])).toBe("(none)");
  });
});
