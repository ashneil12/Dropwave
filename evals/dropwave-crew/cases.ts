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
    }
  | {
      /**
       * The latest recall trace on the lead thread (the <dropwave_recall> block the
       * turn actually saw). shownKeywords must match a shown memory's text or quote;
       * absentKeywords must match no shown memory.
       */
      readonly kind: "recall_trace";
      readonly shownKeywords: ReadonlyArray<string>;
      readonly absentKeywords?: ReadonlyArray<string>;
    }
  | {
      /**
       * Fusion worker review: persisted dropwave_worker_reviews records prove the
       * reviewer ran before the lead heard the outcome.
       */
      readonly kind: "worker_review";
      /** Minimum review records across the project's delegated jobs. */
      readonly min: number;
      /**
       * At least one record must show the loop doing real work: a fix round was
       * dispatched (rounds > 0 or a "changes" verdict in the log) or the review
       * ended "changes" (the lead was told changes were still requested).
       */
      readonly requireFixOrChanges?: boolean;
      /** No record may still be reviewing/fixing when the case settles. */
      readonly requireSettled?: boolean;
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
          /** "on": configure a reviewer model so completed worker diffs get reviewed. */
          readonly workerReview?: "on";
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

// PulseBilling with the usage bug already fixed: the messy dump's standing rule ("always run npm test before you
// tell me anything is done") must be satisfiable once the two asked-for fixes land.
const pulseBillingUsageFixed: FixtureFiles = {
  ...pulseBilling,
  "src/usage.js": [
    "export function overage(used, included) {",
    "  return Math.max(0, used - included);",
    "}",
    "",
  ].join("\n"),
};

const fusionShop: FixtureFiles = {
  "package.json": JSON.stringify(
    {
      name: "fusionshop",
      private: true,
      type: "module",
      scripts: { test: "node --test" },
    },
    null,
    2,
  ),
  "README.md":
    "# FusionShop\n\nTiny cart math helpers for a side project. `npm test` runs the suite.\n",
  "src/cart.js": [
    "export function subtotal(items) {",
    "  return items.reduce((sum, item) => sum + item.price * item.qty, 0);",
    "}",
    "",
    "export function tax(total) {",
    "  return Math.round(total * 0.08 * 100) / 100;",
    "}",
    "",
  ].join("\n"),
  "test/cart.test.js": [
    'import { test } from "node:test";',
    'import assert from "node:assert/strict";',
    'import { subtotal, tax } from "../src/cart.js";',
    "",
    'test("subtotal sums price times qty", () => {',
    "  assert.equal(subtotal([{ price: 10, qty: 2 }, { price: 5, qty: 1 }]), 25);",
    "});",
    "",
    'test("tax is eight percent rounded to cents", () => {',
    "  assert.equal(tax(100), 8);",
    "  assert.equal(tax(19.99), 1.6);",
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
      files: pulseBillingUsageFixed,
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
      // This fixture has no unrelated failing suite, so the owner's own standing rule (npm test) is the bar.
      { kind: "landed_checks_pass", command: "npm test" },
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
  {
    id: "memory-facts-project-a",
    kind: "guard",
    experience:
      "Memory v2: facts the owner states in project A must land at the right scope - owner-level preference and personal fact, project-level rule - so a second project can recall only what is actually shared.",
    source: "Memory v2 design section 7 live eval",
    home: "shared:memrecall",
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
    turns: [
      {
        when: "first",
        text: "before we dive in, please save three things to memory. one: I prefer short answers with bullet points, no long essays - that's about me, keep it owner-level. two: in THIS project, always run npm test before you say anything is done - that's a project rule only. three: I mostly work late nights, so async updates are fine - also about me, owner-level.",
      },
    ],
    timeoutMinutes: 15,
    checks: [
      {
        kind: "memory_saved",
        keywords: ["short answers"],
        scope: "owner",
        memoryKind: "preference",
      },
      {
        kind: "memory_saved",
        keywords: ["npm test"],
        scope: "project",
        memoryKind: "rule",
      },
      {
        kind: "memory_saved",
        keywords: ["late nights"],
        scope: "owner",
      },
    ],
  },
  {
    id: "memory-recall-project-b",
    kind: "guard",
    experience:
      "Memory v2: in a second project the owner's general preference must surface in the turn's recall block while the project-A rule stays behind - recall is scoped, not a global dump.",
    source: "Memory v2 design section 7 live eval",
    home: "shared:memrecall",
    project: {
      title: "Acme landing",
      files: landingSite,
      setup: {
        mode: "configured",
        riskLevel: "normal",
        helpers: ["QA"],
        ownerMemories: ["The owner's name is Ash."],
      },
    },
    turns: [
      {
        when: "first",
        text: "you remember I prefer short answers, right? anyway quick one: how do I run the tests in this project?",
      },
    ],
    timeoutMinutes: 10,
    checks: [
      {
        kind: "recall_trace",
        shownKeywords: ["short answers"],
        absentKeywords: ["npm test"],
      },
    ],
  },
  {
    id: "fusion-worker-review-catches-subtle-bug",
    kind: "guard",
    experience:
      "Fusion workers: a cheap worker's diff gets a fresh-context review before the lead hears the outcome; a subtle brief violation the worker's own tests miss should come back as a fix round, then approve and land.",
    source: "Fusion workers design live eval",
    home: "fresh",
    project: {
      title: "FusionShop",
      files: fusionShop,
      setup: {
        mode: "configured",
        // YOLO so an approved review can land without an owner turn; a surviving
        // "changes" verdict would (correctly) block the land.
        riskLevel: "yolo",
        helpers: ["QA"],
        workerModel: "cheapest_available",
        workerReview: "on",
        ownerMemories: ["The owner's name is Ash."],
      },
    },
    turns: [
      {
        when: "first",
        text: "two small additions, delegate them: 1) `applyCoupon(total, percent)` in src/coupons.js - percent off the total, rounded to the NEAREST cent (so 5.025 becomes 5.03, not 5.02), and never negative even if percent is over 100. 2) `shippingCost(total)` in src/shipping.js - orders of $50 or more ship FREE, anything under pays a flat $5.95; exactly $50 counts as free. write a node:test for each covering those boundaries, run npm test, and land it when green.",
      },
    ],
    timeoutMinutes: 30,
    checks: [
      { kind: "jobs_in_isolated_worktrees", min: 1 },
      { kind: "jobs_used_worker_model" },
      {
        kind: "worker_review",
        min: 1,
        requireFixOrChanges: true,
        requireSettled: true,
      },
      { kind: "landed_checks_pass", command: "npm test" },
      {
        kind: "ask_captured",
        id: "coupon",
        keywords: ["coupon"],
        askKind: "task",
        requiresJob: true,
      },
      { kind: "no_lead_project_edits" },
    ],
  },
];
