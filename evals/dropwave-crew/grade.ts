/** Pure grading for dropwave-crew cases. Reads only the persisted state the runner collects. */
import type {
  DropwaveAsk,
  DropwaveBotProfile,
  DropwaveMemoryItem,
  DropwavePersona,
  ModelSelection,
} from "@t3tools/contracts";

import type { Check } from "./cases.ts";
import { PERSONALITY_SOURCES } from "../../apps/server/src/dropwave/personality/sources.ts";

export interface JobInfo {
  readonly id: string;
  readonly status: string;
  readonly title?: string | undefined;
  readonly modelSelection?: ModelSelection | undefined;
  readonly worktreePath?: string | undefined;
  readonly startedAt?: number | undefined;
  readonly completedAt?: number | undefined;
}

export interface CaseState {
  readonly asks: ReadonlyArray<DropwaveAsk>;
  readonly memories: ReadonlyArray<DropwaveMemoryItem>;
  readonly personas: ReadonlyArray<DropwavePersona>;
  readonly personasById: ReadonlyMap<string, DropwavePersona>;
  readonly docs: ReadonlyArray<{ kind: string; text: string }>;
  /** Lead assistant replies in order (static first-run opening never reaches the server). */
  readonly leadReplies: ReadonlyArray<string>;
  readonly leadFileChangeCount: number;
  /** Sum of supervisor lead-direct-edit counters; -1 when the store could not be read. */
  readonly supervisorEditCount: number;
  readonly jobs: ReadonlyArray<JobInfo>;
  /** The project's main checkout; landed_checks_pass runs here to see only work that landed. */
  readonly workspaceRoot: string;
  /** teammate role/title -> messages on that thread with optional senderThreadId. */
  readonly teammateMessages: ReadonlyMap<
    string,
    ReadonlyArray<{ text: string; senderThreadId?: string | undefined }>
  >;
  readonly leadProfile?: DropwaveBotProfile | undefined;
  readonly teammateProfiles: ReadonlyArray<{ title: string; role: string }>;
  /**
   * Recall traces recorded on the lead thread, newest first. Each trace is the
   * <dropwave_recall> payload a turn actually saw: shown item ids plus drops.
   */
  readonly recallTraces: ReadonlyArray<{
    readonly turnKey: string;
    readonly createdAt: string;
    readonly gate?: string | undefined;
    readonly shown: ReadonlyArray<{ readonly id: string }>;
    readonly drops: ReadonlyArray<{ readonly id: string; readonly reason?: string | undefined }>;
  }>;
  /** Persisted Fusion worker-review records (dropwave_worker_reviews), newest first. */
  readonly workerReviews: ReadonlyArray<{
    readonly jobId: string;
    readonly status: string;
    readonly rounds: number;
    readonly maxRounds: number;
    readonly verdicts: ReadonlyArray<{
      readonly verdict: string;
      readonly summary: string;
      readonly issues: ReadonlyArray<{ readonly severity?: string }>;
    }>;
  }>;
}

export interface CheckResult {
  readonly checkId: string;
  readonly pass: boolean;
  readonly evidence: string;
}

const hasAll = (haystack: string, keywords: ReadonlyArray<string>): boolean => {
  const lower = haystack.toLowerCase();
  return keywords.every((k) => lower.includes(k.toLowerCase()));
};

const ok = (checkId: string, evidence: string): CheckResult => ({ checkId, pass: true, evidence });
const fail = (checkId: string, evidence: string): CheckResult => ({
  checkId,
  pass: false,
  evidence,
});

const OPEN_STATUSES = new Set(["heard", "maybe", "started", "waiting"]);

/** The case spec's askKind vocabulary mapped to DropwaveAskKind. */
const SPEC_ASK_KIND: Record<string, string> = {
  task: "do",
  question: "answer",
  idea: "idea",
};

const findAsk = (
  asks: ReadonlyArray<DropwaveAsk>,
  keywords: ReadonlyArray<string>,
  askKind?: "task" | "question" | "idea",
): DropwaveAsk | undefined =>
  asks.find(
    (ask) =>
      hasAll(`${ask.quote} ${ask.summary}`, keywords) &&
      (askKind === undefined || ask.kind === SPEC_ASK_KIND[askKind]),
  );

