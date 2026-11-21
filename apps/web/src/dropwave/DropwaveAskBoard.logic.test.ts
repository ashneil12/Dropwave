import type { DropwaveAsk, DropwaveAskStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  askBoardLane,
  askWorkerPhase,
  groupAsksByLane,
  laneDropStatus,
  type AskWorkerPhase,
} from "./DropwaveAskBoard.logic";

const ask = (status: DropwaveAskStatus, jobs: ReadonlyArray<string> = []) =>
  ({ status, jobs }) as Pick<DropwaveAsk, "status"> & { jobs: ReadonlyArray<string> };

describe("askWorkerPhase", () => {
  it("is none without linked jobs or without loaded subagents", () => {
    expect(askWorkerPhase([], [{ id: "j1", status: "running" }])).toBe("none");
    expect(askWorkerPhase(["j1"], null)).toBe("none");
    expect(askWorkerPhase(["j1"], [{ id: "other", status: "running" }])).toBe("none");
  });

  it("is active while any linked job is in flight", () => {
    expect(
      askWorkerPhase(
        ["j1", "j2"],
        [
          { id: "j1", status: "completed" },
          { id: "j2", status: "running" },
        ],
      ),
    ).toBe("active");
    expect(askWorkerPhase(["j1", "j2"], [{ id: "j2", status: "pending" }])).toBe("active");
  });

  it("is settled only when every linked job completed", () => {
    expect(
      askWorkerPhase(
        ["j1", "j2"],
        [
          { id: "j1", status: "completed" },
          { id: "j2", status: "completed" },
        ],
      ),
    ).toBe("settled");
    expect(
      askWorkerPhase(
        ["j1"],
        [
          { id: "j1", status: "completed" },
          { id: "j2", status: "failed" },
        ],
      ),
    ).toBe("settled");
  });

  it("is stalled when jobs ended without completing and none are active", () => {
    expect(askWorkerPhase(["j1"], [{ id: "j1", status: "failed" }])).toBe("stalled");
    expect(
      askWorkerPhase(
        ["j1", "j2"],
        [
          { id: "j1", status: "completed" },
          { id: "j2", status: "cancelled" },
        ],
      ),
    ).toBe("stalled");
  });
});

describe("askBoardLane", () => {
  it("maps every ask status to its lane", () => {
    expect(askBoardLane(ask("heard"), "none")).toBe("heard");
    expect(askBoardLane(ask("waiting"), "none")).toBe("waiting");
    expect(askBoardLane(ask("done"), "none")).toBe("done");
    expect(askBoardLane(ask("dropped"), "none")).toBe("done");
    expect(askBoardLane(ask("maybe"), "none")).toBeNull();
  });

  it("splits started asks into working vs checking by worker phase", () => {
    expect(askBoardLane(ask("started"), "active")).toBe("working");
    expect(askBoardLane(ask("started"), "none")).toBe("working");
    expect(askBoardLane(ask("started"), "stalled")).toBe("working");
    expect(askBoardLane(ask("started"), "settled")).toBe("checking");
  });
});

describe("laneDropStatus", () => {
  it("maps lanes to statuses and rejects the derived checking lane", () => {
    expect(laneDropStatus("heard")).toBe("heard");
    expect(laneDropStatus("working")).toBe("started");
    expect(laneDropStatus("waiting")).toBe("waiting");
    expect(laneDropStatus("checking")).toBeNull();
    expect(laneDropStatus("done")).toBe("done");
  });
});

describe("groupAsksByLane", () => {
  it("groups asks and excludes maybe asks", () => {
    const asks = [
      { id: "a1", ...ask("heard") },
      { id: "a2", ...ask("started", ["j1"]) },
      { id: "a3", ...ask("waiting") },
      { id: "a4", ...ask("done") },
      { id: "a5", ...ask("maybe") },
    ] as unknown as ReadonlyArray<DropwaveAsk>;
    const phases: Record<string, AskWorkerPhase> = { a2: "settled" };
    const lanes = groupAsksByLane(asks, (a) => phases[a.id] ?? "none");
    expect(lanes.heard.map((a) => a.id)).toEqual(["a1"]);
    expect(lanes.checking.map((a) => a.id)).toEqual(["a2"]);
    expect(lanes.waiting.map((a) => a.id)).toEqual(["a3"]);
    expect(lanes.done.map((a) => a.id)).toEqual(["a4"]);
    expect(lanes.working).toEqual([]);
  });
});
