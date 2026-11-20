import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  type OrchestrationV2DomainEvent,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ProviderThreadId,
  ProviderTurnId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import { checkpointWorkspace } from "@t3tools/provider-testing/replayWorkspace";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as ServerConfig from "../config.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import type { McpInvocationScope } from "../mcp/McpInvocationContext.ts";
import * as OrchestratorMcpService from "../mcp/OrchestratorMcpService.ts";
import * as RemoteDelegation from "../peer/RemoteDelegation.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectCloneTracker from "../project/ProjectCloneTracker.ts";
import * as ProjectEnrichmentService from "../project/ProjectEnrichmentService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as WorktreeSetupTracker from "../project/WorktreeSetupTracker.ts";
import * as ProviderRegistryMock from "../provider/testUtils/providerRegistryMock.ts";
import * as ScheduledTaskService from "../scheduledTasks/ScheduledTaskService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ThreadLaunch from "./ThreadLaunchService.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as RuntimeLayer from "./runtimeLayer.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const driver = ProviderDriverKind.make("codex");
const modelSelection = { instanceId, model: "gpt-5.4" };
const projectId = ProjectId.make("project:dropwave-sessions");
const parentThreadId = ThreadId.make(`dropwave-lead:${projectId}`);

interface ActiveTurn {
  readonly turn: ProviderAdapter.ProviderAdapterV2TurnInput;
  readonly finish: (reply: string) => Effect.Effect<void>;
}

function scriptedProvider(
  started: Queue.Queue<ActiveTurn>,
): ProviderAdapter.ProviderAdapterV2["Service"] {
  const capabilities = {
    ...CodexProviderCapabilitiesV2,
    turns: {
      ...CodexProviderCapabilitiesV2.turns,
      supportsActiveSteering: false,
      supportsSteeringByInterruptRestart: false,
    },
  };
  return {
    instanceId,
    driver,
    getCapabilities: () => Effect.succeed(capabilities),
    planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" }),
    openSession: (input) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        const events = yield* Queue.unbounded<ProviderAdapter.ProviderAdapterV2Event>();
        return {
          instanceId,
          driver,
          providerSessionId: input.providerSessionId,
          providerSession: {
            id: input.providerSessionId,
            driver,
            providerInstanceId: instanceId,
            status: "ready",
            cwd: requireValue(input.runtimePolicy.cwd, "Expected a provider workspace"),
            model: modelSelection.model,
            capabilities,
            createdAt: now,
            updatedAt: now,
            lastError: null,
          },
          events: Stream.fromQueue(events),
          ensureThread: ({ threadId }) =>
            Effect.succeed({
              id: ProviderThreadId.make(`provider-thread:${threadId}`),
              driver,
              providerInstanceId: instanceId,
              providerSessionId: input.providerSessionId,
              appThreadId: threadId,
              ownerNodeId: null,
              nativeThreadRef: { driver, nativeId: `native:${threadId}`, strength: "strong" },
              nativeConversationHeadRef: null,
              status: "idle",
              firstRunOrdinal: null,
              lastRunOrdinal: null,
              handoffIds: [],
              forkedFrom: null,
              createdAt: now,
              updatedAt: now,
            }),
          resumeThread: ({ providerThread }) => Effect.succeed(providerThread),
          startTurn: (turn) =>
            Effect.gen(function* () {
              const providerTurn = {
                id: ProviderTurnId.make(`provider-turn:${turn.attemptId}`),
                providerThreadId: turn.providerThread.id,
                nodeId: turn.rootNodeId,
                runAttemptId: turn.attemptId,
                nativeTurnRef: null,
                ordinal: turn.providerTurnOrdinal,
                status: "running" as const,
                startedAt: yield* DateTime.now,
                completedAt: null,
              };
              yield* Queue.offer(events, { type: "provider_turn.updated", driver, providerTurn });
              // The test releases each turn only after observing the entire cohort running.
              yield* Queue.offer(started, {
                turn,
                finish: Effect.fn("DropwaveSessions.finish")(function* (reply) {
                  const completedAt = yield* DateTime.now;
                  yield* Queue.offerAll(events, [
                    {
                      type: "turn_item.updated",
                      driver,
                      turnItem: {
                        type: "assistant_message",
                        id: TurnItemId.make(`reply:${turn.attemptId}`),
                        threadId: turn.threadId,
                        runId: turn.runId,
                        nodeId: turn.rootNodeId,
                        providerThreadId: providerTurn.providerThreadId,
                        providerTurnId: providerTurn.id,
                        nativeItemRef: null,
                        parentItemId: null,
                        ordinal: 0,
                        status: "completed",
                        title: null,
                        startedAt: providerTurn.startedAt,
                        completedAt,
                        updatedAt: completedAt,
                        messageId: MessageId.make(`reply:${turn.attemptId}`),
                        text: reply,
                        streaming: false,
                      },
                    },
                    {
                      type: "provider_turn.updated",
                      driver,
                      providerTurn: { ...providerTurn, status: "completed", completedAt },
                    },
                    {
                      type: "turn.terminal",
                      driver,
                      providerThreadId: providerTurn.providerThreadId,
                      providerTurnId: providerTurn.id,
                      runOrdinal: turn.runOrdinal,
                      status: "completed",
                      failure: null,
                      threadDisposition: "reusable",
                    },
                  ]);
                }),
              });
            }),
          steerTurn: () => Effect.die("steering is disabled for the fixture"),
          interruptTurn: () => Effect.void,
          respondToRuntimeRequest: () => Effect.die("unused"),
          readThreadSnapshot: () => Effect.die("unused"),
          rollbackThread: () => Effect.die("unused"),
          forkThread: () => Effect.die("unused"),
        };
      }),
  };
}

