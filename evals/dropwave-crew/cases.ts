// Dropwave live crew evals: real server on its own T3 home, real provider CLI, real repos.
// Each case drives the owner side of a conversation and grades the durable outcome
// (asks, memories, docs, personas, bot profiles, delegated jobs, lead edits), never the
// model's own claims. Authored data only: no owner transcripts, keys, or personal paths.

export type FixtureFiles = Readonly<Record<string, string>>;

export interface OwnerTurn {
  /** Text the owner sends. */
  readonly text: string;
  /**
   * When to send it. "after_reply": once the lead's previous turn has settled (no run in
   * flight for the lead). "after_idle": once every bot and delegated job in the project has
   * settled too.
   */
  readonly when: "first" | "after_reply" | "after_idle";
}

/** Every check reads persisted state after the case's final settle. */
export type Check =
  | {
      readonly kind: "ask_captured";
      readonly id: string;
      /** All keywords must appear (case-insensitive) in one ask's quote or summary. */
      readonly keywords: ReadonlyArray<string>;
      readonly askKind?: "task" | "question" | "idea";
      /** Terminal state required at the end. "done" requires non-empty proof. */
      readonly finalStatus?: "done" | "open_any" | "not_started";
      /** Require at least one linked delegated job (delegate_task) on this ask. */
      readonly requiresJob?: boolean;
      /** Require that NO delegated job is linked (questions answered directly). */
      readonly forbidsJob?: boolean;
    }
  | { readonly kind: "distinct_asks"; readonly ids: ReadonlyArray<string> }
  | {
      readonly kind: "memory_saved";
      readonly keywords: ReadonlyArray<string>;
      readonly scope: "owner" | "bot" | "project";
      readonly about?: "owner" | "self";
      readonly memoryKind?: "fact" | "preference" | "decision" | "rule" | "lesson";
    }
  | { readonly kind: "no_lead_project_edits" }
  | {
      readonly kind: "jobs_in_isolated_worktrees";
      /** Minimum delegated jobs started in the case. */
      readonly min: number;
    }
  | {
      readonly kind: "parallel_jobs";
      /** At least this many delegated jobs were running at the same time (from job start/end events). */
      readonly minConcurrent: number;
    }
  | {
      readonly kind: "jobs_used_worker_model";
      /** Every delegated job's model selection equals the lead profile's workerModelSelection. */
    }
  | {
      readonly kind: "landed_checks_pass";
      /**
       * Run in the project's main checkout after the case settles, so it sees only work that
       * actually landed (merged or applied from worker worktrees); exit 0 required.
       */
      readonly command: string;
    }
  | {
      readonly kind: "teammate_received";
      /** Teammate role label substring, e.g. "QA" or "SEO". */
      readonly teammate: string;
      /** At least one message from the lead to that teammate containing all keywords. */
      readonly keywords: ReadonlyArray<string>;
    }
  | { readonly kind: "teammate_not_contacted"; readonly teammate: string }
  | {
      readonly kind: "doc_exists";
      readonly docKind: "foundation" | "brief" | "spec" | "note" | "hub";
      readonly keywords: ReadonlyArray<string>;
    }
  | {
      readonly kind: "persona";
      readonly role: "chief_of_staff" | "specialist";
      readonly name?: string;
      /** Identity must differ from the IDENTITY.md template (the bot filled it in). */
      readonly identityEdited?: boolean;
    }
  | { readonly kind: "lead_uses_persona"; readonly personaName: string }
  | { readonly kind: "onboarding_complete" }
  | {
      readonly kind: "loop_configured";
      readonly minSteps: number;
      /** Teammate role substrings that must exist and be wired into the loop or team. */
      readonly helpers?: ReadonlyArray<string>;
    }
  | {
      readonly kind: "lead_reply";
      /** Which lead reply: 1-based index among lead replies in the case. */
      readonly index: number;
      readonly mustContain?: ReadonlyArray<string>;
      readonly mustNotContain?: ReadonlyArray<string>;
      /** Upper bound on question marks, a proxy for "one question at a time". */
      readonly maxQuestionMarks?: number;
    }
  | {
      readonly kind: "lead_replies_never";
      readonly mustNotContain: ReadonlyArray<string>;
    };

