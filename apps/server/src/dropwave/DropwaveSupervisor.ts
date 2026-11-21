import {
  CommandId,
  DropwaveOperationError,
  MessageId,
  NodeId,
  type OrchestrationV2DomainEvent,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as KeyedLock from "@t3tools/shared/KeyedLock";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as DropwaveStore from "./DropwaveStore.ts";
import { parseVerifiedModelAsks, quoteInMessage } from "./askExtraction.ts";
import { DROPWAVE_ASK_EXTRACTION_PROMPT } from "./askExtractionPrompt.ts";
import * as MemoryExtractor from "./memoryExtractor.ts";

const MODEL_EXTRACTION_TIMEOUT = "90 seconds";

const MAX_MISSED_ASK_NUDGES = 2;
const DEFAULT_FIX_ROUND_CAP = 3;

export interface DropwaveLandResult {
  readonly landed: boolean;
  readonly conflict: boolean;
  readonly files: ReadonlyArray<string>;
  readonly mergeCommit?: string | undefined;
  readonly branch?: string | undefined;
  readonly filesChanged?: ReadonlyArray<string> | undefined;
}

export class DropwaveSupervisor extends Context.Service<
  DropwaveSupervisor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
    /**
     * Merge a completed delegated job's worker branch into the project's main
     * checkout. The Dropwave MCP tool and any future UI affordance both call this.
     */
    readonly land: (input: {
      readonly leadThreadId: ThreadId;
      readonly jobId: string;
      readonly ownerApprovalQuote?: string | undefined;
    }) => Effect.Effect<DropwaveLandResult, DropwaveOperationError>;
  }