function orchestrationLayer(started: Queue.Queue<ActiveTurn>) {
  const database = SqlitePersistence.layerMemory;
  const settings = ServerSettings.layerTest({ branchNamingMode: "static" });
  const config = Layer.effect(
    ServerConfig.ServerConfig,
    ProviderReplayHarness.makeReplayServerConfig("dropwave-git"),
  );
  const platform = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer);
  const vcs = Layer.mergeAll(GitVcsDriver.layer, VcsDriverRegistry.layer).pipe(
    Layer.provide(VcsProcess.layer),
    Layer.provideMerge(config),
    Layer.provide(platform),
  );
  const checkpoint = CheckpointStore.layer.pipe(Layer.provide(vcs));
  const providers = ProviderRegistryMock.layer([
    {
      instanceId,
      driver,
      enabled: true,
      installed: true,
      auth: { status: "authenticated" },
      status: "ready",
      version: "test",
      checkedAt: "2026-11-20T00:00:00.000Z",
      models: [
        {
          name: modelSelection.model,
          slug: modelSelection.model,
          capabilities: null,
          isCustom: false,
        },
      ],
      slashCommands: [],
      skills: [],
    },
  ]);
  const registry = ProviderAdapterRegistry.layerSingle(scriptedProvider(started));
  const runtime = ProviderReplayHarness.layerWithRegistry({ name: "dropwave-sessions" }, registry, {
    databaseLayer: database,
    runContinuationWorker: true,
  });
  const receipts = CommandReceiptStore.layer.pipe(Layer.provide(database));
  const threads = ThreadManagement.layer.pipe(
    Layer.provideMerge(runtime),
    Layer.provide(receipts),
    Layer.provide(settings),
  );
  const projects = RuntimeLayer.layerProjectService.pipe(
    Layer.provide(settings),
    Layer.provide(database),
    Layer.provide(WorkspacePaths.layer),
    Layer.provideMerge(vcs),
    Layer.provide(
      Layer.mock(ProjectEnrichmentService.ProjectEnrichmentService)({
        getAvailable: () =>
          Effect.succeed({
            repositoryIdentity: null,
            faviconPath: null,
            repositoryIdentityResolved: false,
          }),
        request: () => Effect.void,
        invalidate: () => Effect.void,
      }),
    ),
    Layer.provide(platform),
  );
  const localGit = Layer.unwrap(
    Effect.gen(function* () {
      const git = yield* GitVcsDriver.GitVcsDriver;
      const { worktreesDir } = yield* ServerConfig.ServerConfig;
      return Layer.mock(GitWorkflow.GitWorkflowService)({
        hasCommit: ({ cwd, refName }) =>
          git.resolveCommit({ cwd, revision: refName }).pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          ),
        createWorktree: (input, options) =>
          git.createWorktree(input, { ...options, worktreesDirectory: worktreesDir }),
        renameBranch: git.renameBranch,
        removeWorktree: git.removeWorktree,
        deleteLocalBranch: git.deleteLocalBranch,
      });
    }),
  );
  const launch = ThreadLaunch.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        IdAllocator.layer,
        receipts,
        WorktreeSetupTracker.layer,
        Layer.mock(ProjectCloneTracker.ProjectCloneTracker)({ get: () => Effect.succeed(null) }),
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
          namedProjectsRoot: "/unused",
          isScratchProject: () => Effect.succeed(false),
          folderForThread: () => Effect.succeedNone,
        }),
        Layer.mock(TerminalManager.TerminalManager)({}),
        Layer.mock(ProjectSetupScriptRunner.ProjectSetupScriptRunner)({
          runForThread: () => Effect.succeed({ status: "no-script" }),
        }),
        Layer.mock(TextGeneration.TextGeneration)({
          generateBranchName: ({ message }) =>
            Effect.succeed({ branch: message.toLowerCase().replaceAll(" ", "-") }),
        }),
        checkpoint,
        providers,
        settings,
        localGit.pipe(Layer.provide(vcs)),
      ),
    ),
    Layer.provideMerge(Layer.merge(threads, projects)),
    Layer.provide(platform),
  );
  return OrchestratorMcpService.layer.pipe(
    Layer.provideMerge(launch),
    Layer.provide(
      Layer.mergeAll(
        platform,
        providers,
        settings,
        registry,
        Layer.mock(ScheduledTaskService.ScheduledTaskService)({}),
        Layer.mock(SecretRequests.SecretRequests)({}),
        Layer.mock(RemoteDelegation.RemoteDelegation)({}),
      ),
    ),
  );
}

