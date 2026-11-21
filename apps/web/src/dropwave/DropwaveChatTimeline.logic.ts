import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";

export type DropwaveChatTimelineSegment =
  | {
      readonly kind: "message";
      readonly messageId: string;
    }
  | {
      readonly kind: "work";
      readonly entries: ReadonlyArray<OrchestrationV2ProjectedTurnItem>;
    };

function messageIdOf(item: OrchestrationV2ProjectedTurnItem["item"]): string | null {
  return item.type === "user_message" || item.type === "assistant_message" ? item.messageId : null;
}

/**
 * Orders the chat the same way T3's timeline does — the projected turn items
 * already arrive in ordinal order — then splits them into message anchors and
 * runs of work so each run can render as its own working block where it
 * happened instead of one block at the bottom of the thread.
 */
export function buildDropwaveChatTimeline(
  entries: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
): ReadonlyArray<DropwaveChatTimelineSegment> {
  const segments: DropwaveChatTimelineSegment[] = [];
  let pendingWork: OrchestrationV2ProjectedTurnItem[] = [];
  const flushWork = () => {
    if (pendingWork.length === 0) return;
    segments.push({ kind: "work", entries: pendingWork });
    pendingWork = [];
  };
  for (const entry of entries) {
    const messageId = messageIdOf(entry.item);
    if (messageId !== null) {
      flushWork();
      segments.push({ kind: "message", messageId });
    } else {
      pendingWork.push(entry);
    }
  }
  flushWork();
  return segments;
}
