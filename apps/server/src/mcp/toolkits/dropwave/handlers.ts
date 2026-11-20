import {
  type DropwaveBotProfile,
  MessageId,
  OrchestratorMcpFailure,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as DropwaveDocsService from "../../../dropwave/DropwaveDocsService.ts";
import * as DropwaveStore from "../../../dropwave/DropwaveStore.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { dispatchFailure, newCommandId, readCaller, readThread } from "../../threadAccess.ts";
import { DropwaveToolkit } from "./tools.ts";

function fail(code: OrchestratorMcpFailure["code"], message: string) {
  return Effect.fail(new OrchestratorMcpFailure({ code, message }));
}

function mapDropwaveError(error: { readonly code: string; readonly message: string }) {
  return new OrchestratorMcpFailure({
    code:
      error.code === "invalid_input" || error.code === "forbidden"
        ? "invalid_request"
        : "orchestration_error",
    message: error.message,
  });
}

const resolveCallerThread = Effect.fn("dropwaveMcp.resolveCallerThread")(function* () {
  const { scope, threads } = yield* readCaller();
  const threadId = scope.thread?.threadId;
  if (!threadId) {
    return yield* fail("invalid_request", "Dropwave tools require an active thread context.");
  }
  const { projection } = yield* readThread(threadId);
  return { scope, threads, thread: projection.thread };
});

const handlers = {
  dropwave_asks: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { thread } = yield* resolveCallerThread();
      const store = yield* DropwaveStore.DropwaveStore;
      if (input.action === "list") {
        const asks = yield* store
          .listAsks({
            projectId: thread.projectId,
            ...(thread.dropwaveBot ? { botThreadId: thread.id } : {}),
            includeClosed: input.includeClosed ?? false,
          })
          .pipe(Effect.mapError(mapDropwaveError));
        return { asks };
      }
      if (input.action === "link_job") {
        if (!input.jobId || !input.askIds?.length) {
          return yield* fail("invalid_request", "link_job requires jobId and non-empty askIds.");
        }
        const updated = yield* store
          .linkJobToAsks({
            jobId: input.jobId,
            askIds: input.askIds,
            ...(input.title ? { title: input.title } : {}),
          })
          .pipe(Effect.mapError(mapDropwaveError));
        return { updated };
      }
      if (!input.askId) {
        return yield* fail("invalid_request", "update requires askId (id or #number).");
      }
      const ask = yield* store
        .updateAsk({
          askId: input.askId,
          actor: "bot",
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(input.proof !== undefined ? { proof: input.proof } : {}),
        })
        .pipe(Effect.mapError(mapDropwaveError));
      return { ask };
    }),
  ),

  dropwave_memory: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { thread } = yield* resolveCallerThread();
      const store = yield* DropwaveStore.DropwaveStore;
      if (input.action === "list" || input.action === "search") {
        const items = yield* store
          .listMemories({
            projectId: thread.projectId,
            botThreadId: thread.id,
            ...(thread.dropwaveBot?.personaId !== undefined
              ? { personaId: thread.dropwaveBot.personaId }
              : {}),
            ...(input.query ? { query: input.query } : {}),
          })
          .pipe(Effect.mapError(mapDropwaveError));
        return { items };
      }
      if (input.action === "save") {
        if (!input.text) {
          return yield* fail("invalid_request", "save requires text.");
        }
        const callerPersonaId = thread.dropwaveBot?.personaId;
        // Global "self" memories bind to the caller's persona; without one they fall
        // back to project scope so they still only reach this bot.
        const scope =
          input.scope === "global"
            ? input.about === "self" && callerPersonaId === undefined
              ? "project"
              : "global"
            : "project";
        const personaId =
          scope === "global" && input.about === "self" ? (callerPersonaId ?? null) : null;
        const item = yield* store
          .saveMemory({
            projectId: thread.projectId,
            botThreadId: thread.id,
            scope,
            personaId,
            kind: input.kind ?? "fact",
            text: input.text,
            ...(input.quote ? { quote: input.quote } : {}),
            confidence: input.confidence ?? "learned",
          })
          .pipe(Effect.mapError(mapDropwaveError));
        return { item };
      }
      if (input.action === "zoom") {
        if (!input.nodeId) {
          return yield* fail("invalid_request", "zoom requires nodeId.");
        }
        return yield* store.zoomSummaryNode(input.nodeId).pipe(Effect.mapError(mapDropwaveError));
      }
      if (!input.query?.trim()) {
        return yield* fail("invalid_request", "search_tree requires query.");
      }
      const nodes = yield* store
        .searchSummaryTree(thread.id, input.query)
        .pipe(Effect.mapError(mapDropwaveError));
      return { nodes };
    }),
  ),

  dropwave_docs: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { thread } = yield* resolveCallerThread();
      const docs = yield* DropwaveDocsService.DropwaveDocsService;
      if (input.action === "list") {
        const list = yield* docs.listDocs(thread.projectId).pipe(Effect.mapError(mapDropwaveError));
        return { docs: list };
      }
      if (input.action === "read") {
        if (!input.path) return yield* fail("invalid_request", "read requires path.");
        const doc = yield* docs
          .readDoc(thread.projectId, input.path)
          .pipe(Effect.mapError(mapDropwaveError));
        return { doc };
      }
      if (!input.title || input.content === undefined) {
        return yield* fail("invalid_request", "write requires title and content.");
      }
      const doc = yield* docs
        .writeDoc({
          projectId: thread.projectId,
          ...(input.path ? { path: input.path } : {}),
          title: input.title,
          ...(input.kind ? { kind: input.kind } : {}),
          content: input.content,
        })
        .pipe(Effect.mapError(mapDropwaveError));
      return { doc };
    }),
  ),

  dropwave_team: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { threads, thread } = yield* resolveCallerThread();
      const entries = yield* threads
        .listProjectThreads({ projectId: thread.projectId, includeSubagents: false })
        .pipe(
          Effect.mapError(
            (cause) =>
              new OrchestratorMcpFailure({
                code: "orchestration_error",
                message: cause.message,
              }),
          ),
        );
      const allProjectThreads = (yield* Effect.forEach(entries, (entry) =>
        readThread(entry.id).pipe(
          Effect.map(({ projection }) => projection.thread),
          Effect.orElseSucceed(() => undefined),
        ),
      )).filter(
        (candidate): candidate is NonNullable<typeof candidate> =>
          candidate !== undefined &&
          candidate.dropwaveBot !== undefined &&
          candidate.archivedAt === null &&
          candidate.deletedAt === null,
      );

      if (input.action === "list") {
        return {
          bots: allProjectThreads.map((bot) => ({
            threadId: bot.id,
            title: bot.title,
            profile: bot.dropwaveBot,
          })),
        };
      }

      const store = yield* DropwaveStore.DropwaveStore;

      if (input.action === "list_crew") {
        const personas = yield* store.listPersonas().pipe(Effect.mapError(mapDropwaveError));
        const allEntries = yield* threads.listProjectThreads({ includeSubagents: false }).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestratorMcpFailure({
                code: "orchestration_error",
                message: cause.message,
              }),
          ),
        );
        const allBots = (yield* Effect.forEach(allEntries, (entry) =>
          readThread(entry.id).pipe(
            Effect.map(({ projection }) => projection.thread),
            Effect.orElseSucceed(() => undefined),
          ),
        )).filter(
          (candidate): candidate is NonNullable<typeof candidate> =>
            candidate !== undefined &&
            candidate.dropwaveBot !== undefined &&
            candidate.archivedAt === null &&
            candidate.deletedAt === null,
        );
        return {
          crew: personas.map((persona) => ({
            persona,
            usedBy: allBots
              .filter((bot) => bot.dropwaveBot?.personaId === persona.id)
              .map((bot) => ({
                threadId: bot.id,
                projectId: bot.projectId,
                title: bot.title,
              })),
          })),
        };
      }

      if (input.action === "update_identity") {
        const personaId = thread.dropwaveBot?.personaId;
        if (personaId === undefined) {
          return yield* fail(
            "invalid_request",
            "This bot has no crew persona yet, so there is no shared identity to update.",
          );
        }
        const persona = yield* store
          .upsertPersona({
            id: personaId,
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.roleLabel !== undefined ? { roleLabel: input.roleLabel } : {}),
            ...(input.soul !== undefined ? { soul: input.soul } : {}),
            ...(input.identity !== undefined ? { identity: input.identity } : {}),
          })
          .pipe(Effect.mapError(mapDropwaveError));
        // A new persona name renames every active bot bound to it.
        if (input.name !== undefined) {
          const allEntries = yield* threads
            .listProjectThreads({ includeSubagents: false })
            .pipe(Effect.orElseSucceed(() => []));
          for (const entry of allEntries) {
            if (entry.id === thread.id) continue;
            const shell = yield* readThread(entry.id).pipe(
              Effect.map(({ projection }) => projection.thread),
              Effect.orElseSucceed(() => undefined),
            );
            if (shell?.dropwaveBot?.personaId !== personaId) continue;
            const renameCommandId = yield* newCommandId();
            yield* threads
              .dispatch({
                type: "thread.metadata.update",
                commandId: renameCommandId,
                threadId: entry.id,
                title: persona.name,
              })
              .pipe(Effect.ignore);
          }
          const renameSelfId = yield* newCommandId();
          yield* threads
            .dispatch({
              type: "thread.metadata.update",
              commandId: renameSelfId,
              threadId: thread.id,
              title: persona.name,
            })
            .pipe(Effect.mapError(dispatchFailure));
        }
        return { persona };
      }

      if (input.action === "complete_onboarding") {
        const current = thread.dropwaveBot;
        if (current?.kind !== "lead") {
          return yield* fail(
            "invalid_request",
            "Only the project's Lead bot can finish onboarding.",
          );
        }
        const { onboardingPhase: _cleared, ...nextProfile } = current;
        const clearedProfile: DropwaveBotProfile = nextProfile;
        const commandId = yield* newCommandId();
        yield* threads
          .dispatch({
            type: "thread.metadata.update",
            commandId,
            threadId: thread.id,
            dropwaveBot: clearedProfile,
          })
          .pipe(Effect.mapError(dispatchFailure));
        return { completed: true, profile: clearedProfile };
      }

      if (thread.dropwaveBot?.kind !== "lead") {
        return yield* fail(
          "invalid_request",
          "Only the project's Lead bot can configure the core loop or wire helper bots.",
        );
      }

      if (input.action === "configure_loop") {
        const current = thread.dropwaveBot;
        const nextRules =
          input.addRule && !current.rules.includes(input.addRule)
            ? [...current.rules, input.addRule].slice(-50)
            : current.rules;
        const nextWorkflow =
          input.loopSteps !== undefined
            ? input.loopSteps.map((step) => step.title)
            : current.workflow;
        const nextProfile: DropwaveBotProfile = {
          ...current,
          ...(input.brief !== undefined ? { brief: input.brief.trim() } : {}),
          ...(input.doneDefinition !== undefined
            ? { doneDefinition: input.doneDefinition.trim() }
            : {}),
          ...(input.riskLevel !== undefined ? { riskLevel: input.riskLevel } : {}),
          ...(input.fixRoundCap !== undefined ? { fixRoundCap: input.fixRoundCap } : {}),
          ...(input.loopSteps !== undefined ? { loopSteps: input.loopSteps } : {}),
          workflow: nextWorkflow,
          rules: nextRules,
        };
        const commandId = yield* newCommandId();
        yield* threads
          .dispatch({
            type: "thread.metadata.update",
            commandId,
            threadId: thread.id,
            dropwaveBot: nextProfile,
          })
          .pipe(Effect.mapError(dispatchFailure));
        return { updated: true, profile: nextProfile };
      }

      // Reusing a crew persona pulls the helper's name, role, and soul from it.
      let helperPersona =
        input.personaId !== undefined
          ? yield* store.getPersona(input.personaId).pipe(Effect.mapError(mapDropwaveError))
          : undefined;
      if (input.personaId !== undefined && helperPersona === undefined) {
        return yield* fail(
          "invalid_request",
          `Crew persona "${input.personaId}" not found; call list_crew for valid ids.`,
        );
      }
      const helperName = input.helperName ?? helperPersona?.name;
      if (!helperName) {
        return yield* fail("invalid_request", "upsert_helper requires helperName or personaId.");
      }
      const existingHelper =
        (input.helperThreadId
          ? allProjectThreads.find(
              (bot) =>
                bot.id === input.helperThreadId &&
                bot.dropwaveBot?.kind === "teammate" &&
                bot.dropwaveBot.leadThreadId === thread.id,
            )
          : allProjectThreads.find(
              (bot) =>
                bot.dropwaveBot?.kind === "teammate" &&
                bot.dropwaveBot.leadThreadId === thread.id &&
                (bot.dropwaveBot.personaId !== undefined
                  ? bot.dropwaveBot.personaId === input.personaId
                  : bot.title.toLowerCase() === helperName.toLowerCase()),
            )) ?? undefined;

      // A helper with no persona yet gets one so the same crew member can be reused later.
      if (helperPersona === undefined) {
        const existingPersonaId = existingHelper?.dropwaveBot?.personaId;
        if (existingPersonaId !== undefined) {
          helperPersona = yield* store
            .getPersona(existingPersonaId)
            .pipe(Effect.mapError(mapDropwaveError));
        }
        if (helperPersona === undefined) {
          helperPersona = yield* store
            .upsertPersona({
              name: helperName,
              role: "specialist",
              roleLabel: input.helperRole?.trim() ?? "",
              soul: "",
            })
            .pipe(Effect.mapError(mapDropwaveError));
        }
      }

      const helperProfile: DropwaveBotProfile = {
        kind: "teammate",
        brief: (input.helperBrief ?? existingHelper?.dropwaveBot?.brief ?? "").trim(),
        leadThreadId: thread.id,
        personaId: helperPersona.id,
        ...(input.helperRole || helperPersona.roleLabel
          ? { role: (input.helperRole ?? helperPersona.roleLabel).trim() }
          : {}),
        ...(helperPersona.soul.trim() ? { soul: helperPersona.soul } : {}),
      };
      const commandId = yield* newCommandId();
      if (existingHelper) {
        yield* threads
          .dispatch({
            type: "thread.metadata.update",
            commandId,
            threadId: existingHelper.id,
            title: helperName,
            dropwaveBot: helperProfile,
          })
          .pipe(Effect.mapError(dispatchFailure));
        return { created: false, threadId: existingHelper.id, title: helperName };
      }
      const newHelperId = ThreadId.make(`dropwave-helper-${commandId.slice(-12)}`);
      yield* threads
        .dispatch({
          type: "thread.create",
          commandId,
          projectId: thread.projectId,
          threadId: newHelperId,
          title: helperName,
          dropwaveBot: helperProfile,
          modelSelection: thread.modelSelection,
          runtimeMode: thread.runtimeMode,
          interactionMode: "default",
          branch: null,
          worktreePath: thread.worktreePath,
          createdBy: "agent",
          creationSource: "mcp",
        })
        .pipe(Effect.mapError(dispatchFailure));
      return { created: true, threadId: newHelperId, title: helperName };
    }),
  ),

  dropwave_ask_up: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      const { threads, thread } = yield* resolveCallerThread();
      let targetLeadId: ThreadId | null = null;
      if (thread.dropwaveBot?.kind === "teammate") {
        targetLeadId = thread.dropwaveBot.leadThreadId;
      } else if (thread.lineage.parentThreadId !== null) {
        const parent = yield* readThread(thread.lineage.parentThreadId).pipe(
          Effect.map(({ projection }) => projection.thread),
          Effect.orElseSucceed(() => undefined),
        );
        if (parent?.dropwaveBot?.kind === "teammate") {
          targetLeadId = parent.dropwaveBot.leadThreadId;
        } else if (parent?.dropwaveBot?.kind === "lead") {
          targetLeadId = parent.id;
        } else {
          targetLeadId = thread.lineage.parentThreadId;
        }
      }
      if (!targetLeadId) {
        return yield* fail(
          "invalid_request",
          "No Lead bot found above this thread. Ask the owner directly via user input.",
        );
      }
      const choicesText = input.choices?.length
        ? `\nOther choices: ${input.choices.join(" | ")}`
        : "";
      const consequenceText = input.ifDoNothing ? `\nIf nothing is done: ${input.ifDoNothing}` : "";
      const body = [
        `[Dropwave escalation from "${thread.title}" (${thread.id})]`,
        `What happened: ${input.whatHappened}`,
        `Question: ${input.question}`,
        `Recommended: ${input.recommended}${choicesText}${consequenceText}`,
        `Resolve this from the project's brief, core loop, standing rules, or risk posture if you can, and reply to ${thread.id} via t3_thread_send. Only escalate to the owner if it hits a RED line or genuinely needs the owner's taste.`,
      ].join("\n");
      const commandId = yield* newCommandId();
      yield* threads
        .dispatch({
          type: "message.dispatch",
          commandId,
          threadId: targetLeadId,
          messageId: MessageId.make(`message:dropwave-ask-up:${commandId}`),
          text: body,
          attachments: [],
          dispatchMode: { type: "queue_after_active" },
          senderThreadId: thread.id,
          createdBy: "agent",
          creationSource: "mcp",
        })
        .pipe(Effect.mapError(dispatchFailure));
      return { escalatedTo: targetLeadId };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof DropwaveToolkit.tools>;

export const layer = McpToolAccess.toLayer(DropwaveToolkit, handlers);
