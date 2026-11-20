import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import type { OrchestrationV2AppThread } from "./orchestrationV2.ts";

const Brief = Schema.String.check(Schema.isMaxLength(4000));
const Workflow = Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(400))).check(
  Schema.isMaxLength(12),
);
const Rules = Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(400))).check(
  Schema.isMaxLength(20),
);

export const DropwaveBotProfile = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("lead"),
    brief: Brief,
    workflow: Workflow,
    rules: Rules,
  }),
  Schema.Struct({
    kind: Schema.Literal("teammate"),
    brief: Brief,
    leadThreadId: ThreadId,
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
