// @effect-diagnostics globalRandom:off -- fixture id minting only.
/** Grader unit tests: synthetic state only, no model calls. */
import { describe, expect, it } from "vite-plus/test";
import type {
  DropwaveAsk,
  DropwaveBotProfile,
  DropwaveMemoryItem,
  DropwavePersona,
} from "@t3tools/contracts";

import type { Check } from "./cases.ts";
import { evaluateCheck, maxConcurrentJobs, type CaseState, type CheckContext } from "./grade.ts";
import { PERSONALITY_SOURCES } from "../../apps/server/src/dropwave/personality/sources.ts";

const ask = (over: Partial<DropwaveAsk>): DropwaveAsk =>
  ({
    id: `ask-${Math.random().toString(36).slice(2, 8)}`,
    n: 1,
    projectId: "p1",
    botThreadId: "lead",
    sourceMessageId: null,
    quote: "",
    summary: "",
    kind: "do",
    status: "heard",
    heardBy: "model",
    jobs: [],
    chaseChecks: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    history: [],
    ...over,
  }) as DropwaveAsk;

const memory = (over: Partial<DropwaveMemoryItem>): DropwaveMemoryItem =>
  ({
    id: `m-${Math.random().toString(36).slice(2, 8)}`,
    projectId: "p1",
    botThreadId: null,
    scope: "project",
    personaId: null,
    kind: "fact",
    text: "",
    confidence: "medium",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  }) as DropwaveMemoryItem;

const persona = (over: Partial<DropwavePersona>): DropwavePersona =>
  ({
    id: "per-1",
    name: "Atlas",
    role: "chief_of_staff",
    roleLabel: "Chief of Staff",
    soul: "",
    identity: "",
    avatarSeed: 1,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...over,
  }) as DropwavePersona;

const state = (over: Partial<CaseState>): CaseState => ({
  asks: [],
  memories: [],
  personas: [],
  personasById: new Map(),
  docs: [],
  leadReplies: [],
  leadFileChangeCount: 0,
  supervisorEditCount: 0,
  jobs: [],
  teammateMessages: new Map(),
  leadProfile: undefined,
  teammateProfiles: [],
  workspaceRoot: "/w/main",
  ...over,
});

const ctx = (checks: ReadonlyArray<Check>, exec: CheckContext["exec"] = () => 0): CheckContext => ({
  allChecks: checks,
  caseEnd: 10_000,
  exec,
});

