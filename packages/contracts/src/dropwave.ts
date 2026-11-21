import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export class DropwaveOperationError extends Schema.TaggedError<
  DropwaveOperationError,
  { readonly brand: unique symbol }
>()("DropwaveOperationError", {
  code: Schema.Literals(["invalid_input", "not_found", "forbidden", "storage_error"]),
  message: Schema.String,
}) {}

export const DropwaveAskKind = Schema.Literals(["do", "answer", "decide", "rule", "idea"]);
export type DropwaveAskKind = typeof DropwaveAskKind.Type;

export const DropwaveAskStatus = Schema.Literals([
  "heard",
  "maybe",
  "started",
  "waiting",
  "done",
  "dropped",
]);
export type DropwaveAskStatus = typeof DropwaveAskStatus.Type;

export const DropwaveAskActor = Schema.Literals(["owner", "bot", "system"]);
export type DropwaveAskActor = typeof DropwaveAskActor.Type;

export const DropwaveAskStep = Schema.Struct({
  at: IsoDateTime,
  status: DropwaveAskStatus,
  by: DropwaveAskActor,
  note: Schema.optional(Schema.String.check(Schema.isMaxLength(400))),
});
export type DropwaveAskStep = typeof DropwaveAskStep.Type;

export const DropwaveAsk = Schema.Struct({
  id: TrimmedNonEmptyString,
  n: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  projectId: ProjectId,
  botThreadId: ThreadId,
  sourceMessageId: Schema.NullOr(Schema.String),
  quote: Schema.String.check(Schema.isMaxLength(600)),
  summary: Schema.String.check(Schema.isMaxLength(200)),
  kind: DropwaveAskKind,
  status: DropwaveAskStatus,
  note: Schema.optional(Schema.String.check(Schema.isMaxLength(400))),
  proof: Schema.optional(Schema.String.check(Schema.isMaxLength(400))),
  heardBy: Schema.Literals(["rules", "model", "owner"]),
  jobs: Schema.Array(Schema.String),
  chaseChecks: NonNegativeInt,
  raisedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  history: Schema.Array(DropwaveAskStep),
});
export type DropwaveAsk = typeof DropwaveAsk.Type;

export const DropwaveAsksListInput = Schema.Struct({
  projectId: Schema.optional(ProjectId),
  botThreadId: Schema.optional(ThreadId),
  includeClosed: Schema.optional(Schema.Boolean),
});
export type DropwaveAsksListInput = typeof DropwaveAsksListInput.Type;

export const DropwaveAsksListResult = Schema.Struct({
  asks: Schema.Array(DropwaveAsk),
});
export type DropwaveAsksListResult = typeof DropwaveAsksListResult.Type;

export const DropwaveAskAddInput = Schema.Struct({
  projectId: ProjectId,
  botThreadId: ThreadId,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(600)),
  kind: Schema.optional(DropwaveAskKind),
});
export type DropwaveAskAddInput = typeof DropwaveAskAddInput.Type;

export const DropwaveAskUpdateInput = Schema.Struct({
  askId: TrimmedNonEmptyString,
  status: Schema.optional(DropwaveAskStatus),
  note: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(400)))),
  proof: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(400)))),
  summary: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(200))),
});
export type DropwaveAskUpdateInput = typeof DropwaveAskUpdateInput.Type;

export const DropwaveAskMutationResult = Schema.Struct({
  ask: DropwaveAsk,
});
export type DropwaveAskMutationResult = typeof DropwaveAskMutationResult.Type;

export const DropwaveDocKind = Schema.Literals([
  "brief",
  "spec",
  "note",
  "loop",
  "memory",
  "hub",
  "foundation",
]);
export type DropwaveDocKind = typeof DropwaveDocKind.Type;

export const DropwaveDocSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  path: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  kind: DropwaveDocKind,
  updatedAt: IsoDateTime,
  sizeBytes: NonNegativeInt,
  excerpt: Schema.String,
});
export type DropwaveDocSummary = typeof DropwaveDocSummary.Type;

export const DropwaveDoc = Schema.Struct({
  ...DropwaveDocSummary.fields,
  content: Schema.String,
});
export type DropwaveDoc = typeof DropwaveDoc.Type;

export const DropwaveDocsListInput = Schema.Struct({
  projectId: ProjectId,
});
export type DropwaveDocsListInput = typeof DropwaveDocsListInput.Type;

