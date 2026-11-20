import * as NodeAssert from "node:assert/strict";
import * as NodeTest from "node:test";
import { restoreState, serializeState } from "./state-storage.js";

const savedState = {
  projects: [{ id: "project-demo" }],
  runs: [{ id: "run-demo", status: "accepted" }],
  decisions: [],
  toast: "Sample run started locally.",
};

NodeTest.test("completed runs reload without a stale start message", () => {
  const restored = restoreState(JSON.stringify(savedState), () =>
    NodeAssert.fail("expected saved state"),
  );

  NodeAssert.equal(restored.runs[0].status, "accepted");
  NodeAssert.equal(restored.toast, "");
});

NodeTest.test("transient messages are omitted from saved demo state", () => {
  const persisted = JSON.parse(serializeState(savedState));

  NodeAssert.equal(persisted.runs[0].status, "accepted");
  NodeAssert.equal(persisted.toast, "");
});

NodeTest.test("unfinished runs stop cleanly after reload", () => {
  const interrupted = { ...savedState, runs: [{ id: "run-demo", status: "running" }] };
  const restored = restoreState(JSON.stringify(interrupted), () =>
    NodeAssert.fail("expected saved state"),
  );

  NodeAssert.equal(restored.runs[0].status, "stopped");
});