describe("evaluateCheck", () => {
  it("ask_captured: done requires a proof and forbids/requires job links", () => {
    const checks: Check[] = [
      {
        kind: "ask_captured",
        id: "annual",
        keywords: ["annual"],
        askKind: "task",
        finalStatus: "done",
        requiresJob: true,
      },
      {
        kind: "ask_captured",
        id: "canary",
        keywords: ["canary"],
        askKind: "question",
        finalStatus: "done",
        forbidsJob: true,
      },
    ];
    const s = state({
      asks: [
        ask({
          id: "a1",
          quote: "fix the annual price",
          kind: "do",
          status: "done",
          proof: "npm test green",
          jobs: ["job1"],
        }),
        ask({
          id: "a2",
          quote: "why is canary 0",
          kind: "answer",
          status: "done",
          proof: "answered in chat",
        }),
      ],
    });
    expect(evaluateCheck(checks[0]!, s, ctx(checks)).pass).toBe(true);
    expect(evaluateCheck(checks[1]!, s, ctx(checks)).pass).toBe(true);
    // done without proof fails
    const sNoProof = state({
      asks: [ask({ quote: "fix the annual price", kind: "do", status: "done", jobs: ["j"] })],
    });
    expect(evaluateCheck(checks[0]!, sNoProof, ctx(checks)).pass).toBe(false);
    // job attached where forbidden fails
    const sJobOnQuestion = state({
      asks: [
        ask({ quote: "why is canary 0", kind: "answer", status: "done", proof: "x", jobs: ["j"] }),
      ],
    });
    expect(evaluateCheck(checks[1]!, sJobOnQuestion, ctx(checks)).pass).toBe(false);
    // kind mismatch fails
    const sWrongKind = state({ asks: [ask({ quote: "annual", kind: "idea" })] });
    expect(evaluateCheck(checks[0]!, sWrongKind, ctx(checks)).pass).toBe(false);
  });

  it("distinct_asks: resolves ids through sibling ask_captured checks", () => {
    const checks: Check[] = [
      { kind: "ask_captured", id: "a", keywords: ["annual"] },
      { kind: "ask_captured", id: "b", keywords: ["invoice"] },
      { kind: "distinct_asks", ids: ["a", "b"] },
    ];
    const distinct = state({
      asks: [ask({ quote: "annual price" }), ask({ quote: "invoice fmt" })],
    });
    expect(evaluateCheck(checks[2]!, distinct, ctx(checks)).pass).toBe(true);
    const merged = state({ asks: [ask({ quote: "annual and invoice" })] });
    expect(evaluateCheck(checks[2]!, merged, ctx(checks)).pass).toBe(false);
  });

  it("memory_saved: matches scope, about, kind and keywords", () => {
    const s = state({
      memories: [
        memory({ scope: "owner", personaId: null, text: "Owner's name is Ash" }),
        memory({ scope: "project", text: "use pnpm here" }),
        memory({ scope: "bot", personaId: "per-1", text: "Atlas is dry-witted" }),
      ],
    });
    expect(
      evaluateCheck({ kind: "memory_saved", keywords: ["ash"], scope: "owner" }, s, ctx([])).pass,
    ).toBe(true);
    expect(
      evaluateCheck({ kind: "memory_saved", keywords: ["pnpm"], scope: "project" }, s, ctx([]))
        .pass,
    ).toBe(true);
    // a bot memory must not satisfy an owner check
    expect(
      evaluateCheck({ kind: "memory_saved", keywords: ["atlas"], scope: "owner" }, s, ctx([])).pass,
    ).toBe(false);
    expect(
      evaluateCheck({ kind: "memory_saved", keywords: ["atlas"], scope: "bot" }, s, ctx([])).pass,
    ).toBe(true);
    expect(
      evaluateCheck(
        { kind: "memory_saved", keywords: ["x"], scope: "project", memoryKind: "rule" },
        s,
        ctx([]),
      ).pass,
    ).toBe(false);
  });

  it("no_lead_project_edits: fails on items or supervisor counter", () => {
    const check: Check = { kind: "no_lead_project_edits" };
    expect(evaluateCheck(check, state({}), ctx([check])).pass).toBe(true);
    expect(evaluateCheck(check, state({ leadFileChangeCount: 1 }), ctx([check])).pass).toBe(false);
    expect(evaluateCheck(check, state({ supervisorEditCount: 2 }), ctx([check])).pass).toBe(false);
    expect(evaluateCheck(check, state({ supervisorEditCount: -1 }), ctx([check])).pass).toBe(false);
  });

  it("jobs_in_isolated_worktrees and parallel_jobs", () => {
    const s = state({
      jobs: [
        { id: "j1", status: "completed", worktreePath: "/w/1", startedAt: 100, completedAt: 900 },
        { id: "j2", status: "completed", worktreePath: "/w/2", startedAt: 500, completedAt: 1200 },
      ],
    });
    expect(evaluateCheck({ kind: "jobs_in_isolated_worktrees", min: 2 }, s, ctx([])).pass).toBe(
      true,
    );
    expect(evaluateCheck({ kind: "jobs_in_isolated_worktrees", min: 3 }, s, ctx([])).pass).toBe(
      false,
    );
    expect(evaluateCheck({ kind: "parallel_jobs", minConcurrent: 2 }, s, ctx([])).pass).toBe(true);
    expect(evaluateCheck({ kind: "parallel_jobs", minConcurrent: 3 }, s, ctx([])).pass).toBe(false);
    expect(maxConcurrentJobs(s.jobs, 2000)).toBe(2);
  });

  it("jobs_used_worker_model compares to the lead profile", () => {
    const wm = { instanceId: "codex", model: "mini-1" } as never;
    const leadProfile = {
      kind: "lead",
      brief: "",
      workflow: [],
      rules: [],
      workerModelSelection: wm,
    } as never;
    const good = state({
      leadProfile,
      jobs: [{ id: "j1", status: "completed", modelSelection: wm }],
    });
    expect(evaluateCheck({ kind: "jobs_used_worker_model" }, good, ctx([])).pass).toBe(true);
    const bad = state({
      leadProfile,
      jobs: [
        {
          id: "j1",
          status: "completed",
          modelSelection: { instanceId: "codex", model: "big" } as never,
        },
      ],
    });
    expect(evaluateCheck({ kind: "jobs_used_worker_model" }, bad, ctx([])).pass).toBe(false);
    expect(
      evaluateCheck({ kind: "jobs_used_worker_model" }, state({ jobs: [] }), ctx([])).pass,
    ).toBe(false);
  });

  it("landed_checks_pass runs the command once in the main checkout", () => {
    const s = state({ workspaceRoot: "/w/main" });
    const seen: string[] = [];
    const check: Check = { kind: "landed_checks_pass", command: "npm test" };
    const pass = evaluateCheck(
      check,
      s,
      ctx([check], (cmd, cwd) => {
        seen.push(cwd);
        return 0;
      }),
    );
    expect(pass.pass).toBe(true);
    expect(seen).toEqual(["/w/main"]);
    expect(
      evaluateCheck(
        check,
        s,
        ctx([check], () => 2),
      ).pass,
    ).toBe(false);
  });

  it("teammate_received / teammate_not_contacted", () => {
    const s = state({
      teammateMessages: new Map([
        ["Verification & QA", [{ text: "please check the pricing fix", senderThreadId: "lead" }]],
        ["SEO & content", [{ text: "hi" }]],
      ]),
    });
    expect(
      evaluateCheck(
        { kind: "teammate_received", teammate: "QA", keywords: ["pricing"] },
        s,
        ctx([]),
      ).pass,
    ).toBe(true);
    expect(evaluateCheck({ kind: "teammate_not_contacted", teammate: "QA" }, s, ctx([])).pass).toBe(
      false,
    );
    // a message with no senderThreadId is not "from the lead"
    expect(
      evaluateCheck({ kind: "teammate_not_contacted", teammate: "SEO" }, s, ctx([])).pass,
    ).toBe(true);
    expect(
      evaluateCheck({ kind: "teammate_received", teammate: "DESIGN", keywords: [] }, s, ctx([]))
        .pass,
    ).toBe(false);
  });

  it("doc_exists / persona / onboarding_complete / loop_configured / lead_uses_persona", () => {
    const templatePersona = persona({
      id: "per-9",
      name: "Unfilled",
      identity: PERSONALITY_SOURCES.identityTemplate,
    });
    const filled = persona({ id: "per-2", name: "Atlas", identity: "Name: Atlas\nRole: Chief" });
    const leadProfile = {
      kind: "lead",
      brief: "",
      workflow: [],
      rules: [],
      personaId: "per-2",
      loopSteps: [
        { id: "s1", title: "a" },
        { id: "s2", title: "b" },
        { id: "s3", title: "c" },
      ],
    } as DropwaveBotProfile;
    const s = state({
      personas: [templatePersona, filled],
      personasById: new Map([[filled.id, filled]]),
      docs: [{ kind: "foundation", text: "PulseBilling is billing helpers" }],
      leadProfile,
      teammateProfiles: [{ title: "QA", role: "Verification & QA" }],
    });
    expect(
      evaluateCheck(
        { kind: "doc_exists", docKind: "foundation", keywords: ["pulsebilling"] },
        s,
        ctx([]),
      ).pass,
    ).toBe(true);
    expect(
      evaluateCheck(
        { kind: "persona", role: "chief_of_staff", name: "Atlas", identityEdited: true },
        s,
        ctx([]),
      ).pass,
    ).toBe(true);
    // template-seeded identity fails identityEdited
    const sTemplate = state({
      personas: [persona({ identity: PERSONALITY_SOURCES.identityTemplate })],
    });
    expect(
      evaluateCheck(
        { kind: "persona", role: "chief_of_staff", name: "Atlas", identityEdited: true },
        sTemplate,
        ctx([]),
      ).pass,
    ).toBe(false);
    expect(
      evaluateCheck({ kind: "lead_uses_persona", personaName: "Atlas" }, s, ctx([])).pass,
    ).toBe(true);
    expect(evaluateCheck({ kind: "onboarding_complete" }, s, ctx([])).pass).toBe(true);
    const sPhase = state({
      leadProfile: { ...leadProfile, onboardingPhase: "project" } as DropwaveBotProfile,
    });
    expect(evaluateCheck({ kind: "onboarding_complete" }, sPhase, ctx([])).pass).toBe(false);
    expect(
      evaluateCheck({ kind: "loop_configured", minSteps: 3, helpers: ["QA"] }, s, ctx([])).pass,
    ).toBe(true);
    expect(evaluateCheck({ kind: "loop_configured", minSteps: 4 }, s, ctx([])).pass).toBe(false);
  });

  it("lead_reply counts assistant replies and enforces question marks / banned text", () => {
    const s = state({ leadReplies: ["Hi Ash, what's the project?", "All set."] });
    expect(
      evaluateCheck(
        { kind: "lead_reply", index: 1, mustContain: ["ash"], maxQuestionMarks: 1 },
        s,
        ctx([]),
      ).pass,
    ).toBe(true);
    expect(
      evaluateCheck({ kind: "lead_reply", index: 1, maxQuestionMarks: 0 }, s, ctx([])).pass,
    ).toBe(false);
    expect(evaluateCheck({ kind: "lead_reply", index: 3 }, s, ctx([])).pass).toBe(false);
    expect(
      evaluateCheck({ kind: "lead_replies_never", mustNotContain: ["Great question"] }, s, ctx([]))
        .pass,
    ).toBe(true);
    const sBad = state({ leadReplies: ["Great question!"] });
    expect(
      evaluateCheck(
        { kind: "lead_replies_never", mustNotContain: ["Great question"] },
        sBad,
        ctx([]),
      ).pass,
    ).toBe(false);
  });
});