export const DropwaveDocsListResult = Schema.Struct({
  docs: Schema.Array(DropwaveDocSummary),
});
export type DropwaveDocsListResult = typeof DropwaveDocsListResult.Type;

export const DropwaveDocReadInput = Schema.Struct({
  projectId: ProjectId,
  path: TrimmedNonEmptyString,
});
export type DropwaveDocReadInput = typeof DropwaveDocReadInput.Type;

export const DropwaveDocReadResult = Schema.Struct({
  doc: DropwaveDoc,
});
export type DropwaveDocReadResult = typeof DropwaveDocReadResult.Type;

export const DropwaveDocWriteInput = Schema.Struct({
  projectId: ProjectId,
  path: Schema.optional(TrimmedNonEmptyString),
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
  kind: Schema.optional(DropwaveDocKind),
  content: Schema.String.check(Schema.isMaxLength(200_000)),
});
export type DropwaveDocWriteInput = typeof DropwaveDocWriteInput.Type;

export const DropwaveDocDeleteInput = Schema.Struct({
  projectId: ProjectId,
  path: TrimmedNonEmptyString,
});
export type DropwaveDocDeleteInput = typeof DropwaveDocDeleteInput.Type;

export const DropwaveDocDeleteResult = Schema.Struct({
  deleted: Schema.Boolean,
});
export type DropwaveDocDeleteResult = typeof DropwaveDocDeleteResult.Type;

export const DropwaveMemoryKind = Schema.Literals([
  "fact",
  "preference",
  "decision",
  "rule",
  "lesson",
]);
export type DropwaveMemoryKind = typeof DropwaveMemoryKind.Type;

export const DropwaveMemoryConfidence = Schema.Literals(["mentioned", "learned", "confirmed"]);
export type DropwaveMemoryConfidence = typeof DropwaveMemoryConfidence.Type;

export const DropwaveMemoryScope = Schema.Literals(["project", "global"]);
export type DropwaveMemoryScope = typeof DropwaveMemoryScope.Type;

