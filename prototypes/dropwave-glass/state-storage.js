export function serializeState(state) {
  return JSON.stringify({ ...state, toast: "" });
}

export function restoreState(serializedState, makeSeed) {
  try {
    const saved = JSON.parse(serializedState ?? "null");
    if (
      saved &&
      Array.isArray(saved.projects) &&
      Array.isArray(saved.runs) &&
      Array.isArray(saved.decisions)
    ) {
      for (const run of saved.runs) {
        if (run.status === "running") run.status = "stopped";
      }
      saved.toast = "";
      return saved;
    }
  } catch {
    /* A corrupt local demo save is ignored. */
  }
  return makeSeed();
}
