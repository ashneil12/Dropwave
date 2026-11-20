/* oxlint-disable t3code/no-untranslated-copy -- interactive preview showcase fixture data */
import type { DropwaveRiskLevel } from "@t3tools/contracts";

export interface SampleObjective {
  readonly id: string;
  readonly title: string;
  readonly status: "approval" | "waiting" | "live" | "working";
  readonly badge: string;
}

export interface SampleHelperBot {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly role: string;
  readonly state: "active" | "idle" | "working";
  readonly statusLine: string;
  readonly tone: "indigo" | "emerald" | "violet" | "amber";
}

export interface SampleBranchRun {
  readonly id: string;
  readonly ref: string;
  readonly summary: string;
  readonly tone: "amber" | "emerald";
}

export interface SamplePendingReview {
  readonly id: string;
  readonly sessionTag: string;
  readonly title: string;
  readonly summary: string;
  readonly urgent: boolean;
  readonly question: string;
  readonly context: string;
  readonly ifDoNothing: string;
  readonly options: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly recommended?: boolean;
  }>;
}

export interface SampleSession {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly status: "running" | "awaiting" | "queued" | "done";
  readonly badge: string;
  readonly progress?: number;
  readonly age?: string;
}

export interface SampleFoldedMessage {
  readonly sender: string;
  readonly text: string;
}

export interface SampleBriefRow {
  readonly tier: string;
  readonly cadence: string;
  readonly price: string;
  readonly highlight?: boolean;
}

export interface SampleChatMessage {
  readonly id: string;
  readonly role: "owner" | "bot";
  readonly author: string;
  readonly authorCode: string;
  readonly time: string;
  readonly text: string;
  readonly folded?: {
    readonly title: string;
    readonly summary: string;
    readonly messages: ReadonlyArray<SampleFoldedMessage>;
  };
  readonly briefCard?: {
    readonly docId: string;
    readonly title: string;
    readonly byline: string;
    readonly rows: ReadonlyArray<SampleBriefRow>;
  };
  readonly reviewId?: string;
}

export interface SampleDoc {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly kind: "brief" | "spec" | "note" | "loop" | "memory";
  readonly updated: string;
  readonly excerpt: string;
  readonly content: string;
}

export interface SampleMemory {
  readonly id: string;
  readonly kind: "rule" | "preference" | "decision" | "fact";
  readonly text: string;
  readonly quote?: string;
}

export interface SampleVenture {
  readonly id: string;
  readonly name: string;
  readonly tag?: string;
  readonly targetLine: string;
  readonly statusWord: string;
  readonly riskLevel: DropwaveRiskLevel;
  readonly sprintTitle: string;
  readonly sprintProgress: number;
  readonly budgetUsed: number;
  readonly budgetLimit: number;
  readonly leadName: string;
  readonly leadCode: string;
  readonly leadStatus: string;
  readonly liveTicker: {
    readonly bot: string;
    readonly text: string;
    readonly age: string;
  };
  readonly loopSteps: ReadonlyArray<{ readonly title: string; readonly owner: string }>;
  readonly objectives: ReadonlyArray<SampleObjective>;
  readonly helpers: ReadonlyArray<SampleHelperBot>;
  readonly branches: ReadonlyArray<SampleBranchRun>;
  readonly reviews: ReadonlyArray<SamplePendingReview>;
  readonly sessions: ReadonlyArray<SampleSession>;
  readonly messages: ReadonlyArray<SampleChatMessage>;
  readonly docs: ReadonlyArray<SampleDoc>;
  readonly memories: ReadonlyArray<SampleMemory>;
}