>()("t3/dropwave/DropwaveSupervisor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const store = yield* DropwaveStore.DropwaveStore;
  const serviceScope = yield* Effect.scope;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const git = yield* GitVcsDriver.GitVcsDriver;
  // Model ask extraction runs detached so it never holds up the bot's turn; the
  // missed-ask nudge awaits these before judging coverage.
  const pendingExtractions = new Map<MessageId, Deferred.Deferred<void>>();

  const saveRuleMemories = Effect.fnUntraced(function* (input: {
    readonly projectId: Parameters<typeof store.saveMemory>[0]["projectId"];
    readonly botThreadId: Parameters<typeof store.saveMemory>[0]["botThreadId"];
    readonly sourceMessageId: Parameters<typeof store.saveMemory>[0]["sourceMessageId"];
    readonly asks: ReadonlyArray<{ kind: string; summary: string; quote: string }>;
  }) {
    for (const ask of input.asks) {
      if (ask.kind !== "rule") continue;
      yield* store
        .saveMemory({
          projectId: input.projectId,
          botThreadId: input.botThreadId,
          kind: "rule",
          text: ask.summary,
          quote: ask.quote,
          sourceMessageId: input.sourceMessageId,
          confidence: "confirmed",
        })
        .pipe(Effect.ignore);
    }
  });

  // Model pass on top of the instant heuristic capture: the verified list reconciles into the
  // same ledger (model asks replace the untouched heuristic ones they cover; safety-net maybe
  // entries keep whatever the model missed). On any failure the heuristic ledger stays.
  const reconcileAsksWithModel = Effect.fnUntraced(function* (input: {
    readonly projectId: ProjectId;
    readonly botThreadId: ThreadId;
    readonly messageId: MessageId;
    readonly text: string;
  }) {
    const dedupeKey = `ask-model-extraction:${input.messageId}`;
    if ((yield* store.getSupervisorCounter(dedupeKey)) > 0) return;
    yield* store.incrementSupervisorCounter(dedupeKey);
    const project = yield* projects.get(input.projectId).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("dropwave ask extraction: project lookup failed", {
          projectId: input.projectId,
          cause,
        }).pipe(Effect.as(Option.none())),
      ),
    );
    if (Option.isNone(project)) return;
    const allSettings = yield* serverSettings.getSettings;
    const { settings } = resolveProjectSettings(allSettings, input.projectId);
    const modelSelection = settings.textGenerationModelSelection ?? settings.defaultModelSelection;
    if (modelSelection === undefined) return;
    const reply = yield* textGeneration
      .generateTranscriptionPostProcessing({
        cwd: project.value.workspaceRoot,
        prompt: DROPWAVE_ASK_EXTRACTION_PROMPT.replace("{{MESSAGE}}", input.text),
        modelSelection,
      })
      .pipe(Effect.timeoutOption(MODEL_EXTRACTION_TIMEOUT));
    if (Option.isNone(reply)) {
      yield* Effect.logWarning("dropwave ask extraction timed out; keeping heuristic asks", {
        messageId: input.messageId,
      });
      return;
    }
    const items = parseVerifiedModelAsks(reply.value.transcription, input.text);
    if (items === undefined) {
      yield* Effect.logWarning("dropwave ask extraction reply was not valid JSON", {
        messageId: input.messageId,
      });
      return;
    }
    const created = yield* store.captureMessageAsks({
      projectId: input.projectId,
      botThreadId: input.botThreadId,
      messageId: input.messageId,
      text: input.text,
      extracted: items,
      heardBy: "model",
    });
    yield* saveRuleMemories({
      projectId: input.projectId,
      botThreadId: input.botThreadId,
      sourceMessageId: input.messageId,
      asks: created,
    });
  });

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
        yield* saveRuleMemories({
          projectId: thread.projectId,
          botThreadId: thread.id,
          sourceMessageId: message.id,
          asks: captured,
        });
        // Model pass, detached: heuristic asks land instantly, the verified model list
        // reconciles them afterward without blocking the turn.
        const extractionDone = yield* Deferred.make<void>();
        pendingExtractions.set(message.id, extractionDone);
        yield* Effect.forkIn(
          reconcileAsksWithModel({
            projectId: thread.projectId,
            botThreadId: thread.id,
            messageId: message.id,
            text: message.text,
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("dropwave model ask extraction failed; keeping heuristic asks", {
                messageId: message.id,
                cause,
              }),
            ),
            Effect.ensuring(
              Deferred.succeed(extractionDone, undefined).pipe(
                Effect.andThen(Effect.sync(() => pendingExtractions.delete(message.id))),
              ),
            ),
          ),
          serviceScope,
        );
        // Memory v2 writer trigger (design §3b): count owner messages; run the
        // extractor every 6, otherwise arm a ~2-minute idle check. The watermark
        // inside extractMemoriesForThread keeps re-runs idempotent.
        const botProfile = thread.dropwaveBot;
        const runExtraction = Effect.gen(function* () {
          const projectOption = yield* projects.get(thread.projectId);
          if (Option.isNone(projectOption)) return;
          yield* MemoryExtractor.extractMemoriesForThread({
            store,
            projections,
            textGeneration,
            serverSettings,
            projectId: thread.projectId,
            botThreadId: thread.id,
            personaId: botProfile?.personaId,
            botName: thread.title,
            botRole:
              botProfile?.kind === "teammate" ? (botProfile.role ?? "teammate") : "Chief of Staff",
            projectName: projectOption.value.title,
            workspaceRoot: projectOption.value.workspaceRoot,
          });
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("dropwave memory extraction failed", {
              botThreadId: thread.id,
              cause,
            }),
          ),
        );
        const trigger = yield* MemoryExtractor.noteOwnerMessage({
          store,
          botThreadId: thread.id,
          now: Date.now(),
        }).pipe(Effect.catch(() => Effect.succeed("skip" as const)));
        if (trigger === "run") {
          yield* Effect.forkIn(runExtraction, serviceScope);
        } else if (trigger === "schedule") {
          yield* MemoryExtractor.markExtractionScheduled({ store, botThreadId: thread.id }).pipe(
            Effect.catch(() => Effect.void),
          );
          yield* Effect.forkIn(
            Effect.gen(function* () {
              // Wait out the idle window, then re-check: a newer owner message
              // pushes the deadline out once before we extract anyway.
              for (let attempt = 0; attempt < 2; attempt += 1) {
                yield* Effect.sleep(MemoryExtractor.EXTRACTION_IDLE_MS);
                const due = yield* MemoryExtractor.extractionIdleDue({
                  store,
                  botThreadId: thread.id,
                  now: Date.now(),
                });
                if (due || attempt === 1) break;
              }
              yield* runExtraction;
              yield* MemoryExtractor.clearExtractionSchedule({
                store,
                botThreadId: thread.id,
              }).pipe(Effect.catch(() => Effect.void));
            }).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("dropwave idle memory extraction failed", {
                  botThreadId: thread.id,
                  cause,
                }),
              ),
            ),
            serviceScope,
          );
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

      // 2b. First mate contract enforcement: a lead never edits the project checkout directly.
      // Record each file-change item and queue a nudge back to the lead.
      if (event.type === "turn-item.updated" && event.payload.type === "file_change") {
        const thread = yield* projections.getThread(event.threadId);
        if (
          thread.dropwaveBot?.kind !== "lead" ||
          thread.archivedAt !== null ||
          thread.deletedAt !== null
        ) {
          return;
        }
        const fileName = event.payload.fileName;
        // turn-item.updated fires repeatedly per item; count and nudge once each.
        const seenKey = `lead-direct-edit-seen:${event.payload.id}`;
        if ((yield* store.getSupervisorCounter(seenKey)) > 0) return;
        yield* store.incrementSupervisorCounter(seenKey);
        yield* store.incrementSupervisorCounter(`lead-direct-edit:${thread.id}`);
        yield* dispatchSupervisorMessage({
          threadId: thread.id,
          key: `lead-direct-edit:${event.payload.id}`,
          text: `[Dropwave supervisor] You changed ${fileName} directly. Per the first mate contract, project changes go to a worker. Revert or hand it off, unless the owner approved this exact edit.`,
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
          // Judge coverage only after model extraction has reconciled this message.
          const pendingExtraction = pendingExtractions.get(triggerMessage.id);
          if (pendingExtraction !== undefined) {
            yield* Deferred.await(pendingExtraction).pipe(
              Effect.timeout("30 seconds"),
              Effect.ignore,
            );
          }
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

  const land: DropwaveSupervisor["Service"]["land"] = Effect.fn("DropwaveSupervisor.land")(
    function* (input) {
      const opError = (code: DropwaveOperationError["code"], message: string) =>
        new DropwaveOperationError({ code, message });
      const mapError = (error: { readonly message: string }) =>
        new DropwaveOperationError({ code: "storage_error", message: error.message });

      const lead = yield* projections.getThread(input.leadThreadId).pipe(Effect.mapError(mapError));
      if (lead.dropwaveBot?.kind !== "lead") {
        return yield* opError("forbidden", "Only the project's Lead bot can land worker work.");
      }
      const projectOption = yield* projects.get(lead.projectId).pipe(Effect.mapError(mapError));
      if (Option.isNone(projectOption)) {
        return yield* opError("not_found", "Project not found.");
      }
      const mainRoot = projectOption.value.workspaceRoot;

      const { subagents } = yield* projections
        .getThreadRecords(input.leadThreadId, ["subagents"], {
          subagentIds: [NodeId.make(input.jobId)],
        })
        .pipe(Effect.mapError(mapError));
      const job = subagents.find((candidate) => candidate.id === input.jobId);
      if (job === undefined) {
        return yield* opError(
          "not_found",
          `Delegated job ${input.jobId} not found on this thread.`,
        );
      }
      if (job.status !== "completed") {
        return yield* opError(
          "invalid_input",
          `Job ${input.jobId} is ${job.status}, not completed. Land only finished worker jobs.`,
        );
      }
      if (job.childThreadId === null) {
        return yield* opError(
          "invalid_input",
          `Job ${input.jobId} has no worker thread to land from.`,
        );
      }
      const worker = yield* projections
        .getThread(job.childThreadId)
        .pipe(Effect.mapError(mapError));
      const worktreePath = worker.worktreePath;
      const branch = worker.branch;
      if (worktreePath === null || branch === null) {
        return yield* opError(
          "invalid_input",
          "The worker ran without an isolated worktree branch, so there is nothing to merge.",
        );
      }

      const riskLevel = lead.dropwaveBot.riskLevel ?? "normal";
      if (riskLevel !== "yolo") {
        const quote = input.ownerApprovalQuote?.trim();
        if (quote === undefined || quote.length === 0) {
          return yield* opError(
            "forbidden",
            `This project's risk level is ${riskLevel}. Landing needs owner approval: ask the owner to confirm, then retry with ownerApprovalQuote quoting their reply.`,
          );
        }
        const { messages } = yield* projections
          .getThreadRecords(input.leadThreadId, ["messages"], { messageRoles: ["user"] })
          .pipe(Effect.mapError(mapError));
        const completedAtMs =
          job.completedAt !== null ? DateTime.toEpochMillis(job.completedAt) : 0;
        const approved = messages.some(
          (message) =>
            message.role === "user" &&
            message.createdBy === "user" &&
            DateTime.toEpochMillis(message.createdAt) > completedAtMs &&
            quoteInMessage(quote, message.text),
        );
        if (!approved) {
          return yield* opError(
            "forbidden",
            "No owner message after this job finished contains that approval quote. Ask the owner to confirm the landing first.",
          );
        }
      }

      const exec = (cwd: string, args: ReadonlyArray<string>) =>
        git.execute({ operation: "DropwaveSupervisor.land", cwd, args, timeoutMs: 120_000 });
      const execLenient = (cwd: string, args: ReadonlyArray<string>) =>
        git.execute({
          operation: "DropwaveSupervisor.land",
          cwd,
          args,
          allowNonZeroExit: true,
          timeoutMs: 120_000,
        });

      const workerStatus = yield* exec(worktreePath, ["status", "--porcelain"]).pipe(
        Effect.mapError(mapError),
      );
      if (workerStatus.stdout.trim().length > 0) {
        return yield* opError(
          "invalid_input",
          "The worker worktree has uncommitted changes. Have the worker commit them on its branch first, then land again.",
        );
      }
      const mainStatus = yield* exec(mainRoot, [
        "status",
        "--porcelain",
        "--untracked-files=no",
      ]).pipe(Effect.mapError(mapError));
      if (mainStatus.stdout.trim().length > 0) {
        return yield* opError(
          "invalid_input",
          "The main checkout has uncommitted changes to tracked files. Landing would risk the owner's work; leaving it untouched.",
        );
      }
      const ahead = yield* execLenient(mainRoot, ["rev-list", "--count", `HEAD..${branch}`]).pipe(
        Effect.mapError(mapError),
      );
      if (ahead.exitCode !== 0) {
        return yield* opError(
          "invalid_input",
          `Branch ${branch} does not resolve in the main checkout: ${ahead.stderr.trim() || ahead.stdout.trim()}`,
        );
      }
      if (ahead.stdout.trim() === "0") {
        return yield* opError(
          "invalid_input",
          `Branch ${branch} has no commits beyond the main checkout; nothing to land.`,
        );
      }

      const merge = yield* execLenient(mainRoot, ["merge", "--no-ff", "--no-edit", branch]).pipe(
        Effect.mapError(mapError),
      );
      if (merge.exitCode !== 0) {
        const unmerged = yield* execLenient(mainRoot, [
          "diff",
          "--name-only",
          "--diff-filter=U",
        ]).pipe(Effect.orElseSucceed(() => ({ stdout: "" }) as const));
        yield* execLenient(mainRoot, ["merge", "--abort"]).pipe(Effect.ignore);
        return {
          landed: false,
          conflict: true,
          files: unmerged.stdout
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0),
        };
      }

      const head = yield* exec(mainRoot, ["rev-parse", "HEAD"]).pipe(Effect.mapError(mapError));
      const mergeCommit = head.stdout.trim();
      const changed = yield* exec(mainRoot, ["diff", "--name-only", "HEAD^1", "HEAD"]).pipe(
        Effect.mapError(mapError),
      );
      const filesChanged = changed.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const shortSha = mergeCommit.slice(0, 8);
      const linkedAsks = yield* store
        .listAsks({ projectId: lead.projectId, includeClosed: true })
        .pipe(Effect.mapError(mapError));
      for (const ask of linkedAsks.filter((candidate) => candidate.jobs.includes(input.jobId))) {
        yield* store
          .updateAsk({
            askId: ask.id,
            actor: "system",
            note: `Landed ${shortSha} into the main checkout.`,
          })
          .pipe(Effect.ignore);
      }
      yield* dispatchSupervisorMessage({
        threadId: lead.id,
        key: `landed:${input.jobId}:${shortSha}`,
        text: `[Dropwave supervisor] Worker job ${job.title !== null ? `"${job.title}" ` : ""}(${input.jobId}) landed into the main checkout as ${shortSha} (${filesChanged.length} file(s): ${filesChanged.slice(0, 8).join(", ")}${filesChanged.length > 8 ? ", ..." : ""}). Verify the result, then mark the linked asks done with proof.`,
      });

      return {
        landed: true,
        conflict: false,
        files: filesChanged,
        mergeCommit,
        branch,
        filesChanged,
      };
    },
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

  return { start, handle, land } satisfies DropwaveSupervisor["Service"];
});

export const layer = Layer.effect(DropwaveSupervisor, make);
