import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

/**
 * Leaf registry for delegated-completion wake claims: Dropwave claims the jobs
 * it reviews so the continuation service skips the generic wake for them.
 * Dependency-free so orchestration-v2 never imports dropwave services.
 */
export type DelegatedWakeClaimHandler = (input: {
  readonly threadId: ThreadId;
  readonly taskIds: ReadonlyArray<string>;
}) => Effect.Effect<ReadonlyArray<string>>;

let handler: DelegatedWakeClaimHandler | undefined;

export function registerDelegatedWakeClaim(next: DelegatedWakeClaimHandler): void {
  handler = next;
}

export function claimDelegatedWake(input: {
  readonly threadId: ThreadId;
  readonly taskIds: ReadonlyArray<string>;
}): Effect.Effect<ReadonlyArray<string>> {
  return handler === undefined ? Effect.succeed([]) : handler(input);
}
