import { threadKey } from "@t3tools/client-runtime/state/entities";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { msg } from "gt-react";

export type WorkState =
  | "working"
  | "needs-you"
  | "waiting"
  | "done"
  | "failed"
  | "stopped"
  | "ready";

export const workStateLabel: Record<WorkState, string> = {
  working: msg("Working"),
  "needs-you": msg("Needs you"),
  waiting: msg("Waiting"),
  done: msg("Done"),
  failed: msg("Failed"),
  stopped: msg("Stopped"),
  ready: msg("Ready"),
};

export const workStateGlyph: Record<WorkState, string> = {
  working: "◔",
  "needs-you": "!",
  waiting: "◌",
  done: "✓",
  failed: "!",
  stopped: "–",
  ready: "·",
};

const ATTENTION_PRIORITY: Record<WorkState, number> = {
  "needs-you": 0,
  failed: 1,
  working: 2,
  waiting: 3,
  done: 4,
  stopped: 5,
  ready: 6,
};

export function needsOwner(thread: EnvironmentThreadShell) {
  return (
    thread.hasPendingApprovals ||
    (thread.hasPendingUserInput &&
      (threadParentKey(thread) === null || thread.source.pendingRuntimeRequest?.userOnly === true))
  );
}

export function workState(thread: EnvironmentThreadShell): WorkState {
  if (needsOwner(thread) || thread.pendingSubagentRequest) {
    return "needs-you";
  }
  if (
    thread.hasPendingUserInput ||
    thread.blockedOnThreadWait ||
    thread.runtime?.status === "waiting"
  )
    return "waiting";
  switch (thread.runtime?.status) {
    case "preparing":
    case "queued":
    case "starting":
    case "running":
      return "working";
    case "completed":
      return thread.pendingBackgroundTasks.length > 0 ? "waiting" : "done";
    case "interrupted":
    case "cancelled":
    case "rolled_back":
      return "stopped";
    case "failed":
      return "failed";
    default:
      return thread.pendingBackgroundTasks.length > 0 ? "waiting" : "ready";
  }
}

export function isCurrentWork(thread: EnvironmentThreadShell) {
  const state = workState(thread);
  return state !== "done" && state !== "failed" && state !== "stopped";
}

export function keyOfThread(thread: EnvironmentThreadShell) {
  return threadKey({ environmentId: thread.environmentId, threadId: thread.id });
}

export function threadParentKey(thread: EnvironmentThreadShell) {
  if (thread.delegatedFrom) return threadKey(thread.delegatedFrom);
  if (
    thread.lineage.relationshipToParent !== "subagent" ||
    thread.lineage.parentThreadId === null
  ) {
    return null;
  }
  return threadKey({
    environmentId: thread.environmentId,
    threadId: thread.lineage.parentThreadId,
  });
}

export function isWorkspaceBot(thread: EnvironmentThreadShell) {
  return (
    thread.source.dropwaveBot !== undefined &&
    thread.archivedAt === null &&
    thread.lineage.parentThreadId === null &&
    thread.delegatedFrom === null
  );
}

export function botOwner(
  threads: ReadonlyMap<string, EnvironmentThreadShell>,
  thread: EnvironmentThreadShell | null,
): EnvironmentThreadShell | null {
  const seen = new Set<string>();
  for (let candidate = thread; candidate !== null;) {
    if (isWorkspaceBot(candidate)) return candidate;
    const parent = threadParentKey(candidate);
    if (parent === null || seen.has(parent)) return null;
    seen.add(parent);
    candidate = threads.get(parent) ?? null;
  }
  return null;
}

export function workFor(threads: ReadonlyArray<EnvironmentThreadShell>, owner: ScopedThreadRef) {
  const key = threadKey(owner);
  const byKey = new Map(threads.map((thread) => [keyOfThread(thread), thread]));
  return threads.filter((thread) => {
    if (threadParentKey(thread) === null) return false;
    const bot = botOwner(byKey, thread);
    return bot !== null && keyOfThread(bot) === key;
  });
}

export function newestWorkFirst(a: EnvironmentThreadShell, b: EnvironmentThreadShell) {
  return b.updatedAt.localeCompare(a.updatedAt);
}

export function attentionFirst(a: EnvironmentThreadShell, b: EnvironmentThreadShell) {
  const diff = ATTENTION_PRIORITY[workState(a)] - ATTENTION_PRIORITY[workState(b)];
  return diff !== 0 ? diff : newestWorkFirst(a, b);
}

export function formatShortAge(iso: string): string {
  const deltaSec = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (Number.isNaN(deltaSec) || deltaSec < 60) return "now";
  const mins = Math.floor(deltaSec / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
