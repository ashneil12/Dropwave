import {
  DropwaveAskKind,
  DropwaveAskStatus,
  DropwaveDocKind,
  DropwaveLoopStep,
  DropwaveMemoryConfidence,
  DropwaveMemoryKind,
  DropwaveMemoryScope,
  DropwaveRiskLevel,
  OrchestratorMcpFailure,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as DropwaveDocsService from "../../../dropwave/DropwaveDocsService.ts";
import * as DropwaveStore from "../../../dropwave/DropwaveStore.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const baseDeps = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
];

const DropwaveAsksTool = Tool.make("dropwave_asks", {
  description:
    "Track the owner's asks so nothing is lost. list: open asks for this bot. update: set status (started, waiting with note, done with proof; only the owner can drop). link_job: attach delegated taskId to askIds.",
  parameters: Schema.Struct({
    action: Schema.Literals(["list", "update", "link_job"]),
    askId: Schema.optional(TrimmedNonEmptyString),
    askIds: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
    jobId: Schema.optional(TrimmedNonEmptyString),
    title: Schema.optional(Schema.String),
    status: Schema.optional(DropwaveAskStatus),
    note: Schema.optional(Schema.NullOr(Schema.String)),
    proof: Schema.optional(Schema.NullOr(Schema.String)),
    includeClosed: Schema.optional(Schema.Boolean),
  }),
  success: Schema.Record(Schema.String, Schema.Unknown),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [...baseDeps, DropwaveStore.DropwaveStore],
})
  .annotate(Tool.Title, "Track Dropwave asks")
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const DropwaveMemoryTool = Tool.make("dropwave_memory", {
  description:
    "Memory and chat summary tree. list/search: durable facts, rules, and preferences. save: record a durable fact (scope: project or global; about: owner or self, global only; include the owner's quote when known). zoom: expand a summary tree nodeId. search_tree: search older summarized chat history.",
  parameters: Schema.Struct({
    action: Schema.Literals(["list", "search", "save", "zoom", "search_tree"]),
    query: Schema.optional(Schema.String),
    kind: Schema.optional(DropwaveMemoryKind),
    scope: Schema.optional(DropwaveMemoryScope),
    about: Schema.optional(Schema.Literals(["owner", "self"])),
    text: Schema.optional(TrimmedNonEmptyString),
    quote: Schema.optional(Schema.String),
    confidence: Schema.optional(DropwaveMemoryConfidence),
    nodeId: Schema.optional(TrimmedNonEmptyString),
  }),
  success: Schema.Record(Schema.String, Schema.Unknown),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [...baseDeps, DropwaveStore.DropwaveStore],
})
  .annotate(Tool.Title, "Use Dropwave memory")
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const DropwaveDocsTool = Tool.make("dropwave_docs", {
  description:
    "Read and write this project's Dropwave docs (briefs, specs, notes, core loop). list, read by path, or write title + content (defaults into .dropwave/docs/).",
  parameters: Schema.Struct({
    action: Schema.Literals(["list", "read", "write"]),
    path: Schema.optional(TrimmedNonEmptyString),
    title: Schema.optional(TrimmedNonEmptyString),
    kind: Schema.optional(DropwaveDocKind),
    content: Schema.optional(Schema.String),
  }),
  success: Schema.Record(Schema.String, Schema.Unknown),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [...baseDeps, DropwaveDocsService.DropwaveDocsService],
})
  .annotate(Tool.Title, "Read and write Dropwave docs")
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const DropwaveTeamTool = Tool.make("dropwave_team", {
  description:
    "Inspect or configure this project's Dropwave team, crew personas, and core loop (Lead bot only for writes). list: bots and loop. list_crew: global personas and which projects use each. update_identity: update your own persona (name, roleLabel, soul, identity). complete_onboarding: finish lead onboarding for this project. configure_loop: update brief, loopSteps, doneDefinition, riskLevel, fixRoundCap, or addRule. upsert_helper: create or update a helper bot (e.g. QA, SEO) wired to this Lead; pass personaId to reuse a crew persona.",
  parameters: Schema.Struct({
    action: Schema.Literals([
      "list",
      "list_crew",
      "update_identity",
      "complete_onboarding",
      "configure_loop",
      "upsert_helper",
    ]),
    name: Schema.optional(TrimmedNonEmptyString),
    roleLabel: Schema.optional(Schema.String),
    soul: Schema.optional(Schema.String),
    identity: Schema.optional(Schema.String),
    brief: Schema.optional(Schema.String),
    doneDefinition: Schema.optional(Schema.String),
    riskLevel: Schema.optional(DropwaveRiskLevel),
    fixRoundCap: Schema.optional(Schema.Int),
    loopSteps: Schema.optional(Schema.Array(DropwaveLoopStep)),
    addRule: Schema.optional(TrimmedNonEmptyString),
    helperThreadId: Schema.optional(ThreadId),
    helperName: Schema.optional(TrimmedNonEmptyString),
    helperRole: Schema.optional(Schema.String),
    helperBrief: Schema.optional(Schema.String),
    personaId: Schema.optional(TrimmedNonEmptyString),
  }),
  success: Schema.Record(Schema.String, Schema.Unknown),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [...baseDeps, SecureRandom.SecureRandom, DropwaveStore.DropwaveStore],
})
  .annotate(Tool.Title, "Manage Dropwave team and core loop")
  .annotate(Tool.Destructive, true)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

const DropwaveAskUpTool = Tool.make("dropwave_ask_up", {
  description:
    "Escalate an unresolved decision from a helper bot or worker up to the project's Lead bot in plain English with your recommendation and options. Lead answers from rules when possible, else asks the owner.",
  parameters: Schema.Struct({
    whatHappened: TrimmedNonEmptyString,
    question: TrimmedNonEmptyString,
    recommended: TrimmedNonEmptyString,
    choices: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
    ifDoNothing: Schema.optional(Schema.String),
    kind: Schema.optional(DropwaveAskKind),
  }),
  success: Schema.Record(Schema.String, Schema.Unknown),
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [...baseDeps, SecureRandom.SecureRandom],
})
  .annotate(Tool.Title, "Escalate a decision up to the Lead bot")
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);

export const DropwaveToolkit = Toolkit.make(
  DropwaveAsksTool,
  DropwaveMemoryTool,
  DropwaveDocsTool,
  DropwaveTeamTool,
  DropwaveAskUpTool,
);