const askStatusPass = (ask: DropwaveAsk, finalStatus: string): boolean => {
  if (finalStatus === "done") return ask.status === "done" && (ask.proof ?? "").trim() !== "";
  if (finalStatus === "open_any") return OPEN_STATUSES.has(ask.status);
  if (finalStatus === "not_started") return ask.status === "heard" || ask.status === "maybe";
  return true;
};

function checkId(check: Check, index: number): string {
  switch (check.kind) {
    case "ask_captured":
      return `ask:${check.id}`;
    case "distinct_asks":
      return `distinct:${check.ids.join("+")}`;
    case "memory_saved":
      return `memory:${check.keywords[0]}`;
    case "no_lead_project_edits":
      return "no_lead_project_edits";
    case "jobs_in_isolated_worktrees":
      return `jobs>=${check.min}`;
    case "parallel_jobs":
      return `parallel>=${check.minConcurrent}`;
    case "jobs_used_worker_model":
      return "jobs_used_worker_model";
    case "landed_checks_pass":
      return "landed_checks_pass";
    case "teammate_received":
      return `teammate_received:${check.teammate}`;
    case "teammate_not_contacted":
      return `teammate_not_contacted:${check.teammate}`;
    case "doc_exists":
      return `doc:${check.docKind}`;
    case "persona":
      return `persona:${check.role}:${check.name ?? "*"}`;
    case "lead_uses_persona":
      return `lead_uses_persona:${check.personaName}`;
    case "onboarding_complete":
      return "onboarding_complete";
    case "loop_configured":
      return "loop_configured";
    case "lead_reply":
      return `lead_reply:${check.index}`;
    case "lead_replies_never":
      return "lead_replies_never";
    case "recall_trace":
      return `recall_trace:${check.shownKeywords[0] ?? "*"}`;
    case "worker_review":
      return `worker_review>=${check.min}`;
    default:
      return `check_${index}`;
  }
}

/** Maximum number of jobs running at the same instant from [start, end] intervals. */
export function maxConcurrentJobs(
  jobs: ReadonlyArray<Pick<JobInfo, "startedAt" | "completedAt">>,
  caseEnd: number,
): number {
  const points: Array<{ at: number; delta: number }> = [];
  for (const job of jobs) {
    if (job.startedAt === undefined) continue;
    const start = job.startedAt;
    const end = job.completedAt ?? caseEnd;
    if (end <= start) continue;
    points.push({ at: start, delta: 1 }, { at: end, delta: -1 });
  }
  points.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let current = 0;
  let max = 0;
  for (const p of points) {
    current += p.delta;
    if (current > max) max = current;
  }
  return max;
}

const teammateKey = (
  map: ReadonlyMap<string, ReadonlyArray<{ text: string; senderThreadId?: string | undefined }>>,
  substring: string,
): ReadonlyArray<{ text: string; senderThreadId?: string | undefined }> | undefined => {
  const lower = substring.toLowerCase();
  for (const [key, messages] of map) {
    if (key.toLowerCase().includes(lower)) return messages;
  }
  return undefined;
};

export interface CheckContext {
  readonly allChecks: ReadonlyArray<Check>;
  readonly caseEnd: number;
  /** Runs a shell command in a job worktree; returns its exit code. */
  readonly exec: (command: string, cwd: string) => number;
}