export const DropwaveMemoryItem = Schema.Struct({
  id: TrimmedNonEmptyString,
  projectId: ProjectId,
  botThreadId: Schema.NullOr(ThreadId),
  scope: DropwaveMemoryScope,
  personaId: Schema.NullOr(TrimmedNonEmptyString),
  kind: DropwaveMemoryKind,
  text: Schema.String.check(Schema.isMaxLength(600)),
  quote: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
  sourceMessageId: Schema.optional(Schema.NullOr(Schema.String)),
  confidence: DropwaveMemoryConfidence,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type DropwaveMemoryItem = typeof DropwaveMemoryItem.Type;

export const DropwaveSummaryNode = Schema.Struct({
  id: TrimmedNonEmptyString,
  threadId: ThreadId,
  level: NonNegativeInt,
  startOrdinal: NonNegativeInt,
  endOrdinal: NonNegativeInt,
  summary: Schema.String,
  childIds: Schema.Array(Schema.String),
  messageIds: Schema.Array(Schema.String),
  createdAt: IsoDateTime,
});
export type DropwaveSummaryNode = typeof DropwaveSummaryNode.Type;

export const DropwaveMemoryListInput = Schema.Struct({
  projectId: ProjectId,
  botThreadId: Schema.optional(ThreadId),
  personaId: Schema.optional(TrimmedNonEmptyString),
  query: Schema.optional(Schema.String),
});
export type DropwaveMemoryListInput = typeof DropwaveMemoryListInput.Type;

export const DropwaveMemoryListResult = Schema.Struct({
  items: Schema.Array(DropwaveMemoryItem),
});
export type DropwaveMemoryListResult = typeof DropwaveMemoryListResult.Type;

export const DropwaveMemorySaveInput = Schema.Struct({
  projectId: ProjectId,
  botThreadId: Schema.optional(Schema.NullOr(ThreadId)),
  scope: Schema.optional(DropwaveMemoryScope),
  about: Schema.optional(Schema.Literals(["owner", "self"])),
  personaId: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  kind: DropwaveMemoryKind,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(600)),
  quote: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
  confidence: Schema.optional(DropwaveMemoryConfidence),
});
export type DropwaveMemorySaveInput = typeof DropwaveMemorySaveInput.Type;

export const DropwaveMemorySaveResult = Schema.Struct({
  item: DropwaveMemoryItem,
});
export type DropwaveMemorySaveResult = typeof DropwaveMemorySaveResult.Type;

export const DropwaveMemoryRemoveInput = Schema.Struct({
  id: TrimmedNonEmptyString,
});
export type DropwaveMemoryRemoveInput = typeof DropwaveMemoryRemoveInput.Type;

export const DropwaveMemoryRemoveResult = Schema.Struct({
  removed: Schema.Boolean,
});
export type DropwaveMemoryRemoveResult = typeof DropwaveMemoryRemoveResult.Type;

export const DropwaveMemorySetScopeInput = Schema.Struct({
  id: TrimmedNonEmptyString,
  scope: DropwaveMemoryScope,
});
export type DropwaveMemorySetScopeInput = typeof DropwaveMemorySetScopeInput.Type;

export const DropwaveMemorySetScopeResult = Schema.Struct({
  item: DropwaveMemoryItem,
});
export type DropwaveMemorySetScopeResult = typeof DropwaveMemorySetScopeResult.Type;

export const DropwavePersonaRole = Schema.Literals(["chief_of_staff", "specialist"]);
export type DropwavePersonaRole = typeof DropwavePersonaRole.Type;

export const DropwavePersona = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  role: DropwavePersonaRole,
  roleLabel: Schema.String.check(Schema.isMaxLength(160)),
  soul: Schema.String.check(Schema.isMaxLength(4000)),
  identity: Schema.String.check(Schema.isMaxLength(40000)),
  avatarSeed: Schema.Int,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type DropwavePersona = typeof DropwavePersona.Type;

export const DropwavePersonaListResult = Schema.Struct({
  items: Schema.Array(DropwavePersona),
});
export type DropwavePersonaListResult = typeof DropwavePersonaListResult.Type;

export const DropwavePersonaUpsertInput = Schema.Struct({
  id: Schema.optional(TrimmedNonEmptyString),
  name: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(80))),
  role: Schema.optional(DropwavePersonaRole),
  roleLabel: Schema.optional(Schema.String.check(Schema.isMaxLength(160))),
  soul: Schema.optional(Schema.String.check(Schema.isMaxLength(4000))),
  identity: Schema.optional(Schema.String.check(Schema.isMaxLength(40000))),
});
export type DropwavePersonaUpsertInput = typeof DropwavePersonaUpsertInput.Type;

export const DropwavePersonaUpsertResult = Schema.Struct({
  item: DropwavePersona,
});
export type DropwavePersonaUpsertResult = typeof DropwavePersonaUpsertResult.Type;

export const DropwaveBotAddedInput = Schema.Struct({
  projectId: ProjectId,
  leadThreadId: ThreadId,
  teammateThreadId: ThreadId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  brief: Schema.String.check(Schema.isMaxLength(4000)),
});
export type DropwaveBotAddedInput = typeof DropwaveBotAddedInput.Type;

export const DropwaveBotAddedResult = Schema.Struct({
  sent: Schema.Boolean,
});
export type DropwaveBotAddedResult = typeof DropwaveBotAddedResult.Type;

export const DropwaveHabitSummaryItem = Schema.Struct({
  taskId: TrimmedNonEmptyString,
  summary: TrimmedNonEmptyString,
});
export type DropwaveHabitSummaryItem = typeof DropwaveHabitSummaryItem.Type;

export const DropwaveHabitSummariesListInput = Schema.Struct({
  projectId: ProjectId,
});
export type DropwaveHabitSummariesListInput = typeof DropwaveHabitSummariesListInput.Type;

export const DropwaveHabitSummariesListResult = Schema.Struct({
  items: Schema.Array(DropwaveHabitSummaryItem),
});
export type DropwaveHabitSummariesListResult = typeof DropwaveHabitSummariesListResult.Type;

export const DropwavePersonaDeleteInput = Schema.Struct({
  id: TrimmedNonEmptyString,
});
export type DropwavePersonaDeleteInput = typeof DropwavePersonaDeleteInput.Type;

export const DropwavePersonaDeleteResult = Schema.Struct({
  deleted: Schema.Boolean,
});
export type DropwavePersonaDeleteResult = typeof DropwavePersonaDeleteResult.Type;