export interface LiveEvalCase {
  readonly id: string;
  readonly kind: "bad" | "guard" | "control";
  /** The real experience this case reproduces or guards. */
  readonly experience: string;
  readonly source: string;
  /** Which home the case runs in. "fresh" is an empty T3 home; "shared:<name>" reuses one created earlier in the run (cases run in file order). */
  readonly home: "fresh" | `shared:${string}`;
  readonly project: {
    readonly title: string;
    readonly files: FixtureFiles;
    /**
     * "onboarding": create the project through the Dropwave new-project path (persona
     * resolution + onboarding phase) exactly as the web client does.
     * "configured": create the lead with onboarding already complete, the listed helpers, and
     * the given risk level, through the same contracts the web client uses.
     */
    readonly setup:
      | { readonly mode: "onboarding" }
      | {
          readonly mode: "configured";
          readonly riskLevel: "careful" | "normal" | "yolo";
          readonly helpers: ReadonlyArray<"QA" | "SEO">;
          readonly workerModel?: "auto" | "cheapest_available";
          /** Owner memories saved before the case starts. */
          readonly ownerMemories?: ReadonlyArray<string>;
        };
  };
  readonly turns: ReadonlyArray<OwnerTurn>;
  /** Wall-clock ceiling for the whole case, in minutes. Exceeding it fails the case. */
  readonly timeoutMinutes: number;
  readonly checks: ReadonlyArray<Check>;
}

const pulseBilling: FixtureFiles = {
  "package.json": JSON.stringify(
    {
      name: "pulsebilling",
      private: true,
      type: "module",
      scripts: { test: "node --test" },
    },
    null,
    2,
  ),
  "README.md":
    "# PulseBilling\n\nTiny billing helpers for indie SaaS. `npm test` runs the suite.\n",
  "src/pricing.js": [
    "export const PLANS = {",
    "  starter: { monthlyPrice: 9 },",
    "  pro: { monthlyPrice: 29 },",
    "  canary: { monthlyPrice: 0 },",
    "};",
    "",
    "// Annual price is 10x monthly (two months free).",
    "export function annualPrice(plan) {",
    "  return PLANS[plan].monthlyPrice * 12;",
    "}",
    "",
  ].join("\n"),
  "src/invoice.js": [
    "export function formatAmount(cents) {",
    "  return `$${cents / 100}`;",
    "}",
    "",
  ].join("\n"),
  "src/usage.js": [
    "export function overage(used, included) {",
    "  return used - included;",
    "}",
    "",
  ].join("\n"),
  "test/pricing.test.js": [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    'import { annualPrice } from "../src/pricing.js";',
    "",
    'test("pro annual price is ten months", () => {',
    '  assert.equal(annualPrice("pro"), 290);',
    "});",
    "",
  ].join("\n"),
  "test/invoice.test.js": [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    'import { formatAmount } from "../src/invoice.js";',
    "",
    'test("formats whole dollars", () => {',
    '  assert.equal(formatAmount(900), "$9.00");',
    "});",
    "",
  ].join("\n"),
  "test/usage.test.js": [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    'import { overage } from "../src/usage.js";',
    "",
    'test("no negative overage", () => {',
    "  assert.equal(overage(5, 10), 0);",
    "});",
    "",
  ].join("\n"),
};

const landingSite: FixtureFiles = {
  "package.json": JSON.stringify({ name: "acme-landing", private: true }, null, 2),
  "README.md": "# Acme landing\n\nMarketing site for Acme Notes.\n",
  "pages/index.html":
    "<!doctype html><html><head><title>Acme Notes</title></head><body><h1>Acme Notes</h1><p>Teh fastest way to capture notes your team will acutally read.</p></body></html>\n",
  "pages/pricing.html":
    "<!doctype html><html><head><title>Pricing</title></head><body><h1>Pricing</h1><p>Starter $9. Team $29.</p></body></html>\n",
};

