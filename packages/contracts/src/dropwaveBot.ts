import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import type { OrchestrationV2AppThread } from "./orchestrationV2.ts";

const Brief = Schema.String.check(Schema.isMaxLength(4000));
const Workflow = Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(400))).check(
  Schema.isMaxLength(12),
);
const Rules = Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(400))).check(
  Schema.isMaxLength(50),
);
const DoneDefinition = Schema.String.check(Schema.isMaxLength(1000));
const BotRole = Schema.String.check(Schema.isMaxLength(160));
const FixRoundCap = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(10),
);

export const DropwaveRiskLevel = Schema.Literals(["careful", "normal", "yolo"]);
export type DropwaveRiskLevel = typeof DropwaveRiskLevel.Type;

export const DropwaveLoopStep = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(80)),
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(200)),
  ownerBotId: Schema.optional(Schema.NullOr(ThreadId)),
  doneCheck: Schema.optional(Schema.String.check(Schema.isMaxLength(300))),
});
export type DropwaveLoopStep = typeof DropwaveLoopStep.Type;

export const DropwaveBotProfile = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("lead"),
    brief: Brief,
    soul: Schema.optional(Brief),
    workflow: Workflow,
    rules: Rules,
    riskLevel: Schema.optional(DropwaveRiskLevel),
    doneDefinition: Schema.optional(DoneDefinition),
    fixRoundCap: Schema.optional(FixRoundCap),
    loopSteps: Schema.optional(Schema.Array(DropwaveLoopStep).check(Schema.isMaxLength(12))),
    avatarSeed: Schema.optional(Schema.Int),
  }),
  Schema.Struct({
    kind: Schema.Literal("teammate"),
    brief: Brief,
    soul: Schema.optional(Brief),
    leadThreadId: ThreadId,
    role: Schema.optional(BotRole),
    avatarSeed: Schema.optional(Schema.Int),
  }),
]);
export type DropwaveBotProfile = typeof DropwaveBotProfile.Type;

export function isEligibleDropwaveBotThread(
  thread: Pick<OrchestrationV2AppThread, "id" | "lineage" | "delegatedFrom">,
): boolean {
  return (
    thread.lineage.parentThreadId === null &&
    thread.lineage.rootThreadId === thread.id &&
    thread.lineage.relationshipToParent === null &&
    thread.lineage.sideChat !== true &&
    thread.delegatedFrom == null
  );
}
