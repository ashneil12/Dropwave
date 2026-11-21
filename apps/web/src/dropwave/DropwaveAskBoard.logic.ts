import type { DropwaveAsk } from "@t3tools/contracts";

export type AskBoardLaneId = "heard" | "working" | "waiting" | "checking" | "done";

export const ASK_BOARD_LANE_ORDER: ReadonlyArray<AskBoardLaneId> = [
  "heard",
  "working",
  "waiting",
  "checking",
  "done",
];

export type AskWorkerPhase = "none" | "active" | "settled" | "stalled";

const ACTIVE_SUBAGENT_STATUSES = new Set(["idle", "pending", "running", "waiting"]);

/**
 * Live state of the delegated jobs linked to an ask, read from the owning
 * bot thread's subagent records. `null` means the projection has not loaded.
 */
export function askWorkerPhase(
  jobIds: ReadonlyArray<string>,
  subagents: ReadonlyArray<{ readonly id: string; readonly status: string }> | null,
): AskWorkerPhase {
  if (jobIds.length === 0 || subagents === null) return "none";
  const linked = subagents.filter((subagent) => jobIds.includes(subagent.id));
  if (linked.length === 0) return "none";
  if (linked.some((subagent) => ACTIVE_SUBAGENT_STATUSES.has(subagent.status))) {
    return "active";
  }
  if (linked.every((subagent) => subagent.status === "completed")) return "settled";
  return "stalled";
}

/**
 * Lane for an ask. `maybe` asks are not board cards — they live in the
 * "Did you mean this?" strip — so they return null. `dropped` asks share the
 * closed lane with `done` and carry their own badge on the card.
 */
export function askBoardLane(
  ask: Pick<DropwaveAsk, "status">,
  workerPhase: AskWorkerPhase,
): AskBoardLaneId | null {
  switch (ask.status) {
    case "maybe":
      return null;
    case "heard":
      return "heard";
    case "waiting":
      return "waiting";
    case "done":
    case "dropped":
      return "done";
    case "started":
      return workerPhase === "settled" ? "checking" : "working";
  }
}

/** Status a lane drop maps to; `checking` is derived and accepts no drops. */
export function laneDropStatus(
  lane: AskBoardLaneId,
): "heard" | "started" | "waiting" | "done" | null {
  switch (lane) {
    case "heard":
      return "heard";
    case "working":
      return "started";
    case "waiting":
      return "waiting";
    case "checking":
      return null;
    case "done":
      return "done";
  }
}

export function groupAsksByLane(
  asks: ReadonlyArray<DropwaveAsk>,
  workerPhaseFor: (ask: DropwaveAsk) => AskWorkerPhase,
): Record<AskBoardLaneId, Array<DropwaveAsk>> {
  const lanes: Record<AskBoardLaneId, Array<DropwaveAsk>> = {
    heard: [],
    working: [],
    waiting: [],
    checking: [],
    done: [],
  };
  for (const ask of asks) {
    const lane = askBoardLane(ask, workerPhaseFor(ask));
    if (lane !== null) lanes[lane].push(ask);
  }
  return lanes;
}