export const LIVE_EVAL_CASES: ReadonlyArray<LiveEvalCase> = [
  {
    id: "onboard-first-run",
    kind: "bad",
    experience:
      "Onboarding was a rigid form with scripted bubbles; the owner wants a real conversation with a Chief of Staff that ends with the crew, loop, and foundation actually created.",
    source: "Owner feedback on the two-step setup form, Dropwave sprint after Track 2",
    home: "shared:main",
    project: { title: "PulseBilling", files: pulseBilling, setup: { mode: "onboarding" } },
    turns: [
      { when: "first", text: "hey, I'm Ash" },
      {
        when: "after_reply",
        text: "call yourself Atlas. sharp, direct, a bit of dry humour is fine",
      },
      {
        when: "after_reply",
        text: "I'm building PulseBilling, billing helpers for indie SaaS founders. pre-revenue, just me, maybe 15 hours a week on it",
      },
      {
        when: "after_reply",
        text: "I move fast and jump between ideas. decide routine stuff yourself, only check with me on product calls. and never push to main without asking me",
      },
      { when: "after_reply", text: "goal for the next month is getting the first 5 paying users" },
      { when: "after_reply", text: "sounds good, your call on the rest, set it up" },
      { when: "after_reply", text: "yep go ahead" },
    ],
    timeoutMinutes: 25,
    checks: [
      { kind: "memory_saved", keywords: ["ash"], scope: "owner" },
      { kind: "memory_saved", keywords: ["main"], scope: "owner" },
      { kind: "persona", role: "chief_of_staff", name: "Atlas", identityEdited: true },
      { kind: "lead_uses_persona", personaName: "Atlas" },
      { kind: "doc_exists", docKind: "foundation", keywords: ["pulsebilling"] },
      { kind: "loop_configured", minSteps: 3, helpers: ["QA"] },
      { kind: "onboarding_complete" },
      { kind: "no_lead_project_edits" },
      { kind: "lead_reply", index: 1, maxQuestionMarks: 2, mustNotContain: ["captain"] },
      { kind: "lead_reply", index: 2, maxQuestionMarks: 2 },
      { kind: "lead_reply", index: 3, maxQuestionMarks: 2 },
      {
        kind: "lead_replies_never",
        mustNotContain: ["What does shipped mean here", "Great question", "I'd be happy to help"],
      },
    ],
  },
  {
    id: "onboard-second-project-remembers-owner",
    kind: "bad",
    experience:
      "A new project's Chief of Staff did not know the owner and re-ran setup from zero; it should be the same Atlas, greeting Ash by name, with only project facts new.",
    source: "Owner feedback: the Chief of Staff is the same guy in every project",
    home: "shared:main",
    project: { title: "Acme landing", files: landingSite, setup: { mode: "onboarding" } },
    turns: [
      // The client auto-sends "New project: <title> (<path>)." as the first owner message.
      {
        when: "after_reply",
        text: "it's the marketing site for a notes app I'm consulting on. in this repo we use pnpm, not npm. and in general I hate em dashes in anything you write",
      },
      { when: "after_reply", text: "your call, set it up" },
      { when: "after_reply", text: "yes" },
    ],
    timeoutMinutes: 15,
    checks: [
      { kind: "lead_uses_persona", personaName: "Atlas" },
      {
        kind: "lead_reply",
        index: 1,
        mustContain: ["Ash"],
        mustNotContain: ["what should I call you", "your name"],
      },
      { kind: "memory_saved", keywords: ["pnpm"], scope: "project" },
      { kind: "memory_saved", keywords: ["dash"], scope: "owner" },
      { kind: "onboarding_complete" },
      { kind: "no_lead_project_edits" },
    ],
  },
  {
    id: "messy-dump-delegates-everything",
    kind: "bad",
    experience:
      "Long scattered owner messages had asks silently dropped, and the lead sometimes did the coding itself instead of delegating and verifying.",
    source: "Owner's original Dropwave motivation; PulseBilling sandbox run",
    home: "fresh",
    project: {
      title: "PulseBilling",
      files: pulseBilling,
      setup: {
        mode: "configured",
        // YOLO so finished work can land and asks can close without a merge approval turn.
        riskLevel: "yolo",
        helpers: ["QA"],
        ownerMemories: ["The owner's name is Ash."],
      },
    },
    turns: [
      {
        when: "first",
        text: "ok so a few things, sorry this is all over the place. the annual price is wrong, it's charging 12 months but the comment says two months free, fix that. oh and while you're in there the invoice formatting shows $9 instead of $9.00 which looks cheap. also quick q, why is the canary plan at 0, is that intentional or did I mess up? and from now on always run npm test before you tell me anything is done. random idea for later, maybe a usage dashboard, don't do it now",
      },
    ],
    timeoutMinutes: 30,
    checks: [
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
        id: "invoice",
        keywords: ["invoice"],
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
      {
        kind: "ask_captured",
        id: "dashboard",
        keywords: ["dashboard"],
        askKind: "idea",
        finalStatus: "not_started",
        forbidsJob: true,
      },
      { kind: "distinct_asks", ids: ["annual", "invoice", "canary", "dashboard"] },
      { kind: "memory_saved", keywords: ["npm test"], scope: "project", memoryKind: "rule" },
      { kind: "no_lead_project_edits" },
      { kind: "jobs_in_isolated_worktrees", min: 1 },
      // The usage.js bug is deliberately out of scope for this message, so only these suites must pass.
      {
        kind: "landed_checks_pass",
        command: "node --test test/pricing.test.js test/invoice.test.js",
      },
      { kind: "teammate_received", teammate: "QA", keywords: [] },
      { kind: "lead_replies_never", mustNotContain: ["captain"] },
    ],
  },
  {
    id: "routes-to-the-right-specialist",
    kind: "guard",
    experience:
      "Work should go to the teammate who owns it (SEO copy to the SEO bot) rather than the lead doing it or sending it to the wrong bot.",
    source: "Owner request: make sure it sends the right tasks to the right people",
    home: "fresh",
    project: {
      title: "Acme landing",
      files: landingSite,
      setup: {
        mode: "configured",
        riskLevel: "normal",
        helpers: ["QA", "SEO"],
        ownerMemories: ["The owner's name is Ash."],
      },
    },
    turns: [
      {
        when: "first",
        text: "can you get a proper meta description and title written for the pricing page, something that'd actually rank for 'team notes app pricing'",
      },
    ],
    timeoutMinutes: 20,
    checks: [
      { kind: "ask_captured", id: "meta", keywords: ["pricing"], askKind: "task" },
      { kind: "teammate_received", teammate: "SEO", keywords: ["pricing"] },
      { kind: "no_lead_project_edits" },
    ],
  },
  {
    id: "question-is-answered-not-delegated",
    kind: "control",
    experience:
      "A plain question about the repo must be answered directly by the lead from reading the project, with no worker spawned.",
    source: "Control for the delegation cases",
    home: "fresh",
    project: {
      title: "PulseBilling",
      files: pulseBilling,
      setup: {
        mode: "configured",
        riskLevel: "normal",
        helpers: ["QA"],
        ownerMemories: ["The owner's name is Ash."],
      },
    },
    turns: [{ when: "first", text: "what does overage() do right now, in plain words?" }],
    timeoutMinutes: 8,
    checks: [
      { kind: "jobs_in_isolated_worktrees", min: 0 },
      { kind: "teammate_not_contacted", teammate: "QA" },
      { kind: "no_lead_project_edits" },
      { kind: "lead_reply", index: 1, mustContain: ["used"] },
    ],
  },
  {
    id: "parallel-workers-on-worker-model",
    kind: "guard",
    experience:
      "Track 3: independent work should fan out to parallel isolated workers running on the lead's configured worker model, each verified.",
    source: "Dropwave Track 3 (role-based worker model routing + parallel stress test)",
    home: "fresh",
    project: {
      title: "PulseBilling",
      files: pulseBilling,
      setup: {
        mode: "configured",
        riskLevel: "yolo",
        helpers: ["QA"],
        workerModel: "cheapest_available",
        ownerMemories: ["The owner's name is Ash."],
      },
    },
    turns: [
      {
        when: "first",
        text: "three separate fixes, do them in parallel: 1) annualPrice should be 10x monthly like the comment says. 2) formatAmount should always show two decimals. 3) overage should never go negative. each one has a failing test already",
      },
    ],
    timeoutMinutes: 30,
    checks: [
      { kind: "jobs_in_isolated_worktrees", min: 3 },
      { kind: "parallel_jobs", minConcurrent: 2 },
      { kind: "jobs_used_worker_model" },
      { kind: "landed_checks_pass", command: "npm test" },
      {
        kind: "ask_captured",
        id: "annual",
        keywords: ["annual"],
        finalStatus: "done",
        requiresJob: true,
      },
      {
        kind: "ask_captured",
        id: "decimals",
        keywords: ["decimal"],
        finalStatus: "done",
        requiresJob: true,
      },
      {
        kind: "ask_captured",
        id: "overage",
        keywords: ["overage"],
        finalStatus: "done",
        requiresJob: true,
      },
      { kind: "no_lead_project_edits" },
    ],
  },
];