export function evaluateCheck(check: Check, state: CaseState, ctx: CheckContext): CheckResult {
  const { allChecks, caseEnd, exec } = ctx;
  const id = checkId(check, 0);
  switch (check.kind) {
    case "ask_captured": {
      const ask = findAsk(state.asks, check.keywords, check.askKind);
      if (!ask) {
        return fail(
          id,
          `no ask matching [${check.keywords.join(", ")}] kind=${check.askKind ?? "*"}; asks: ${state.asks
            .map((a) => `${a.kind}:${a.summary}`)
            .join(" | ")}`,
        );
      }
      if (check.finalStatus && !askStatusPass(ask, check.finalStatus)) {
        return fail(id, `ask "${ask.summary}" status=${ask.status} proof="${ask.proof ?? ""}"`);
      }
      if (check.requiresJob && ask.jobs.length === 0) {
        return fail(id, `ask "${ask.summary}" has no linked job`);
      }
      if (check.forbidsJob && ask.jobs.length > 0) {
        return fail(id, `ask "${ask.summary}" has ${ask.jobs.length} linked job(s)`);
      }
      return ok(id, `ask "${ask.summary}" status=${ask.status} jobs=${ask.jobs.length}`);
    }
    case "distinct_asks": {
      const resolved = new Set<string>();
      const missing: string[] = [];
      for (const askId of check.ids) {
        const spec = allChecks.find(
          (c): c is Extract<Check, { kind: "ask_captured" }> =>
            c.kind === "ask_captured" && c.id === askId,
        );
        if (!spec) {
          missing.push(`${askId} (no ask_captured check with that id)`);
          continue;
        }
        const ask = findAsk(state.asks, spec.keywords, spec.askKind);
        if (!ask) {
          missing.push(`${askId} (unresolved)`);
          continue;
        }
        resolved.add(ask.id);
      }
      if (missing.length > 0) return fail(id, `unresolved: ${missing.join(", ")}`);
      if (resolved.size < check.ids.length) {
        return fail(id, `${check.ids.length} asks expected, only ${resolved.size} distinct`);
      }
      return ok(id, `${resolved.size} distinct asks`);
    }
    case "memory_saved": {
      const hits = state.memories.filter((m) => {
        if (m.scope !== check.scope) return false;
        if (check.about === "owner" && m.personaId !== null) return false;
        if (check.about === "self" && m.personaId === null) return false;
        if (check.memoryKind !== undefined && m.kind !== check.memoryKind) return false;
        return hasAll(`${m.text} ${m.quote ?? ""}`, check.keywords);
      });
      if (hits.length === 0) {
        return fail(
          id,
          `no ${check.scope} memory matching [${check.keywords.join(", ")}]; memories: ${state.memories
            .map((m) => `${m.scope}/${m.personaId ?? "owner"}:${m.text.slice(0, 60)}`)
            .join(" | ")}`,
        );
      }
      return ok(id, `matched "${hits[0]!.text.slice(0, 120)}"`);
    }
    case "no_lead_project_edits": {
      if (state.supervisorEditCount === -1) {
        return fail(
          id,
          `lead file-change items=${state.leadFileChangeCount}; supervisor kv unreadable`,
        );
      }
      if (state.leadFileChangeCount > 0 || state.supervisorEditCount > 0) {
        return fail(
          id,
          `lead file-change items=${state.leadFileChangeCount} supervisor counter=${state.supervisorEditCount}`,
        );
      }
      return ok(id, "no lead file-change items; supervisor counter 0");
    }
    case "jobs_in_isolated_worktrees": {
      const isolated = state.jobs.filter((j) => j.worktreePath !== undefined);
      if (isolated.length < check.min) {
        return fail(
          id,
          `jobs=${state.jobs.length} isolated=${isolated.length}; ${state.jobs
            .map((j) => `${j.id}:${j.status}:${j.worktreePath ?? "no-worktree"}`)
            .join(" | ")}`,
        );
      }
      return ok(
        id,
        `${isolated.length} job(s) in worktrees: ${isolated.map((j) => j.worktreePath).join(", ")}`,
      );
    }
    case "parallel_jobs": {
      const max = maxConcurrentJobs(state.jobs, caseEnd);
      if (max < check.minConcurrent) {
        return fail(
          id,
          `max concurrent=${max}; intervals ${state.jobs
            .map((j) => `[${j.startedAt},${j.completedAt}]`)
            .join(" ")}`,
        );
      }
      return ok(id, `max concurrent=${max}`);
    }
    case "landed_checks_pass": {
      const code = exec(check.command, state.workspaceRoot);
      if (code !== 0)
        return fail(id, `"${check.command}" exit ${code} in main checkout ${state.workspaceRoot}`);
      return ok(id, `"${check.command}" passed in ${state.workspaceRoot}`);
    }
    case "jobs_used_worker_model": {
      const expected =
        state.leadProfile?.kind === "lead" ? state.leadProfile.workerModelSelection : undefined;
      if (expected === undefined) return fail(id, "lead has no workerModelSelection");
      const bad = state.jobs.filter(
        (j) =>
          j.modelSelection === undefined ||
          j.modelSelection.instanceId !== expected.instanceId ||
          j.modelSelection.model !== expected.model,
      );
      if (bad.length > 0) {
        return fail(
          id,
          `jobs off worker model ${expected.model}: ${bad
            .map((j) => `${j.id}:${j.modelSelection?.model ?? "none"}`)
            .join(" | ")}`,
        );
      }
      return ok(id, `${state.jobs.length} job(s) on ${expected.instanceId}/${expected.model}`);
    }
    case "teammate_received": {
      const messages = teammateKey(state.teammateMessages, check.teammate);
      if (!messages) {
        return fail(
          id,
          `no teammate matching "${check.teammate}"; teammates: ${[...state.teammateMessages.keys()].join(", ")}`,
        );
      }
      const hit = messages.find(
        (m) => m.senderThreadId !== undefined && hasAll(m.text, check.keywords),
      );
      if (!hit) {
        return fail(
          id,
          `no lead->teammate message with [${check.keywords.join(", ")}]; messages: ${messages
            .map((m) => m.text.slice(0, 80))
            .join(" | ")}`,
        );
      }
      return ok(id, `message: "${hit.text.slice(0, 120)}"`);
    }
    case "teammate_not_contacted": {
      const messages = teammateKey(state.teammateMessages, check.teammate) ?? [];
      const fromLead = messages.filter((m) => m.senderThreadId !== undefined);
      if (fromLead.length > 0) {
        return fail(id, `teammate got ${fromLead.length} lead message(s)`);
      }
      return ok(id, "teammate never contacted");
    }
    case "doc_exists": {
      const doc = state.docs.find((d) => d.kind === check.docKind);
      if (!doc) {
        return fail(
          id,
          `no doc kind=${check.docKind}; docs: ${state.docs.map((d) => d.kind).join(", ")}`,
        );
      }
      if (!hasAll(doc.text, check.keywords)) {
        return fail(id, `doc ${check.docKind} missing [${check.keywords.join(", ")}]`);
      }
      return ok(id, `doc ${check.docKind}: "${doc.text.slice(0, 120)}…"`);
    }
    case "persona": {
      const hit = state.personas.find(
        (p) =>
          p.role === check.role &&
          (check.name === undefined || p.name.toLowerCase() === check.name.toLowerCase()),
      );
      if (!hit) {
        return fail(
          id,
          `no persona role=${check.role} name=${check.name ?? "*"}; personas: ${state.personas
            .map((p) => `${p.role}:${p.name}`)
            .join(", ")}`,
        );
      }
      if (
        check.identityEdited &&
        hit.identity.trim() === PERSONALITY_SOURCES.identityTemplate.trim()
      ) {
        return fail(id, `persona ${hit.name} identity is still the IDENTITY.md template`);
      }
      return ok(id, `persona ${hit.name} (${hit.id}) identity=${hit.identity.length} chars`);
    }
    case "lead_uses_persona": {
      const persona = state.personas.find(
        (p) => p.name.toLowerCase() === check.personaName.toLowerCase(),
      );
      const bound =
        state.leadProfile && "personaId" in state.leadProfile
          ? state.leadProfile.personaId
          : undefined;
      if (!persona || bound !== persona.id) {
        return fail(id, `lead personaId=${bound ?? "none"} expected ${persona?.id ?? "?"}`);
      }
      return ok(id, `lead bound to persona ${persona.name}`);
    }
    case "onboarding_complete": {
      const phase =
        state.leadProfile && state.leadProfile.kind === "lead"
          ? state.leadProfile.onboardingPhase
          : undefined;
      if (phase !== undefined) return fail(id, `onboardingPhase still "${phase}"`);
      return ok(id, "onboardingPhase cleared");
    }
    case "loop_configured": {
      const steps = state.leadProfile?.kind === "lead" ? (state.leadProfile.loopSteps ?? []) : [];
      if (steps.length < check.minSteps) {
        return fail(id, `loopSteps=${steps.length}`);
      }
      for (const helper of check.helpers ?? []) {
        const found = state.teammateProfiles.some(
          (t) =>
            t.title.toLowerCase().includes(helper.toLowerCase()) ||
            t.role.toLowerCase().includes(helper.toLowerCase()),
        );
        if (!found) {
          return fail(
            id,
            `no teammate matching "${helper}"; teammates: ${state.teammateProfiles
              .map((t) => `${t.title}/${t.role}`)
              .join(", ")}`,
          );
        }
      }
      return ok(id, `loopSteps=${steps.length} helpers ok`);
    }
    case "lead_reply": {
      const reply = state.leadReplies[check.index - 1];
      if (reply === undefined) {
        return fail(id, `only ${state.leadReplies.length} lead replies`);
      }
      if (check.mustContain && !hasAll(reply, check.mustContain)) {
        return fail(
          id,
          `reply ${check.index} missing [${check.mustContain.join(", ")}]: "${reply.slice(0, 200)}"`,
        );
      }
      if (check.mustNotContain) {
        const bad = check.mustNotContain.filter((s) =>
          reply.toLowerCase().includes(s.toLowerCase()),
        );
        if (bad.length > 0) return fail(id, `reply ${check.index} contains ${bad.join(", ")}`);
      }
      if (check.maxQuestionMarks !== undefined) {
        const count = (reply.match(/\?/g) ?? []).length;
        if (count > check.maxQuestionMarks) {
          return fail(
            id,
            `reply ${check.index} has ${count} question marks: "${reply.slice(0, 200)}"`,
          );
        }
      }
      return ok(id, `reply ${check.index}: "${reply.slice(0, 120)}"`);
    }
    case "lead_replies_never": {
      const hits = state.leadReplies.filter((r) =>
        check.mustNotContain.some((s) => r.toLowerCase().includes(s.toLowerCase())),
      );
      if (hits.length > 0)
        return fail(id, `reply contains banned text: "${hits[0]!.slice(0, 160)}"`);
      return ok(id, "no banned text in replies");
    }
    case "recall_trace": {
      const trace = state.recallTraces[0];
      if (!trace) return fail(id, "no recall traces on the lead thread");
      const memoryById = new Map(state.memories.map((m) => [m.id, m]));
      const shownItems = trace.shown
        .map((s) => memoryById.get(s.id))
        .filter((m) => m !== undefined);
      const shownText = shownItems
        .map((m) => `${m.text} ${m.quote ?? ""}`.toLowerCase())
        .join(" | ");
      const missing = check.shownKeywords.filter((k) => !shownText.includes(k.toLowerCase()));
      if (missing.length > 0) {
        return fail(
          id,
          `latest trace (gate=${trace.gate ?? "?"}) shown [${shownItems
            .map((m) => m.text.slice(0, 60))
            .join(" | ")}]; missing [${missing.join(", ")}]; drops=${trace.drops.length}`,
        );
      }
      const leaked = (check.absentKeywords ?? []).filter((k) =>
        shownText.includes(k.toLowerCase()),
      );
      if (leaked.length > 0) {
        return fail(id, `trace showed memory matching banned [${leaked.join(", ")}]`);
      }
      return ok(
        id,
        `trace gate=${trace.gate ?? "?"} shown=${shownItems.length} drops=${trace.drops.length}`,
      );
    }
    case "worker_review": {
      const reviews = state.workerReviews;
      if (reviews.length < check.min) {
        return fail(
          id,
          `reviews=${reviews.length}; records: ${
            reviews.map((r) => `${r.jobId}:${r.status}:r${r.rounds}/${r.maxRounds}`).join(" | ") ||
            "none"
          }`,
        );
      }
      if (check.requireSettled) {
        const active = reviews.filter((r) => r.status === "reviewing" || r.status === "fixing");
        if (active.length > 0) {
          return fail(
            id,
            `still active: ${active.map((r) => `${r.jobId}:${r.status}`).join(" | ")}`,
          );
        }
      }
      if (check.requireFixOrChanges) {
        const worked = reviews.some(
          (r) =>
            r.rounds > 0 ||
            r.status === "changes" ||
            r.verdicts.some((v) => v.verdict === "changes"),
        );
        if (!worked) {
          return fail(
            id,
            `no fix round or changes verdict; verdicts: ${reviews
              .map((r) => `${r.jobId}=[${r.verdicts.map((v) => v.verdict).join(",")}]`)
              .join(" | ")}`,
          );
        }
      }
      return ok(
        id,
        `${reviews.length} review(s): ${reviews
          .map((r) => `${r.status}${r.rounds > 0 ? ` r${r.rounds}` : ""}`)
          .join(", ")}`,
      );
    }
    default:
      return fail(id, "unknown check kind");
  }
}

export { findAsk };