function requireValue<T>(value: T | null | undefined, message: string): T {
  if (value == null) throw new Error(message);
  return value;
}

it.live.each([10, 20])(
  "runs %i isolated delegated sessions together and delivers every result",
  (size) =>
    Effect.gen(function* () {
      const cwd = yield* checkpointWorkspace("dropwave-sessions");
      const started = yield* Queue.unbounded<ActiveTurn>();
      yield* Effect.gen(function* () {
        const projects = yield* ProjectService.ProjectService;
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const service = yield* OrchestratorMcpService.OrchestratorMcpService;
        const git = yield* GitVcsDriver.GitVcsDriver;
        const head = yield* git.resolveCommit({ cwd, revision: "HEAD" });
        const waitFor = (
          threadId: ThreadId,
          predicate: (event: OrchestrationV2DomainEvent) => boolean,
        ) =>
          orchestrator.streamStoredEventsFrom({ threadId, afterSequence: 0 }).pipe(
            Stream.filter(({ event }) => predicate(event)),
            Stream.runHead,
            Effect.map((event) =>
              requireValue(Option.getOrUndefined(event), `Missing event for ${threadId}`),
            ),
          );
        const running = (active: ActiveTurn) =>
          waitFor(
            active.turn.threadId,
            (event) =>
              event.type === "provider-turn.updated" &&
              event.payload.status === "running" &&
              event.payload.runAttemptId === active.turn.attemptId,
          );
        yield* projects.create({
          commandId: CommandId.make("dropwave:create-project"),
          projectId,
          title: "Dropwave dispatch test",
          workspaceRoot: cwd,
        });
        yield* orchestrator.dispatch({
          type: "thread.create",
          commandId: CommandId.make("dropwave:create-lead"),
          projectId,
          threadId: parentThreadId,
          title: "Lead",
          dropwaveBot: {
            kind: "lead",
            brief: "Coordinate a batch of jobs and report their results.",
            workflow: ["Delegate each job", "Review the worker results"],
            rules: [],
          },
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: cwd,
          createdBy: "user",
          creationSource: "web",
        });
        yield* orchestrator.dispatch({
          type: "message.dispatch",
          commandId: CommandId.make("dropwave:start-lead"),
          threadId: parentThreadId,
          messageId: MessageId.make("dropwave:start"),
          text: "Coordinate the parallel sessions.",
          attachments: [],
          dispatchMode: { type: "start_immediately" },
          createdBy: "user",
          creationSource: "web",
        });
        const lead = yield* Queue.take(started);
        yield* running(lead);
        const scope = {
          environmentId: EnvironmentId.make("environment:dropwave-test"),
          requestNamespace: "dropwave:session-batch",
          thread: {
            threadId: parentThreadId,
            providerSessionId: requireValue(
              lead.turn.providerThread.providerSessionId,
              "Missing lead session",
            ),
            providerInstanceId: instanceId,
          },
          client: undefined,
          capabilities: new Set(["orchestration"]),
          issuedAt: 1,
        } satisfies McpInvocationScope;
        const tasks = yield* Effect.forEach(
          Array.from({ length: size }, (_, index) => String(index + 1).padStart(2, "0")),
          (label) =>
            service
              .delegateTask(scope, {
                task: `parallel session ${label}`,
                title: `Parallel session ${label}`,
                clientRequestId: `delegate-${label}`,
                mode: "async",
                isolation: "worktree",
              })
              .pipe(
                Effect.map((task) => ({
                  id: task.taskId,
                  threadId: requireValue(task.childThreadId, "Expected a local delegated thread"),
                  runId: requireValue(task.childRunId, "Expected an initial delegated run"),
                  reply: `RESULT-${label}`,
                })),
              ),
          { concurrency: "unbounded" },
        );
        const workers = yield* Effect.forEach(tasks, () => Queue.take(started));
        yield* Effect.forEach(workers, running, { concurrency: "unbounded", discard: true });
        assert.sameMembers(
          workers.map(({ turn }) => turn.runId),
          tasks.map(({ runId }) => runId),
        );
        const worktreePaths = yield* Effect.forEach(workers, ({ turn }) =>
          orchestrator.getThreadProjection(turn.threadId).pipe(
            Effect.map(({ thread, runs }) => {
              assert.equal(thread.lineage.parentThreadId, parentThreadId);
              assert.equal(runs.find((run) => run.id === turn.runId)?.status, "running");
              const worktree = requireValue(thread.worktreePath, "Expected a checked-out worktree");
              assert.equal(turn.runtimePolicy.cwd, worktree);
              return worktree;
            }),
          ),
        );
        assert.equal(new Set(worktreePaths).size, size);
        yield* Effect.forEach(
          worktreePaths,
          (path) =>
            git
              .resolveCommit({ cwd: path, revision: "HEAD" })
              .pipe(Effect.map(({ commitSha }) => assert.equal(commitSha, head.commitSha))),
          { concurrency: "unbounded", discard: true },
        );

        const continuingTask = requireValue(tasks[0], "Expected a task to continue");
        const sendFollowup = (requestId: string, message: string) =>
          service.sendToThread(scope, {
            threadId: continuingTask.threadId,
            clientRequestId: requestId,
            message,
            mode: "queue",
          });
        const followups = [
          "Review the first answer against the original task.",
          "Return the revised result.",
        ];
        for (const [index, message] of followups.entries()) {
          const receipt = yield* sendFollowup(`followup-${index}`, message);
          assert.equal(receipt.status, "queued");
        }
        yield* Effect.forEach(
          workers,
          (worker) => {
            const task = requireValue(
              tasks.find(({ threadId }) => threadId === worker.turn.threadId),
              "Unexpected worker",
            );
            return worker.finish(task.id === continuingTask.id ? "Initial answer" : task.reply);
          },
          { concurrency: "unbounded", discard: true },
        );
        for (const [index, message] of followups.entries()) {
          const active = yield* Queue.take(started);
          assert.equal(active.turn.threadId, continuingTask.threadId);
          assert.equal(active.turn.runOrdinal, index + 2);
          assert.include(active.turn.message.text, parentThreadId);
          assert.isTrue(active.turn.message.text.endsWith(`\n\n${message}`));
          yield* active.finish(index === 0 ? "Reviewed answer" : continuingTask.reply);
        }

        yield* Effect.forEach(
          tasks,
          ({ threadId }) =>
            waitFor(
              parentThreadId,
              (event) =>
                event.type === "context-transfer.created" &&
                event.payload.type === "subagent_result" &&
                event.payload.sourceThreadId === threadId,
            ),
          { concurrency: "unbounded", discard: true },
        );
        yield* lead.finish("The workers have reported.");
        const wake = yield* Queue.take(started);
        assert.equal(wake.turn.threadId, parentThreadId);
        assert.sameMembers(
          wake.turn.message.text.split("\n").filter((line) => /^RESULT-\d{2}$/.test(line)),
          tasks.map((task) => task.reply),
        );
        yield* wake.finish("All results received.");
        yield* waitFor(
          parentThreadId,
          (event) =>
            event.type === "run.updated" &&
            event.payload.id === wake.turn.runId &&
            event.payload.status === "completed",
        );
        const delivered = yield* orchestrator.getThreadProjection(parentThreadId);
        assert.sameMembers(
          delivered.messages.flatMap((message) => message.delegatedCompletion?.taskIds ?? []),
          tasks.map((task) => task.id),
        );
        assert.deepEqual(
          delivered.subagents.map((task) => task.id).sort(),
          tasks.map((task) => task.id).sort(),
        );
        for (const task of tasks) {
          const recorded = requireValue(
            delivered.subagents.find(({ id }) => id === task.id),
            "Missing result in lead thread",
          );
          assert.equal(recorded.status, "completed");
          assert.equal(recorded.result, task.reply);
          assert.equal(recorded.completionDelivery?.state, "delivered");
        }
        const child = yield* orchestrator.getThreadProjection(continuingTask.threadId);
        assert.deepEqual(
          child.runs.map(({ status }) => status),
          ["completed", "completed", "completed"],
        );
      }).pipe(Effect.provide(orchestrationLayer(started)));
    }),
);
