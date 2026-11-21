import type { OrchestrationV2Subagent } from "@t3tools/contracts";

/** Inline diff cap for the reviewer prompt (120 KB per the Fusion design). */
export const WORKER_REVIEW_DIFF_CAP_BYTES = 120 * 1024;

/** Appended inside the prompt's diff heading when the reviewer cannot read the checkout. */
export const WORKER_REVIEW_INLINE_DIFF_NOTE =
  "; this reviewer cannot read the checkout, so the full diff is inlined (capped at 120 KB)";

const WORKER_REVIEW_FIX_PREFIX =
  "A reviewer checked your work against the brief. Fix these, re-run the checks, commit, and report again:";

const WORKER_BRIEF_MARKER = "\n\n<dropwave_worker>";

/** The delegate_task prompt without the appended <dropwave_worker> boilerplate. */
export function workerReviewBrief(prompt: string): string {
  const marker = prompt.indexOf(WORKER_BRIEF_MARKER);
  return marker === -1 ? prompt : prompt.slice(0, marker);
}

const DONE_CHECK_LINE =
  /^\s*(?:[-*•]\s+|\d+[.)]\s+)?(?:`?[^\s`]+`?\s+)*(?:run|check|verify|test|lint|typecheck|build|prove|validate|ensure|confirm|pass)\b.*$/i;
const DONE_CHECK_HEADING = /done|check|verif|acceptance|proof/i;

/**
 * Definition-of-done check lines from the brief: a "done/checks" section when
 * present, plus lines that read like commands or verifications. Empty when the
 * brief states none.
 */
export function workerReviewDoneChecks(brief: string): string {
  const lines = brief.split("\n");
  const picked: Array<string> = [];
  let inSection = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      if (inSection) inSection = false;
      continue;
    }
    if (/^#{1,6}\s/.test(trimmed) || /^[A-Z][A-Za-z ]{2,40}:$/.test(trimmed)) {
      inSection = DONE_CHECK_HEADING.test(trimmed);
      if (inSection) continue;
    }
    if (inSection || DONE_CHECK_LINE.test(trimmed)) {
      picked.push(trimmed.replace(/^[-*•]\s+/, ""));
    }
  }
  const deduped = [...new Set(picked)].slice(0, 20);
  return deduped.join("\n").slice(0, 2_000);
}

export function workerReviewFixMessage(
  issues: ReadonlyArray<{
    readonly severity: string;
    readonly file: string;
    readonly line: number | null;
    readonly problem: string;
    readonly fix: string;
  }>,
): string {
  const lines = issues.map((issue, index) => {
    const where = issue.file
      ? `${issue.file}${issue.line === null ? "" : `:${issue.line}`}`
      : "(no file)";
    return `${index + 1}. [${issue.severity}] ${where} - ${issue.problem} Fix: ${issue.fix}`;
  });
  return `${WORKER_REVIEW_FIX_PREFIX}\n${lines.join("\n")}`;
}

/** A job is reviewable when it completed in a worktree on a Dropwave lead's thread. */
export function isReviewableWorkerTask(
  task: Pick<OrchestrationV2Subagent, "origin" | "status" | "childThreadId" | "completionDelivery">,
): boolean {
  return (
    task.origin === "app_owned" &&
    task.status === "completed" &&
    task.childThreadId !== null &&
    task.completionDelivery?.state !== "disposed" &&
    task.completionDelivery?.state !== "acknowledged" &&
    task.completionDelivery?.state !== "delivered"
  );
}