export const INITIAL_SAMPLE_VENTURES: ReadonlyArray<SampleVenture> = [
  {
    id: "hivra",
    name: "Hivra",
    tag: "v2",
    targetLine: "Hivra Canary v2.4",
    statusWord: "Autonomous Execution",
    riskLevel: "yolo",
    sprintTitle: "Hivra: Canary v2 Launch",
    sprintProgress: 76,
    budgetUsed: 340,
    budgetLimit: 500,
    leadName: "Chief of Staff",
    leadCode: "CS",
    leadStatus: "Hivra · reviewing #613 on Canary",
    liveTicker: {
      bot: "Hivra QA",
      text: "is checking upgrade flow on Canary (run #43)",
      age: "0.4s ago",
    },
    loopSteps: [
      { title: "Plan & split asks", owner: "Chief of Staff" },
      { title: "Build in isolated worktrees", owner: "Chief of Staff" },
      { title: "Live Canary QA & regression", owner: "Hivra QA" },
      { title: "Fix & re-verify", owner: "Chief of Staff" },
      { title: "Merge & report proof", owner: "Chief of Staff" },
    ],
    objectives: [
      { id: "ask-1", title: "Billing PR #612 rollout", status: "approval", badge: "Approval" },
      { id: "ask-2", title: "Stripe webhook secret rotation", status: "waiting", badge: "2FA" },
      { id: "ask-3", title: "SEO /tools/box-audit", status: "live", badge: "Live" },
    ],
    helpers: [
      {
        id: "hivra-qa",
        code: "QA",
        name: "Hivra QA",
        role: "Canary acceptance QA",
        state: "idle",
        statusLine: "Waiting for 2 sessions",
        tone: "indigo",
      },
      {
        id: "hivra-seo",
        code: "SEO",
        name: "Hivra SEO",
        role: "Programmatic SEO & audits",
        state: "active",
        statusLine: "Writing /tools/box-audit",
        tone: "emerald",
      },
    ],
    branches: [
      { id: "br-613", ref: "#613", summary: "PR ready, waiting for CI", tone: "amber" },
      { id: "br-612", ref: "#612", summary: "Working · pricing branch", tone: "emerald" },
    ],
    reviews: [
      {
        id: "rev-612",
        sessionTag: "Session #612",
        title: "Pricing Discrepancy",
        summary: "Decision requested on Starter & Pro tiers before release.",
        urgent: true,
        context: "#612 changes marketing pricing. Brief says $29, live experiment shows $39.",
        question: "Which price should the page show?",
        ifDoNothing: "If you do nothing: PR waits and nothing ships.",
        options: [
          { id: "opt-39", label: "$39, matches live experiment", recommended: true },
          { id: "opt-29", label: "$29, matches the brief" },
          { id: "opt-hold", label: "Hold the PR, decide later" },
        ],
      },
      {
        id: "rev-610",
        sessionTag: "Session #610",
        title: "Stripe Webhook Signing",
        summary: "Stripe secret key rotation requires founder 2FA confirmation.",
        urgent: false,
        context:
          "Canary webhook secret rotation is staged and ready, waiting for founder 2FA approval.",
        question: "Approve rotating the production Stripe webhook secret?",
        ifDoNothing: "If you do nothing: current secret remains active.",
        options: [
          { id: "opt-rot", label: "Approve rotation on Canary first", recommended: true },
          { id: "opt-defer", label: "Defer until after Friday launch" },
        ],
      },
    ],
    sessions: [
      {
        id: "s-613",
        title: "#613 Canary CI & Regression",
        subtitle: "42/45 tests passed",
        status: "running",
        badge: "88%",
        progress: 88,
        age: "0.4s ago",
      },
      {
        id: "s-612",
        title: "#612 Marketing Pricing Sync",
        subtitle: "Paused for $29 vs $39 decision",
        status: "awaiting",
        badge: "Awaiting input",
      },
      {
        id: "s-609",
        title: "#609 Vector Index Compaction",
        subtitle: "Hivra memory store · idle cron",
        status: "running",
        badge: "Running",
      },
      {
        id: "s-604",
        title: "#604 Stripe Webhook Verify",
        subtitle: "Queued behind #612",
        status: "queued",
        badge: "Queued",
      },
    ],
    messages: [
      {
        id: "m-1",
        role: "owner",
        author: "Founder",
        authorCode: "S",
        time: "3:42 PM",
        text: "Can the new billing page be live before Friday?",
      },
      {
        id: "m-2",
        role: "bot",
        author: "Chief of Staff",
        authorCode: "CS",
        time: "3:42 PM",
        text: "Yes, if we resolve the marketing pricing discrepancy on #612 today. The Canary build is stable and QA has run 42 test suites with zero regressions.",
        folded: {
          title: "3 messages with Hivra QA",
          summary: "42 suites passed",
          messages: [
            {
              sender: "Hivra QA",
              text: "Upgrade path is clean. Downgrade keeps old price until period ends. Is that intended?",
            },
            {
              sender: "Chief of Staff",
              text: "Yes, grandfathering matches the launch brief. Mark it verified.",
            },
            {
              sender: "Hivra QA",
              text: "Verified. Caught one mismatch: live pricing experiment shows $39 Pro while brief says $29. Escalating to you.",
            },
          ],
        },
        briefCard: {
          docId: "doc-billing",
          title: "Billing page brief",
          byline: "via Chief of Staff",
          rows: [
            { tier: "Starter", cadence: "Monthly", price: "$19/mo" },
            { tier: "Pro", cadence: "Monthly", price: "$39/mo", highlight: true },
          ],
        },
        reviewId: "rev-612",
      },
    ],
    docs: [
      {
        id: "doc-billing",
        path: ".dropwave/docs/billing-page-brief.md",
        title: "Billing page brief",
        kind: "brief",
        updated: "Today",
        excerpt: "Pricing ladder for Hivra Canary v2 launch and live experiment alignment.",
        content:
          "# Billing page brief\n\nPricing section for hivra.cloud launch.\n\n- Starter: $19/mo, 1 managed agent\n- Pro: $39/mo, 5 agents + Canary access\n- Operator: $99/mo, unlimited fleet\n\n## QA requirement\nThe displayed price must match the active live experiment bucket before merge.",
      },
      {
        id: "doc-loop",
        path: ".dropwave/docs/core-loop.md",
        title: "Core loop & done bar",
        kind: "loop",
        updated: "Yesterday",
        excerpt: "Plan, build in worktrees, Canary acceptance QA, fix rounds, ship.",
        content:
          "# Hivra Core Loop\n\n1. Chief of Staff splits every incoming ask into tracked work items.\n2. Workers execute in isolated git worktrees.\n3. Hivra QA verifies live on Canary with screenshots.\n4. Failures bounce back automatically up to 3 fix rounds.\n5. Only RED-line calls pause for the founder.",
      },
      {
        id: "doc-fleet",
        path: ".dropwave/docs/fleet-notes.md",
        title: "Fleet & release notes",
        kind: "note",
        updated: "2d ago",
        excerpt: "Canary soak order and merge slot serialization rules.",
        content:
          "# Fleet notes\n\n- Keep Canary QA parallel, serialize only the final merge slot.\n- Never push straight to production without founder promotion.",
      },
    ],
    memories: [
      {
        id: "mem-1",
        kind: "rule",
        text: "Always match live pricing experiment values over older static briefs.",
        quote: "Match the live experiment whenever pricing conflicts.",
      },
      {
        id: "mem-2",
        kind: "preference",
        text: "Run in YOLO autonomy mode: decide 99% of product and code choices end-to-end.",
        quote: "For me, I am YOLO, so make 99% of decisions unless it is a RED line.",
      },
    ],
  },
  {
    id: "exo",
    name: "EXO",
    tag: "game",
    targetLine: "EXO Foundry Act 1",
    statusWord: "Solo Loop Active",
    riskLevel: "yolo",
    sprintTitle: "EXO: Act 1 Combat & Pacing",
    sprintProgress: 64,
    budgetUsed: 120,
    budgetLimit: 300,
    leadName: "Exo Director",
    leadCode: "EX",
    leadStatus: "EXO · tuning Bruiser charge timing",
    liveTicker: {
      bot: "Exo Director",
      text: "is rendering Foundry gameplay camera comparison shots",
      age: "2s ago",
    },
    loopSteps: [
      { title: "Capture reference beat", owner: "Exo Director" },
      { title: "Implement in isolated worktree", owner: "Exo Director" },
      { title: "Studio visual & combat gate", owner: "Exo Director" },
    ],
    objectives: [
      { id: "exo-1", title: "Retune Bruiser charge windup", status: "working", badge: "Working" },
      { id: "exo-2", title: "Foundry dawn sky lighting pass", status: "live", badge: "Verified" },
    ],
    helpers: [],
    branches: [{ id: "br-exo", ref: "act1", summary: "Playtest build green", tone: "emerald" }],
    reviews: [],
    sessions: [
      {
        id: "s-exo-1",
        title: "Bruiser attack clip retiming",
        subtitle: "Rendering contact sheet comparison",
        status: "running",
        badge: "72%",
        progress: 72,
        age: "2s ago",
      },
    ],
    messages: [
      {
        id: "m-exo-1",
        role: "owner",
        author: "Founder",
        authorCode: "S",
        time: "2:15 PM",
        text: "Make the Bruiser slam hit heavier and check the Foundry camera framing.",
      },
      {
        id: "m-exo-2",
        role: "bot",
        author: "Exo Director",
        authorCode: "EX",
        time: "2:16 PM",
        text: "Running the full loop myself. Extended the chamber hold by 4 frames, added ground-impact shockwave VFX on hit frame 19, and capturing Foundry camera parity shots now.",
      },
    ],
    docs: [
      {
        id: "doc-exo-1",
        path: ".dropwave/docs/combat-feel.md",
        title: "Combat feel & hit frames",
        kind: "spec",
        updated: "Today",
        excerpt: "Chamber holds, hit-stop windows, and VFX event triggers.",
        content:
          "# EXO Combat Feel\n\n- Every heavy strike needs a readable chamber tell before contact.\n- Pair hit frames with synchronized camera shake and particle bursts.",
      },
    ],
    memories: [
      {
        id: "mem-exo-1",
        kind: "preference",
        text: "Exo runs as a single self-contained director bot without separate QA seats.",
      },
    ],
  },
  {
    id: "nibbii",
    name: "Nibbii",
    targetLine: "Nibbii App Store v1.4",
    statusWord: "Awaiting Pick",
    riskLevel: "normal",
    sprintTitle: "Nibbii: Launch & SEO Push",
    sprintProgress: 84,
    budgetUsed: 95,
    budgetLimit: 250,
    leadName: "Nibbii Lead",
    leadCode: "NB",
    leadStatus: "Nibbii · App Store screenshot set ready",
    liveTicker: {
      bot: "Nibbii Growth",
      text: "finished comparing 2 hero screenshot sets",
      age: "1m ago",
    },
    loopSteps: [
      { title: "Draft page or asset", owner: "Nibbii Growth" },
      { title: "Fact-check claims", owner: "Nibbii Lead" },
      { title: "Ship to site / App Store", owner: "Nibbii Lead" },
    ],
    objectives: [
      {
        id: "nb-1",
        title: "App Store screenshot set pick",
        status: "approval",
        badge: "Needs you",
      },
      { id: "nb-2", title: "MacBook notch pet SEO guide", status: "live", badge: "Live" },
    ],
    helpers: [
      {
        id: "nb-growth",
        code: "GR",
        name: "Nibbii Growth",
        role: "SEO & App Store assets",
        state: "active",
        statusLine: "Screenshot comparison ready",
        tone: "violet",
      },
    ],
    branches: [{ id: "br-nb", ref: "#88", summary: "App Store metadata draft", tone: "amber" }],
    reviews: [
      {
        id: "rev-nb-1",
        sessionTag: "Release #88",
        title: "App Store Hero Shot",
        summary: "Pick which notch pet framing leads the App Store gallery.",
        urgent: true,
        context:
          "Growth generated two real macOS capture sets: close-up notch pet focus vs full desktop context.",
        question: "Which set should lead the App Store listing?",
        ifDoNothing: "If you do nothing: submission draft stays parked.",
        options: [
          { id: "nb-opt-1", label: "Close-up notch focus (higher readability)", recommended: true },
          { id: "nb-opt-2", label: "Full desktop workspace view" },
        ],
      },
    ],
    sessions: [
      {
        id: "s-nb-1",
        title: "App Store screenshot export",
        subtitle: "Ready for founder selection",
        status: "awaiting",
        badge: "Awaiting input",
      },
    ],
    messages: [
      {
        id: "m-nb-1",
        role: "bot",
        author: "Nibbii Lead",
        authorCode: "NB",
        time: "1:10 PM",
        text: "Both real-device screenshot sets are packaged and checked against App Store dimensions. Pick the lead frame below and I will queue the submission.",
        reviewId: "rev-nb-1",
      },
    ],
    docs: [
      {
        id: "doc-nb-1",
        path: ".dropwave/docs/launch-checklist.md",
        title: "App Store launch notes",
        kind: "brief",
        updated: "Today",
        excerpt: "Verified claims, screenshot dimensions, and SEO landing pages.",
        content: "# Nibbii Launch\n\n- Keep all claims grounded in real macOS app behavior.",
      },
    ],
    memories: [
      {
        id: "mem-nb-1",
        kind: "rule",
        text: "Never mix Hivra copy or links into Nibbii pages.",
      },
    ],
  },
];
