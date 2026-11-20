import {
  CommandId,
  MessageId,
  type OrchestrationV2DomainEvent,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as KeyedLock from "@t3tools/shared/KeyedLock";

import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as DropwaveStore from "./DropwaveStore.ts";

const MAX_MISSED_ASK_NUDGES = 2;
const DEFAULT_FIX_ROUND_CAP = 3;

export class DropwaveSupervisor extends Context.Service<
  DropwaveSupervisor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
  }
>()("t3/dropwave/DropwaveSupervisor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const store = yield* DropwaveStore.DropwaveStore;

  const dispatchSupervisorMessage = Effect.fnUntraced(function* (input: {
    readonly threadId: ThreadId;
    readonly key: string;
    readonly text: string;
  }) {
    yield* engine
      .dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`dropwave:supervisor:${input.key}`),
        threadId: input.threadId,
        messageId: MessageId.make(`message:dropwave-supervisor:${input.key}`),
        text: input.text,
        attachments: [],
        dispatchMode: { type: "queue_after_active" },
        createdBy: "agent",
        creationSource: "server",
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("dropwave supervisor message dispatch failed", {
            threadId: input.threadId,
            key: input.key,
            cause,
          }),
        ),
      );
  });

  const handle: DropwaveSupervisor["Service"]["handle"] = Effect.fnUntraced(
    function* (event) {
      // 1. Capture asks & summary tree leaf the instant the owner sends a message to a Dropwave bot.
      if (event.type === "message.updated") {
        const message = event.payload;
        if (message.role !== "user" || message.createdBy !== "user" || !message.text.trim()) {
          return;
        }
        const thread = yield* projections.getThread(event.threadId);
        if (
          thread.dropwaveBot === undefined ||
          thread.archivedAt !== null ||
          thread.deletedAt !== null
        ) {
          return;
        }
        const captured = yield* store.captureMessageAsks({
          projectId: thread.projectId,
          botThreadId: thread.id,
          messageId: message.id,
          text: message.text,
        });
        // Persist explicit owner rules ("always ...", "never ...", "remember to ...") directly into OptMem with exact quote provenance.
        for (const ask of captured) {
          if (ask.kind === "rule") {
            yield* store
              .saveMemory({
                projectId: thread.projectId,
                botThreadId: thread.id,
                kind: "rule",
                text: ask.summary,
                quote: ask.quote,
                sourceMessageId: message.id,
                confidence: "confirmed",
              })
              .pipe(Effect.ignore);
          }
        }
        yield* store.appendTurnSummary({
          threadId: thread.id,
          messageId: message.id,
          role: "owner",
          text: message.text,
        });
        return;
      }

      // 2. Append completed assistant replies to the UniiChat summary tree.
      if (
        event.type === "turn-item.updated" &&
        event.payload.type === "assistant_message" &&
        event.payload.status === "completed" &&
        event.payload.text.trim().length > 0
      ) {
        const thread = yield* projections.getThread(event.threadId);
        if (
          thread.dropwaveBot === undefined ||
          thread.archivedAt !== null ||
          thread.deletedAt !== null
        ) {
          return;
        }
        yield* store.appendTurnSummary({
          threadId: thread.id,
          messageId: event.payload.id,
          role: "bot",
          text: event.payload.text,
        });
        return;
      }

      // 3. Worker lifecycle: sync linked asks and wake the owning Dropwave bot on failures so nothing is ignored.
      if (event.type === "subagent.updated") {
        const task = event.payload;
        if (task.origin !== "app_owned") return;
        const owner = yield* projections.getThread(task.threadId);
        if (
          owner.dropwaveBot === undefined ||
          owner.archivedAt !== null ||
          owner.deletedAt !== null
        ) {
          return;
        }
        if (task.status === "running") {
          yield* store.applyJobOutcome({
            jobId: task.id,
            status: "running",
            ...(task.title ? { title: task.title } : {}),
          });
          return;
        }
        if (task.status === "failed" || task.status === "cancelled") {
          const detail = task.result?.trim() || undefined;
          const reopened = yield* store.applyJobOutcome({
            jobId: task.id,
            status: task.status,
            ...(task.title ? { title: task.title } : {}),
            ...(detail ? { detail } : {}),
          });
          if (task.status === "failed") {
            const roundKey = `fix-round:${owner.id}:${task.title ?? task.id}`;
            const cap =
              owner.dropwaveBot.kind === "lead"
                ? (owner.dropwaveBot.fixRoundCap ?? DEFAULT_FIX_ROUND_CAP)
                : DEFAULT_FIX_ROUND_CAP;
            const round = yield* store.incrementSupervisorCounter(roundKey);
            const asksLine =
              reopened.length > 0
                ? `\nReopened asks: ${reopened.map((ask) => `#${ask.n} (${ask.summary})`).join("; ")}.`
                : "";
            const label = task.title?.trim() || task.id;
            const body =
              round <= cap
                ? `[Dropwave supervisor] Worker "${label}" failed (round ${round}/${cap}).${detail ? ` Error: ${detail}` : ""}${asksLine}\nInspect why it failed, fix or re-delegate in a clean worktree, and verify against the project's done checks. Do not ignore this failure.`
                : `[Dropwave supervisor] Worker "${label}" failed again and reached the fix-round cap (${cap}/${cap}).${detail ? ` Error: ${detail}` : ""}${asksLine}\nStop retrying and surface a plain-English Needs you decision to the owner explaining what failed, what you tried, and recommended next options.`;
            yield* dispatchSupervisorMessage({
              threadId: owner.id,
              key: `worker-failed:${task.id}:r${round}`,
              text: body,
            });
          }
        }
        return;
      }

      // 4. Completed bot turn: (a) catch dropped asks from multi-ask dumps; (b) wake Lead after teammate finishes.
      if (event.type === "run.updated" && event.payload.status === "completed") {
        const records = yield* projections.getThreadRecords(event.threadId, ["messages", "runs"]);
        const thread = records.thread;
        if (
          thread.dropwaveBot === undefined ||
          thread.archivedAt !== null ||
          thread.deletedAt !== null
        ) {
          return;
        }
        // Skip nudging if another run is already queued or active.
        const hasPendingRun = records.runs.some(
          (run) =>
            run.id !== event.payload.id &&
            (run.status === "queued" ||
              run.status === "preparing" ||
              run.status === "starting" ||
              run.status === "running"),
        );

        const triggerMessage = records.messages.find(
          (msg) => msg.id === event.payload.userMessageId,
        );

        // (a) Missed-ask coverage check on owner dumps.
        if (
          !hasPendingRun &&
          triggerMessage?.role === "user" &&
          triggerMessage.createdBy === "user"
        ) {
          const untouched = yield* store.listUntouchedAsksForMessage(triggerMessage.id);
          const allFromMessage = yield* store.listAsks({
            botThreadId: thread.id,
            includeClosed: true,
          });
          const messageAskCount = allFromMessage.filter(
            (ask) => ask.sourceMessageId === triggerMessage.id,
          ).length;
          // Nudge whenever a multi-ask message (or a long dump >240 chars) left untouched asks behind.
          if (
            untouched.length > 0 &&
            (messageAskCount >= 2 || triggerMessage.text.trim().length >= 240)
          ) {
            const nudgeKey = `missed-ask-nudge:${thread.id}:${triggerMessage.id}`;
            const count = yield* store.getSupervisorCounter(nudgeKey);
            if (count < MAX_MISSED_ASK_NUDGES) {
              const nextCount = yield* store.incrementSupervisorCounter(nudgeKey);
              const list = untouched
                .slice(0, 12)
                .map((ask) => `- ask #${ask.n} (${ask.id}): "${ask.quote}"`)
                .join("\n");
              yield* dispatchSupervisorMessage({
                threadId: thread.id,
                key: `nudge:${triggerMessage.id}:${nextCount}`,
                text: `[Dropwave supervisor] The owner's message had ${untouched.length === 1 ? "an ask" : `${untouched.length} asks`} with no status yet:\n${list}\nUse dropwave_asks to mark each started, waiting (with what you need), or done (with proof), and delegate or handle any work that was missed. Do not drop asks yourself.`,
              });
            }
          }
        }

        // (b) Teammate -> Lead handoff completion wake so bot-to-bot loops never stall silently.
        if (
          thread.dropwaveBot.kind === "teammate" &&
          triggerMessage?.createdBy === "agent" &&
          triggerMessage.senderThreadId === thread.dropwaveBot.leadThreadId
        ) {
          const leadId = thread.dropwaveBot.leadThreadId;
          const leadRecords = yield* projections
            .getThreadRecords(leadId, ["messages"])
            .pipe(Effect.orElseSucceed(() => undefined));
          if (
            leadRecords &&
            leadRecords.thread.archivedAt === null &&
            leadRecords.thread.deletedAt === null
          ) {
            const runStartedMs = event.payload.startedAt
              ? DateTime.toEpochMillis(event.payload.startedAt)
              : 0;
            const alreadyMessagedLead = leadRecords.messages.some(
              (msg) =>
                msg.senderThreadId === thread.id &&
                DateTime.toEpochMillis(msg.createdAt) >= runStartedMs,
            );
            if (!alreadyMessagedLead) {
              const latestReply = records.messages
                .filter((msg) => msg.role === "assistant" && msg.text.trim().length > 0)
                .at(-1)
                ?.text.trim()
                .slice(0, 500);
              yield* dispatchSupervisorMessage({
                threadId: leadId,
                key: `teammate-done:${thread.id}:${event.payload.id}`,
                text: `[Dropwave supervisor] Teammate "${thread.title}" (${thread.id}) finished its assigned run (${event.payload.id}).${latestReply ? `\nLatest reply: ${latestReply}` : ""}\nRead full details with t3_thread_read if needed and advance the project's core loop.`,
              });
            }
          }
        }
      }
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("dropwave supervisor event handler failed", {
            eventType: event.type,
            threadId: event.threadId,
            cause,
          }),
        ),
      ),
  );

  const start: DropwaveSupervisor["Service"]["start"] = Effect.fn("DropwaveSupervisor.start")(
    function* () {
      const locks = yield* KeyedLock.makeRunner<ThreadId>();
      yield* forkParked(
        Stream.runForEach(engine.streamDomainEvents, (event) =>
          locks.run(event.threadId, handle(event)),
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("dropwave supervisor stream failed", { cause }),
          ),
        ),
      );
    },
  );

  return { start, handle } satisfies DropwaveSupervisor["Service"];
});

export const layer = Layer.effect(DropwaveSupervisor, make);
