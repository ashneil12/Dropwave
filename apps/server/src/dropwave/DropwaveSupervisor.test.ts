// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  TextGenerationError,
  ThreadId,
  type IsoDateTime,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import { claimDelegatedWake } from "../orchestration-v2/delegatedWakeClaims.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import type {
  WorkerReviewGenerationInput,
  WorkerReviewGenerationResult,
} from "../textGeneration/TextGeneration.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as DropwaveStore from "./DropwaveStore.ts";
import * as DropwaveSupervisor from "./DropwaveSupervisor.ts";

const projectId = ProjectId.make("project:hivra");
const leadId = ThreadId.make("thread:lead-hivra");
const qaId = ThreadId.make("thread:qa-hivra");
const now = DateTime.nowUnsafe();

function makeThread(
  id: ThreadId,
  title: string,
  dropwaveBot: OrchestrationV2AppThread["dropwaveBot"],
): OrchestrationV2AppThread {
  return {
    id,
    projectId,
    title,
    dropwaveBot,
    providerInstanceId: ProviderInstanceId.make("claude"),
    modelSelection: {
      instanceId: ProviderInstanceId.make("claude"),
      model: "claude-sonnet-4-6",
    },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: "/tmp/hivra",
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
}

it.effect(
  "captures asks & rules on owner messages, nudges missed asks, recovers worker failures, and wakes lead after teammate handoff",
  () =>
    Effect.gen(function* () {
      const dispatched: Array<OrchestrationV2ServerCommand> = [];
      const leadThread = makeThread(leadId, "Chief of Staff", {
        kind: "lead",
        brief: "Own Hivra end-to-end.",
        workflow: ["Build", "QA", "Ship"],
        rules: [],
        riskLevel: "yolo",
        fixRoundCap: 2,
      });
      const qaThread = makeThread(qaId, "Hivra QA", {
        kind: "teammate",
        leadThreadId: leadId,
        role: "Canary QA",
        brief: "Verify builds on Canary.",
      });

      const leadUserMsgId = MessageId.make("msg:owner-dump-1");
      const qaRunId = RunId.make("run:qa-1");
      const leadRunId = RunId.make("run:lead-1");

      const mockOrchestrator = Layer.mock(Orchestrator.OrchestratorV2)({
        dispatch: (cmd) =>
          Effect.sync(() => {
            dispatched.push(cmd);
            return { sequence: dispatched.length } as never;
          }),
      });

      const mockProjections = Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThread: (id) => Effect.succeed(id === qaId ? qaThread : leadThread),
        getThreadRecords: (id) =>
          Effect.succeed(
            id === qaId
              ? ({
                  thread: qaThread,
                  runs: [],
                  messages: [
                    {
                      id: MessageId.make("msg:from-lead"),
                      threadId: qaId,
                      role: "user",
                      text: "Please verify PR #613 on Canary.",
                      createdBy: "agent",
                      senderThreadId: leadId,
                      createdAt: now,
                      updatedAt: now,
                      attachments: [],
                    },
                    {
                      id: MessageId.make("msg:qa-reply"),
                      threadId: qaId,
                      role: "assistant",
                      text: "Canary upgrade flow verified with 42 suites passing.",
                      createdBy: "agent",
                      createdAt: now,
                      updatedAt: now,
                      attachments: [],
                    },
                  ],
                  turnItems: [],
                } as never)
              : ({
                  thread: leadThread,
                  runs: [],
                  messages: [
                    {
                      id: leadUserMsgId,
                      threadId: leadId,
                      role: "user",
                      text: "Please fix billing pricing. Remember to always run Canary QA before merging.",
                      createdBy: "user",
                      createdAt: now,
                      updatedAt: now,
                      attachments: [],
                    },
                  ],
                  turnItems: [],
                } as never),
          ),
      });

      const testLayer = DropwaveSupervisor.layer.pipe(
        Layer.provideMerge(DropwaveStore.layerMemory),
        Layer.provide(mockOrchestrator),
        Layer.provide(mockProjections),
        Layer.provide(mockProjectStore("/tmp/hivra")),
        Layer.provide(mockServerSettings()),
        Layer.provide(mockTextGeneration(Effect.succeed({ transcription: "[]" }))),
        Layer.provide(mockProviderInstances()),
        Layer.provideMerge(layerRealGit),
      );

      yield* Effect.gen(function* () {
        const supervisor = yield* DropwaveSupervisor.DropwaveSupervisor;
        const store = yield* DropwaveStore.DropwaveStore;

        // 1. Owner sends multi-ask + standing rule dump.
        const msgEvent: OrchestrationV2DomainEvent = {
          id: EventId.make("ev-1"),
          threadId: leadId,
          occurredAt: now,
          type: "message.updated",
          payload: {
            id: leadUserMsgId,
            role: "user",
            text: "Please fix billing pricing. Remember to always run Canary QA before merging.",
            createdBy: "user",
            createdAt: now,
            updatedAt: now,
            attachments: [],
          } as never,
        };
        yield* supervisor.handle(msgEvent);

        const openAsks = yield* store.listAsks({ projectId, botThreadId: leadId });
        expect(openAsks.length).toBe(2);
        const memories = yield* store.listMemories({ projectId });
        expect(memories.some((m) => m.kind === "rule" && m.text.includes("Canary QA"))).toBe(true);

        // 2. Lead finishes turn without touching the asks -> supervisor nudges Lead.
        yield* supervisor.handle({
          id: EventId.make("ev-2"),
          threadId: leadId,
          occurredAt: now,
          type: "run.updated",
          payload: {
            id: leadRunId,
            threadId: leadId,
            status: "completed",
            userMessageId: leadUserMsgId,
            startedAt: now,
          } as never,
        });
        expect(
          dispatched.some(
            (cmd) =>
              cmd.type === "message.dispatch" &&
              cmd.threadId === leadId &&
              cmd.text.includes("with no status yet"),
          ),
        ).toBe(true);

        // 3. Delegated worker linked to ask #1 fails -> ask bounces back to heard & Lead wakes for recovery round 1/2.
        // The model pass ("[]") reconciled untouched asks to safety-net copies, so re-read.
        const reconciled = yield* store.listAsks({ projectId, botThreadId: leadId });
        const ask1 = reconciled[0]!;
        const taskNodeId = NodeId.make("node:worker-1");
        yield* store.linkJobToAsks({ askIds: [ask1.id], jobId: taskNodeId, title: "Fix billing" });
        yield* supervisor.handle({
          id: EventId.make("ev-3"),
          threadId: leadId,
          occurredAt: now,
          type: "subagent.updated",
          payload: {
            id: taskNodeId,
            threadId: leadId,
            origin: "app_owned",
            status: "failed",
            title: "Fix billing",
            result: "Pricing test failed: expected $39 got $29",
          } as never,
        });
        const afterFail = yield* store.listAsks({ projectId, botThreadId: leadId });
        // The safety-net ask was `maybe`; a failed job must not leave it stuck in `started`.
        expect(["heard", "maybe"]).toContain(afterFail.find((a) => a.id === ask1.id)?.status);
        expect(
          dispatched.some(
            (cmd) =>
              cmd.type === "message.dispatch" &&
              cmd.threadId === leadId &&
              cmd.text.includes("round 1/2"),
          ),
        ).toBe(true);

        // 4. QA teammate finishes Lead-initiated turn without messaging Lead back -> supervisor auto-wakes Lead.
        yield* supervisor.handle({
          id: EventId.make("ev-4"),
          threadId: qaId,
          occurredAt: now,
          type: "run.updated",
          payload: {
            id: qaRunId,
            threadId: qaId,
            status: "completed",
            userMessageId: MessageId.make("msg:from-lead"),
            startedAt: now,
          } as never,
        });
        expect(
          dispatched.some(
            (cmd) =>
              cmd.type === "message.dispatch" &&
              cmd.threadId === leadId &&
              cmd.text.includes("Hivra QA") &&
              cmd.text.includes("42 suites passing"),
          ),
        ).toBe(true);

        // 5. Lead edits the project checkout directly -> supervisor nudges per the first mate contract.
        yield* supervisor.handle({
          id: EventId.make("ev-5"),
          threadId: leadId,
          occurredAt: now,
          type: "turn-item.updated",
          payload: {
            id: "item:edit-1",
            type: "file_change",
            fileName: "apps/web/src/billing.tsx",
            status: "completed",
          } as never,
        });
        expect(
          dispatched.some(
            (cmd) =>
              cmd.type === "message.dispatch" &&
              cmd.threadId === leadId &&
              cmd.text.includes("apps/web/src/billing.tsx") &&
              cmd.text.includes("project changes go to a worker"),
          ),
        ).toBe(true);

        // Teammates editing are not nudged — only the lead is bound by the contract.
        const dispatchedBefore = dispatched.length;
        yield* supervisor.handle({
          id: EventId.make("ev-6"),
          threadId: qaId,
          occurredAt: now,
          type: "turn-item.updated",
          payload: {
            id: "item:edit-2",
            type: "file_change",
            fileName: "apps/web/src/qa.tsx",
            status: "completed",
          } as never,
        });
        expect(dispatched.length).toBe(dispatchedBefore);

        // turn-item.updated fires repeatedly per item: the same item id only counts and
        // nudges once, while a different item id counts separately.
        yield* supervisor.handle({
          id: EventId.make("ev-7"),
          threadId: leadId,
          occurredAt: now,
          type: "turn-item.updated",
          payload: {
            id: "item:edit-1",
            type: "file_change",
            fileName: "apps/web/src/billing.tsx",
            status: "completed",
          } as never,
        });
        expect(dispatched.length).toBe(dispatchedBefore);
        expect(yield* store.getSupervisorCounter(`lead-direct-edit:${leadId}`)).toBe(1);
        yield* supervisor.handle({
          id: EventId.make("ev-8"),
          threadId: leadId,
          occurredAt: now,
          type: "turn-item.updated",
          payload: {
            id: "item:edit-3",
            type: "file_change",
            fileName: "apps/web/src/other.tsx",
            status: "completed",
          } as never,
        });
        expect(yield* store.getSupervisorCounter(`lead-direct-edit:${leadId}`)).toBe(2);
        expect(ProviderDriverKind.make("claudeAgent")).toBe("claudeAgent");
      }).pipe(Effect.provide(testLayer));
    }),
);

const mockProjectStore = (workspaceRoot: string) =>
  Layer.mock(ProjectStore.ProjectStoreV2)({
    get: () => Effect.succeed(Option.some({ workspaceRoot }) as never),
  });

const mockServerSettings = () =>
  Layer.mock(ServerSettings.ServerSettingsService)({
    getSettings: Effect.succeed({
      textGenerationModelSelection: {
        instanceId: ProviderInstanceId.make("claude"),
        model: "claude-haiku-4-5",
      },
      projectSettingsOverrides: {},
      projectSettingsFolded: false,
    } as never),
  });

const mockTextGeneration = (effect: Effect.Effect<{ transcription: string }, never>) =>
  Layer.mock(TextGeneration.TextGeneration)({
    generateTranscriptionPostProcessing: () => effect,
  });

const mockProviderInstances = () =>
  Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
    listInstances: Effect.succeed([]),
  });

const layerRealGit = GitVcsDriver.layer.pipe(
  Layer.provideMerge(VcsProcess.layer),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-dw-supervisor-git-" })),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

it.effect(
  "reconciles verified model asks over the heuristic ledger without touching progressed asks",
  () =>
    Effect.gen(function* () {
      const dispatched: Array<OrchestrationV2ServerCommand> = [];
      const leadThread = makeThread(leadId, "Chief of Staff", {
        kind: "lead",
        brief: "Own PulseBilling.",
        workflow: ["Build", "QA", "Ship"],
        rules: [],
        riskLevel: "yolo",
        fixRoundCap: 2,
      });
      const dump =
        "ok so a few things, sorry this is all over the place. the annual price is wrong, it's charging 12 months but the comment says two months free, fix that. oh and while you're in there the invoice formatting shows $9 instead of $9.00 which looks cheap. also quick q, why is the canary plan at 0, is that intentional or did I mess up? and from now on always run npm test before you tell me anything is done. random idea for later, maybe a usage dashboard, don't do it now";
      const ownerMsgId = MessageId.make("msg:messy-dump");
      const runId = RunId.make("run:messy");
      const gate = yield* Deferred.make<void>();
      const modelReply = JSON.stringify([
        {
          quote:
            "the annual price is wrong, it's charging 12 months but the comment says two months free, fix that",
          summary: "Fix annual price to charge ten months",
          kind: "do",
        },
        {
          quote: "the invoice formatting shows $9 instead of $9.00 which looks cheap",
          summary: "Format invoice amounts with two decimals",
          kind: "do",
        },
        {
          quote: "why is the canary plan at 0, is that intentional or did I mess up",
          summary: "Explain why the canary plan is priced at 0",
          kind: "answer",
        },
        {
          quote: "from now on always run npm test before you tell me anything is done",
          summary: "Always run npm test before reporting done",
          kind: "rule",
        },
        {
          quote: "maybe a usage dashboard, don't do it now",
          summary: "Consider a usage dashboard for later",
          kind: "idea",
        },
      ]);

      const testLayer = DropwaveSupervisor.layer.pipe(
        Layer.provideMerge(DropwaveStore.layerMemory),
        Layer.provide(
          Layer.mock(Orchestrator.OrchestratorV2)({
            dispatch: (cmd) =>
              Effect.sync(() => {
                dispatched.push(cmd);
                return { sequence: dispatched.length } as never;
              }),
          }),
        ),
        Layer.provide(
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getThread: () => Effect.succeed(leadThread),
            getThreadRecords: () =>
              Effect.succeed({
                thread: leadThread,
                runs: [],
                messages: [
                  {
                    id: ownerMsgId,
                    threadId: leadId,
                    role: "user",
                    text: dump,
                    createdBy: "user",
                    createdAt: now,
                    updatedAt: now,
                    attachments: [],
                  },
                ],
                turnItems: [],
              } as never),
          }),
        ),
        Layer.provide(mockProjectStore("/tmp/pulse")),
        Layer.provide(mockServerSettings()),
        Layer.provideMerge(layerRealGit),
        Layer.provide(mockProviderInstances()),
        Layer.provide(
          mockTextGeneration(Deferred.await(gate).pipe(Effect.as({ transcription: modelReply }))),
        ),
      );

      yield* Effect.gen(function* () {
        const supervisor = yield* DropwaveSupervisor.DropwaveSupervisor;
        const store = yield* DropwaveStore.DropwaveStore;

        const msgEvent: OrchestrationV2DomainEvent = {
          id: EventId.make("ev-msg"),
          threadId: leadId,
          occurredAt: now,
          type: "message.updated",
          payload: {
            id: ownerMsgId,
            role: "user",
            text: dump,
            createdBy: "user",
            createdAt: now,
            updatedAt: now,
            attachments: [],
          } as never,
        };
        yield* supervisor.handle(msgEvent);

        // Heuristic asks landed instantly; the model call is still gated.
        const heuristic = yield* store.listAsks({
          projectId,
          botThreadId: leadId,
          includeClosed: true,
        });
        expect(heuristic.length).toBeGreaterThanOrEqual(1);

        // One ask the lead already progressed must survive reconciliation.
        const progressed = heuristic[0]!;
        yield* store.linkJobToAsks({ askIds: [progressed.id], jobId: "job-1", title: "wip" });
        yield* store.updateAsk({
          askId: progressed.id,
          actor: "bot",
          status: "started",
        });

        // Release the model call; the run.completed nudge awaits reconciliation first.
        yield* Deferred.succeed(gate, undefined);
        yield* supervisor.handle({
          id: EventId.make("ev-run"),
          threadId: leadId,
          occurredAt: now,
          type: "run.updated",
          payload: {
            id: runId,
            threadId: leadId,
            status: "completed",
            userMessageId: ownerMsgId,
            startedAt: now,
          } as never,
        });

        const ledger = yield* store.listAsks({
          projectId,
          botThreadId: leadId,
          includeClosed: true,
        });
        expect(ledger.some((a) => a.id === progressed.id && a.status === "started")).toBe(true);
        for (const summary of [
          "Fix annual price to charge ten months",
          "Format invoice amounts with two decimals",
          "Explain why the canary plan is priced at 0",
          "Always run npm test before reporting done",
          "Consider a usage dashboard for later",
        ]) {
          expect(ledger.some((a) => a.summary === summary)).toBe(true);
        }
        // Model-extracted rule ask persisted its memory too.
        const memories = yield* store.listMemories({ projectId });
        expect(memories.some((m) => m.kind === "rule" && m.text.includes("npm test"))).toBe(true);

        // Replay of the same message is a no-op: no new asks, no second extraction.
        const before = ledger.length;
        yield* supervisor.handle(msgEvent);
        const replayed = yield* store.listAsks({
          projectId,
          botThreadId: leadId,
          includeClosed: true,
        });
        expect(replayed.length).toBe(before);
      }).pipe(Effect.provide(testLayer));
    }),
);

const workerId = ThreadId.make("thread:worker-1");
const landJobId = "node:job-land-1";

// A real git fixture: main checkout at <tmp>/main, worker worktree at <tmp>/wt on
// branch worker-1 with one committed change ahead of main.
const setupLandRepo = Effect.fnUntraced(function* (opts?: { conflict?: boolean }) {
  const driver = yield* GitVcsDriver.GitVcsDriver;
  const run = (cwd: string, args: ReadonlyArray<string>) =>
    driver.execute({ operation: "test.land.setup", cwd, args, timeoutMs: 10_000 });
  const tmp = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "dw-land-"));
  const main = NodePath.join(tmp, "main");
  const worktree = NodePath.join(tmp, "wt");
  NodeFS.mkdirSync(main);
  yield* run(main, ["init", "-b", "main"]);
  yield* run(main, ["config", "user.email", "dropwave@test"]);
  yield* run(main, ["config", "user.name", "dropwave"]);
  NodeFS.writeFileSync(NodePath.join(main, "file.txt"), "base\n");
  yield* run(main, ["add", "."]);
  yield* run(main, ["commit", "-m", "base"]);
  yield* run(main, ["worktree", "add", "-b", "worker-1", worktree]);
  NodeFS.writeFileSync(NodePath.join(worktree, "file.txt"), "worker change\n");
  NodeFS.writeFileSync(NodePath.join(worktree, "worker-new.txt"), "new file\n");
  yield* run(worktree, ["add", "."]);
  yield* run(worktree, ["commit", "-m", "worker change"]);
  if (opts?.conflict) {
    NodeFS.writeFileSync(NodePath.join(main, "file.txt"), "main change\n");
    yield* run(main, ["add", "."]);
    yield* run(main, ["commit", "-m", "main change"]);
  }
  return { main, worktree };
});

const landTestLayer = (input: {
  readonly threads: Record<string, OrchestrationV2AppThread>;
  readonly subagents?: ReadonlyArray<unknown> | undefined;
  readonly messages?: ReadonlyArray<unknown> | undefined;
  readonly workspaceRoot: string;
  readonly dispatched: Array<OrchestrationV2ServerCommand>;
}) =>
  DropwaveSupervisor.layer.pipe(
    Layer.provideMerge(DropwaveStore.layerMemory),
    Layer.provide(
      Layer.mock(Orchestrator.OrchestratorV2)({
        dispatch: (cmd) =>
          Effect.sync(() => {
            input.dispatched.push(cmd);
            return { sequence: input.dispatched.length } as never;
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThread: (id) => Effect.succeed(input.threads[id] as never),
        getThreadRecords: (id, fields) =>
          Effect.succeed({
            thread: input.threads[id],
            runs: [],
            messages: (fields as ReadonlyArray<string>).includes("messages")
              ? (input.messages ?? [])
              : [],
            subagents: (fields as ReadonlyArray<string>).includes("subagents")
              ? (input.subagents ?? [])
              : [],
            turnItems: [],
          } as never),
      }),
    ),
    Layer.provide(mockProjectStore(input.workspaceRoot)),
    Layer.provide(mockServerSettings()),
    Layer.provide(mockTextGeneration(Effect.succeed({ transcription: "[]" }))),
    Layer.provide(mockProviderInstances()),
    Layer.provideMerge(layerRealGit),
  );

it.effect(
  "dropwave_land merges a completed worker job into the main checkout and enforces authority gates",
  () =>
    Effect.gen(function* () {
      const completedAt = DateTime.makeUnsafe(now.epochMilliseconds - 3_600_000);
      const job = (_overrides?: Record<string, unknown>) =>
        ({
          id: NodeId.make(landJobId),
          threadId: leadId,
          status: "completed",
          title: "Fix pricing",
          childThreadId: workerId,
          completedAt,
        }) as never;
      const lead = (riskLevel: "yolo" | "normal") =>
        makeThread(leadId, "Chief of Staff", {
          kind: "lead",
          brief: "Own it.",
          workflow: [],
          rules: [],
          riskLevel,
        });
      const worker = (worktree: string) => ({
        ...makeThread(workerId, "worker", undefined),
        worktreePath: worktree,
        branch: "worker-1",
      });
      const ownerMessage = (text: string) =>
        ({
          id: MessageId.make("msg:approval"),
          threadId: leadId,
          role: "user",
          text,
          createdBy: "user",
          createdAt: now,
          updatedAt: now,
          attachments: [],
        }) as never;

      // 1. YOLO lands: main checkout gains the worker's commit, the linked ask gets a
      // landed note, and the lead hears about it.
      {
        const repo = yield* setupLandRepo();
        const dispatched: Array<OrchestrationV2ServerCommand> = [];
        yield* Effect.gen(function* () {
          const supervisor = yield* DropwaveSupervisor.DropwaveSupervisor;
          const store = yield* DropwaveStore.DropwaveStore;
          const ask = yield* store.addAsk({
            projectId,
            botThreadId: leadId,
            text: "Fix pricing",
          });
          yield* store.linkJobToAsks({ askIds: [ask.id], jobId: landJobId });
          const result = yield* supervisor.land({ leadThreadId: leadId, jobId: landJobId });
          expect(result.landed).toBe(true);
          expect(result.conflict).toBe(false);
          expect(result.branch).toBe("worker-1");
          expect(result.mergeCommit).toBeTruthy();
          expect(NodeFS.readFileSync(NodePath.join(repo.main, "file.txt"), "utf8")).toBe(
            "worker change\n",
          );
          expect(NodeFS.existsSync(NodePath.join(repo.main, "worker-new.txt"))).toBe(true);
          const updated = yield* store.listAsks({ projectId, includeClosed: true });
          const linkedAsk = updated.find((a) => a.id === ask.id)!;
          expect(
            linkedAsk.history.some(
              (step) => step.note !== undefined && step.note.includes("Landed"),
            ),
          ).toBe(true);
        }).pipe(
          Effect.provide(
            landTestLayer({
              threads: { [leadId]: lead("yolo"), [workerId]: worker(repo.worktree) },
              subagents: [job()],
              workspaceRoot: repo.main,
              dispatched,
            }),
          ),
        );
        expect(
          dispatched.some((cmd) => cmd.type === "message.dispatch" && cmd.threadId === leadId),
        ).toBe(true);
      }

      // 2-4. Normal risk: no quote refuses, a wrong quote refuses, a real owner
      // approval quote after the job completed lands.
      {
        const repo = yield* setupLandRepo();
        const dispatched: Array<OrchestrationV2ServerCommand> = [];
        yield* Effect.gen(function* () {
          const supervisor = yield* DropwaveSupervisor.DropwaveSupervisor;
          const noQuote = yield* Effect.result(
            supervisor.land({ leadThreadId: leadId, jobId: landJobId }),
          );
          expect(noQuote._tag).toBe("Failure");
          const wrongQuote = yield* Effect.result(
            supervisor.land({
              leadThreadId: leadId,
              jobId: landJobId,
              ownerApprovalQuote: "something the owner never said at all",
            }),
          );
          expect(wrongQuote._tag).toBe("Failure");
          const landed = yield* supervisor.land({
            leadThreadId: leadId,
            jobId: landJobId,
            ownerApprovalQuote: "land the pricing fix",
          });
          expect(landed.landed).toBe(true);
          expect(NodeFS.readFileSync(NodePath.join(repo.main, "file.txt"), "utf8")).toBe(
            "worker change\n",
          );
        }).pipe(
          Effect.provide(
            landTestLayer({
              threads: { [leadId]: lead("normal"), [workerId]: worker(repo.worktree) },
              subagents: [job()],
              messages: [ownerMessage("yes please land the pricing fix when it is ready")],
              workspaceRoot: repo.main,
              dispatched,
            }),
          ),
        );
      }

      // 5. Dirty main checkout refuses and stays untouched.
      {
        const repo = yield* setupLandRepo();
        NodeFS.writeFileSync(NodePath.join(repo.main, "file.txt"), "owner wip\n");
        const dispatched: Array<OrchestrationV2ServerCommand> = [];
        yield* Effect.gen(function* () {
          const supervisor = yield* DropwaveSupervisor.DropwaveSupervisor;
          const result = yield* Effect.result(
            supervisor.land({ leadThreadId: leadId, jobId: landJobId }),
          );
          expect(result._tag).toBe("Failure");
          expect(NodeFS.readFileSync(NodePath.join(repo.main, "file.txt"), "utf8")).toBe(
            "owner wip\n",
          );
          expect(NodeFS.existsSync(NodePath.join(repo.main, "worker-new.txt"))).toBe(false);
        }).pipe(
          Effect.provide(
            landTestLayer({
              threads: { [leadId]: lead("yolo"), [workerId]: worker(repo.worktree) },
              subagents: [job()],
              workspaceRoot: repo.main,
              dispatched,
            }),
          ),
        );
      }

      // 6. Conflict aborts: landed:false with the conflicted file, main unchanged.
      {
        const repo = yield* setupLandRepo({ conflict: true });
        const dispatched: Array<OrchestrationV2ServerCommand> = [];
        yield* Effect.gen(function* () {
          const supervisor = yield* DropwaveSupervisor.DropwaveSupervisor;
          const result = yield* supervisor.land({ leadThreadId: leadId, jobId: landJobId });
          expect(result.landed).toBe(false);
          expect(result.conflict).toBe(true);
          expect(result.files).toContain("file.txt");
          expect(NodeFS.readFileSync(NodePath.join(repo.main, "file.txt"), "utf8")).toBe(
            "main change\n",
          );
          const status = yield* (yield* GitVcsDriver.GitVcsDriver).execute({
            operation: "test.land.status",
            cwd: repo.main,
            args: ["status", "--porcelain"],
          });
          expect(status.stdout.trim()).toBe("");
        }).pipe(
          Effect.provide(
            landTestLayer({
              threads: { [leadId]: lead("yolo"), [workerId]: worker(repo.worktree) },
              subagents: [job()],
              workspaceRoot: repo.main,
              dispatched,
            }),
          ),
        );
      }

      // 7. A teammate cannot land.
      {
        const repo = yield* setupLandRepo();
        const dispatched: Array<OrchestrationV2ServerCommand> = [];
        yield* Effect.gen(function* () {
          const supervisor = yield* DropwaveSupervisor.DropwaveSupervisor;
          const result = yield* Effect.result(
            supervisor.land({ leadThreadId: qaId, jobId: landJobId }),
          );
          expect(result._tag).toBe("Failure");
        }).pipe(
          Effect.provide(
            landTestLayer({
              threads: {
                [qaId]: makeThread(qaId, "QA", {
                  kind: "teammate",
                  leadThreadId: leadId,
                  brief: "Verify.",
                }),
                [workerId]: worker(repo.worktree),
              },
              subagents: [job()],
              workspaceRoot: repo.main,
              dispatched,
            }),
          ),
        );
      }
    }).pipe(Effect.provide(layerRealGit)),
);

it.effect("habit deliveries, agent relays and worker threads never write memory", () =>
  Effect.gen(function* () {
    const leadThread = makeThread(leadId, "Chief of Staff", {
      kind: "lead",
      brief: "Own the project.",
      workflow: [],
      rules: [],
      riskLevel: "normal",
    });
    const workerThread = makeThread(workerId, "Fix pricing", undefined);
    const threads: Record<string, OrchestrationV2AppThread> = {
      [leadId]: leadThread,
      [workerId]: workerThread,
    };

    const habitText = "Scheduled check-in: the deploy password is hunter2.";
    const ownerText = "I prefer short answers.";
    const msg = (id: string, threadId: ThreadId, text: string, extra: Record<string, unknown>) => ({
      id: MessageId.make(id),
      threadId,
      role: "user",
      text,
      createdBy: "user",
      createdAt: now,
      updatedAt: now,
      attachments: [],
      ...extra,
    });
    // Six habit deliveries on the lead thread: owner-created and
    // agent-created alike, all tagged scheduledTaskId. Ungated, the sixth
    // would trip the extractor counter.
    const habitMessages = Array.from({ length: 6 }, (_, i) =>
      msg(`msg:habit-${i}`, leadId, habitText, {
        scheduledTaskId: "task:habit-1",
        createdBy: i % 2 === 0 ? "user" : "agent",
      }),
    );
    const workerMessages = [
      msg("msg:worker-1", workerId, "Owner note relayed into the worker: ship it.", {}),
      msg("msg:worker-2", workerId, "Also remember the staging URL.", {}),
    ];
    const ownerMessages = Array.from({ length: 6 }, (_, i) =>
      msg(`msg:owner-${i}`, leadId, `${ownerText} (${i})`, {}),
    );
    const messagesByThread: Record<string, ReadonlyArray<unknown>> = {
      [leadId]: [...habitMessages, ...ownerMessages],
      [workerId]: workerMessages,
    };

    // The ops reply quotes both a real owner line and the habit prompt; the
    // habit quote must be rejected because habit text is not an owner line.
    const opsReply = JSON.stringify([
      {
        op: "add",
        scope: "project",
        kind: "preference",
        subject: "answers",
        text: "Prefers short answers",
        quote: "I prefer short answers",
        confidence: 0.95,
      },
      {
        op: "add",
        scope: "project",
        kind: "fact",
        text: "Deploy password is hunter2",
        quote: "deploy password is hunter2",
        confidence: 0.95,
      },
    ]);
    const memoryModelCalled = yield* Deferred.make<void>();
    const generation = Layer.mock(TextGeneration.TextGeneration)({
      generateTranscriptionPostProcessing: (input: { readonly prompt: string }) =>
        input.prompt.includes("long-term memory")
          ? Deferred.succeed(memoryModelCalled, undefined).pipe(
              Effect.as({ transcription: opsReply }),
            )
          : Effect.succeed({ transcription: "[]" }),
    });
    const testLayer = DropwaveSupervisor.layer.pipe(
      Layer.provideMerge(DropwaveStore.layerMemory),
      Layer.provide(
        Layer.mock(Orchestrator.OrchestratorV2)({
          dispatch: () => Effect.succeed({ sequence: 1 } as never),
        }),
      ),
      Layer.provide(
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThread: (id) => Effect.succeed(threads[id] as never),
          getThreadRecords: (id, fields) =>
            Effect.succeed({
              thread: threads[id],
              runs: [],
              messages: (fields as ReadonlyArray<string>).includes("messages")
                ? (messagesByThread[id] ?? [])
                : [],
              turnItems: [],
            } as never),
        }),
      ),
      Layer.provide(mockProjectStore("/tmp/hivra")),
      Layer.provide(mockServerSettings()),
      Layer.provide(generation),
      Layer.provide(mockProviderInstances()),
      Layer.provideMerge(layerRealGit),
    );

    yield* Effect.gen(function* () {
      const supervisor = yield* DropwaveSupervisor.DropwaveSupervisor;
      const store = yield* DropwaveStore.DropwaveStore;
      const send = (threadId: ThreadId, message: Record<string, unknown>) =>
        supervisor.handle({
          id: EventId.make(`ev:${String(message.id)}`),
          threadId,
          occurredAt: now,
          type: "message.updated",
          payload: message as never,
        });

      for (const message of habitMessages) yield* send(leadId, message as never);
      for (const message of workerMessages) yield* send(workerId, message as never);
      expect(yield* store.getMemoryMeta(`extractor-trigger:${leadId}`)).toBeUndefined();
      expect(yield* store.getMemoryMeta(`extractor-trigger:${workerId}`)).toBeUndefined();
      expect(yield* store.listMemories({ projectId })).toHaveLength(0);

      // Control: six real owner messages run the extractor and write memory,
      // proving the zero-write assertions above are not vacuous.
      for (const message of ownerMessages) yield* send(leadId, message as never);
      yield* Deferred.await(memoryModelCalled);
      for (let i = 0; i < 10; i += 1) yield* Effect.yieldNow;
      const memories = yield* store.listMemories({ projectId });
      expect(memories.some((m) => m.text.includes("Prefers short answers"))).toBe(true);
      expect(memories.some((m) => m.text.includes("hunter2"))).toBe(false);
    }).pipe(Effect.provide(testLayer));
  }),
);

const reviewJobId = "node:job-review-1";
const reviewWorkerId = ThreadId.make("thread:review-worker");

const reviewLead = (rounds?: number) =>
  makeThread(leadId, "Chief of Staff", {
    kind: "lead",
    brief: "Own it.",
    workflow: [],
    rules: [],
    riskLevel: "yolo",
    workerReviewModelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4-codex",
    },
    ...(rounds === undefined ? {} : { workerReviewRounds: rounds }),
  });

const reviewWorker = (worktree: string) => ({
  ...makeThread(reviewWorkerId, "Fix pricing", undefined),
  worktreePath: worktree,
  branch: "worker-1",
});

const reviewTask = (overrides?: Record<string, unknown>) =>
  ({
    id: NodeId.make(reviewJobId),
    threadId: leadId,
    runId: null,
    parentNodeId: NodeId.make("node:parent-run"),
    origin: "app_owned",
    createdBy: "agent",
    driver: ProviderDriverKind.make("claudeAgent"),
    providerInstanceId: ProviderInstanceId.make("claude"),
    providerThreadId: null,
    childThreadId: reviewWorkerId,
    nativeTaskRef: null,
    prompt:
      "Fix the annual pricing bug.\n\nDefinition of done:\n- run npm test\n\n<dropwave_worker>\nboilerplate\n</dropwave_worker>",
    title: "Fix pricing",
    model: null,
    status: "completed",
    result: "Fixed the pricing math; npm test passes.",
    completedAt: now,
    completionDelivery: { state: "pending", observedByRunId: null },
    ...overrides,
  }) as never;

const reviewerInstance = {
  instanceId: ProviderInstanceId.make("codex"),
  snapshot: {
    getSnapshot: Effect.succeed({
      models: [{ slug: "gpt-5.4-codex", name: "Codex 5.4" }],
    }),
  },
} as never;

const approveVerdict = {
  verdict: "approve" as const,
  summary: "The diff does what the brief asked and the checks pass.",
  issues: [],
};

const changesVerdict = {
  verdict: "changes" as const,
  summary: "Negative amounts still crash the pricing path.",
  issues: [
    {
      severity: "blocker" as const,
      file: "src/pricing.ts",
      line: 42,
      problem: "Negative amounts are not handled.",
      fix: "Reject or clamp negative amounts before computing the total.",
    },
  ],
};

const reviewTestLayer = (input: {
  readonly threads: Record<string, OrchestrationV2AppThread>;
  readonly subagents?: ReadonlyArray<unknown> | undefined;
  readonly messagesByThread?: Record<string, ReadonlyArray<unknown>> | undefined;
  readonly workspaceRoot: string;
  readonly dispatched: Array<OrchestrationV2ServerCommand>;
  readonly reviewHandler?:
    | ((
        call: number,
        reviewInput: WorkerReviewGenerationInput,
      ) => Effect.Effect<WorkerReviewGenerationResult, TextGenerationError>)
    | undefined;
  readonly reviewInputs?: Array<WorkerReviewGenerationInput> | undefined;
}) => {
  let calls = 0;
  return DropwaveSupervisor.layer.pipe(
    Layer.provideMerge(DropwaveStore.layerMemory),
    Layer.provide(
      Layer.mock(Orchestrator.OrchestratorV2)({
        dispatch: (cmd) =>
          Effect.sync(() => {
            input.dispatched.push(cmd);
            return { sequence: input.dispatched.length } as never;
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectionStore.ProjectionStoreV2)({
        getThread: (id) => Effect.succeed(input.threads[id] as never),
        getThreadRecords: (id, fields) =>
          Effect.succeed({
            thread: input.threads[id],
            runs: [],
            messages: (fields as ReadonlyArray<string>).includes("messages")
              ? (input.messagesByThread?.[id] ?? [])
              : [],
            subagents: (fields as ReadonlyArray<string>).includes("subagents")
              ? (input.subagents ?? [])
              : [],
            turnItems: [],
          } as never),
      }),
    ),
    Layer.provide(mockProjectStore(input.workspaceRoot)),
    Layer.provide(mockServerSettings()),
    Layer.provide(
      Layer.mock(TextGeneration.TextGeneration)({
        generateTranscriptionPostProcessing: () => Effect.succeed({ transcription: "[]" }),
        generateWorkerReview: (reviewInput: WorkerReviewGenerationInput) => {
          calls += 1;
          input.reviewInputs?.push(reviewInput);
          return (input.reviewHandler ?? (() => Effect.succeed(approveVerdict)))(
            calls,
            reviewInput,
          );
        },
      }),
    ),
    Layer.provide(
      Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
        listInstances: Effect.succeed([reviewerInstance]),
      }),
    ),
    Layer.provideMerge(layerRealGit),
  );
};

const completedSubagentEvent = (task: unknown, key: string): OrchestrationV2DomainEvent =>
  ({
    id: EventId.make(`ev:${key}`),
    threadId: leadId,
    occurredAt: now,
    type: "subagent.updated",
    payload: task,
  }) as never;

it.effect(
  "fusion review approves a clean worker diff, wakes the lead once with the verdict, and stays idempotent",
  () =>
    Effect.gen(function* () {
      const repo = yield* setupLandRepo();
      const dispatched: Array<OrchestrationV2ServerCommand> = [];
      const reviewInputs: Array<WorkerReviewGenerationInput> = [];
      yield* Effect.gen(function* () {
        const supervisor = yield* DropwaveSupervisor.DropwaveSupervisor;
        const store = yield* DropwaveStore.DropwaveStore;

        yield* supervisor.handle(completedSubagentEvent(reviewTask(), "sub-1"));
        yield* supervisor.awaitWorkerReview(reviewJobId);

        const review = yield* store.getWorkerReview(reviewJobId);
        expect(review?.status).toBe("approved");
        expect(review?.verdicts).toHaveLength(1);
        expect(review?.verdicts[0]?.verdict).toBe("approve");
        expect(review?.verdicts[0]?.reviewerModel).toBe("Codex 5.4");

        // The reviewer saw the stripped brief, the worker report, and the real diff.
        expect(reviewInputs).toHaveLength(1);
        expect(reviewInputs[0]?.brief).toBe(
          "Fix the annual pricing bug.\n\nDefinition of done:\n- run npm test",
        );
        expect(reviewInputs[0]?.doneChecks).toContain("npm test");
        expect(reviewInputs[0]?.workerReport).toContain("npm test passes");
        expect(String(reviewInputs[0]?.diff)).toContain("worker change");
        expect(reviewInputs[0]?.cwd).toBe(repo.worktree);
        expect(reviewInputs[0]?.investigate).toBe(true);

        // Exactly one wake, carrying the review block.
        const wakes = dispatched.filter(
          (cmd) => cmd.type === "message.dispatch" && cmd.threadId === leadId,
        );
        expect(wakes).toHaveLength(1);
        const wakeText = (wakes[0] as { text: string }).text;
        expect(wakeText).toContain("Review (Codex 5.4): approved");
        expect(wakeText).toContain("does what the brief asked");

        // The delegated wake is claimed so the generic continuation stays silent.
        const claimed = yield* claimDelegatedWake({
          threadId: leadId,
          taskIds: [reviewJobId],
        });
        expect(claimed).toEqual([reviewJobId]);

        // Duplicate completion events do not start a second review or wake.
        yield* supervisor.handle(completedSubagentEvent(reviewTask(), "sub-2"));
        yield* supervisor.awaitWorkerReview(reviewJobId);
        const after = yield* store.getWorkerReview(reviewJobId);
        expect(after?.verdicts).toHaveLength(1);
        expect(
          dispatched.filter((cmd) => cmd.type === "message.dispatch" && cmd.threadId === leadId),
        ).toHaveLength(1);
      }).pipe(
        Effect.provide(
          reviewTestLayer({
            threads: { [leadId]: reviewLead(), [reviewWorkerId]: reviewWorker(repo.worktree) },
            subagents: [reviewTask()],
            messagesByThread: {
              [reviewWorkerId]: [
                {
                  id: MessageId.make("msg:worker-report"),
                  threadId: reviewWorkerId,
                  role: "assistant",
                  text: "Fixed the pricing math; npm test passes.",
                  createdBy: "agent",
                  createdAt: now,
                  updatedAt: now,
                  attachments: [],
                },
              ],
            },
            workspaceRoot: repo.main,
            dispatched,
            reviewInputs,
          }),
        ),
      );
    }).pipe(Effect.provide(layerRealGit)),
);

it.effect("fusion review sends blocker issues back to the worker, re-reviews, and approves", () =>
  Effect.gen(function* () {
    const repo = yield* setupLandRepo();
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    yield* Effect.gen(function* () {
      const supervisor = yield* DropwaveSupervisor.DropwaveSupervisor;
      const store = yield* DropwaveStore.DropwaveStore;

      yield* supervisor.handle(completedSubagentEvent(reviewTask(), "sub-fix"));
      // Parked on the worker's fix round before we release it.
      yield* supervisor.awaitWorkerFixRound(reviewWorkerId);
      const fixing = yield* store.getWorkerReview(reviewJobId);
      expect(fixing?.status).toBe("fixing");
      expect(fixing?.rounds).toBe(1);
      expect(
        dispatched.some(
          (cmd) =>
            cmd.type === "message.dispatch" &&
            cmd.threadId === reviewWorkerId &&
            (cmd as { text: string }).text.includes("A reviewer checked your work"),
        ),
      ).toBe(true);

      // The worker's fix run reaches a terminal state; the loop re-reviews.
      yield* supervisor.handle({
        id: EventId.make("ev:fix-done"),
        threadId: reviewWorkerId,
        occurredAt: now,
        type: "run.updated",
        payload: {
          id: RunId.make("run:fix-1"),
          threadId: reviewWorkerId,
          status: "completed",
          startedAt: now,
        } as never,
      });
      yield* supervisor.awaitWorkerReview(reviewJobId);

      const review = yield* store.getWorkerReview(reviewJobId);
      expect(review?.status).toBe("approved");
      expect(review?.verdicts.map((v) => v.verdict)).toEqual(["changes", "approve"]);
      expect(review?.verdicts[0]?.round).toBe(0);
      expect(review?.verdicts[1]?.round).toBe(1);
      const wakes = dispatched.filter(
        (cmd) => cmd.type === "message.dispatch" && cmd.threadId === leadId,
      );
      expect(wakes).toHaveLength(1);
      expect((wakes[0] as { text: string }).text).toContain("Review (Codex 5.4): approved");
    }).pipe(
      Effect.provide(
        reviewTestLayer({
          threads: { [leadId]: reviewLead(1), [reviewWorkerId]: reviewWorker(repo.worktree) },
          subagents: [reviewTask()],
          workspaceRoot: repo.main,
          dispatched,
          reviewHandler: (call) => Effect.succeed(call === 1 ? changesVerdict : approveVerdict),
        }),
      ),
    );
  }).pipe(Effect.provide(layerRealGit)),
);

it.effect("fusion review reports changes still requested after the fix-round cap", () =>
  Effect.gen(function* () {
    const repo = yield* setupLandRepo();
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    yield* Effect.gen(function* () {
      const supervisor = yield* DropwaveSupervisor.DropwaveSupervisor;
      const store = yield* DropwaveStore.DropwaveStore;

      yield* supervisor.handle(completedSubagentEvent(reviewTask(), "sub-cap"));
      yield* supervisor.awaitWorkerFixRound(reviewWorkerId);
      yield* supervisor.handle({
        id: EventId.make("ev:fix-done-2"),
        threadId: reviewWorkerId,
        occurredAt: now,
        type: "run.updated",
        payload: {
          id: RunId.make("run:fix-2"),
          threadId: reviewWorkerId,
          status: "completed",
          startedAt: now,
        } as never,
      });
      yield* supervisor.awaitWorkerReview(reviewJobId);

      const review = yield* store.getWorkerReview(reviewJobId);
      expect(review?.status).toBe("changes");
      expect(review?.verdicts).toHaveLength(2);
      const wakes = dispatched.filter(
        (cmd) => cmd.type === "message.dispatch" && cmd.threadId === leadId,
      );
      expect(wakes).toHaveLength(1);
      const wakeText = (wakes[0] as { text: string }).text;
      expect(wakeText).toContain("changes still requested after 1 round");
      expect(wakeText).toContain("Negative amounts");
    }).pipe(
      Effect.provide(
        reviewTestLayer({
          threads: { [leadId]: reviewLead(1), [reviewWorkerId]: reviewWorker(repo.worktree) },
          subagents: [reviewTask()],
          workspaceRoot: repo.main,
          dispatched,
          reviewHandler: () => Effect.succeed(changesVerdict),
        }),
      ),
    );
  }).pipe(Effect.provide(layerRealGit)),
);

it.effect("fusion review marks reviewer failures unreviewed instead of blocking", () =>
  Effect.gen(function* () {
    const repo = yield* setupLandRepo();
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    yield* Effect.gen(function* () {
      const supervisor = yield* DropwaveSupervisor.DropwaveSupervisor;
      const store = yield* DropwaveStore.DropwaveStore;

      yield* supervisor.handle(completedSubagentEvent(reviewTask(), "sub-fail"));
      yield* supervisor.awaitWorkerReview(reviewJobId);

      const review = yield* store.getWorkerReview(reviewJobId);
      expect(review?.status).toBe("unreviewed");
      expect(review?.verdicts[0]?.verdict).toBe("unreviewed");
      expect(review?.verdicts[0]?.reason).toContain("boom");
      const wakes = dispatched.filter(
        (cmd) => cmd.type === "message.dispatch" && cmd.threadId === leadId,
      );
      expect(wakes).toHaveLength(1);
      expect((wakes[0] as { text: string }).text).toContain("unreviewed");
    }).pipe(
      Effect.provide(
        reviewTestLayer({
          threads: { [leadId]: reviewLead(), [reviewWorkerId]: reviewWorker(repo.worktree) },
          subagents: [reviewTask()],
          workspaceRoot: repo.main,
          dispatched,
          reviewHandler: () =>
            Effect.fail(
              new TextGenerationError({ operation: "generateWorkerReview", detail: "boom" }),
            ),
        }),
      ),
    );
  }).pipe(Effect.provide(layerRealGit)),
);

it.effect("without a reviewer model the completed worker path is untouched", () =>
  Effect.gen(function* () {
    const repo = yield* setupLandRepo();
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    const plainLead = makeThread(leadId, "Chief of Staff", {
      kind: "lead",
      brief: "Own it.",
      workflow: [],
      rules: [],
      riskLevel: "yolo",
    });
    yield* Effect.gen(function* () {
      const supervisor = yield* DropwaveSupervisor.DropwaveSupervisor;
      const store = yield* DropwaveStore.DropwaveStore;

      yield* supervisor.handle(completedSubagentEvent(reviewTask(), "sub-plain"));
      // No review record, and the wake claim leaves the job for the generic path.
      expect(yield* store.getWorkerReview(reviewJobId)).toBeNull();
      const claimed = yield* claimDelegatedWake({
        threadId: leadId,
        taskIds: [reviewJobId],
      });
      expect(claimed).toEqual([]);
      expect(dispatched).toHaveLength(0);
    }).pipe(
      Effect.provide(
        reviewTestLayer({
          threads: { [leadId]: plainLead, [reviewWorkerId]: reviewWorker(repo.worktree) },
          subagents: [reviewTask()],
          workspaceRoot: repo.main,
          dispatched,
        }),
      ),
    );
  }).pipe(Effect.provide(layerRealGit)),
);

it.effect("dropwave_land refuses while reviewing or on changes, and an owner quote overrides", () =>
  Effect.gen(function* () {
    const repo = yield* setupLandRepo();
    const dispatched: Array<OrchestrationV2ServerCommand> = [];
    const ownerMessage = {
      id: MessageId.make("msg:land-approval"),
      threadId: leadId,
      role: "user",
      text: "yes, land it anyway",
      createdBy: "user",
      createdAt: now,
      updatedAt: now,
      attachments: [],
    } as never;
    yield* Effect.gen(function* () {
      const supervisor = yield* DropwaveSupervisor.DropwaveSupervisor;
      const store = yield* DropwaveStore.DropwaveStore;

      yield* store.startWorkerReview({
        jobId: landJobId,
        leadThreadId: leadId,
        projectId,
        workerThreadId: workerId,
        workerBranch: "worker-1",
        maxRounds: 1,
      });

      // Still reviewing: refused outright.
      const reviewing = yield* Effect.result(
        supervisor.land({ leadThreadId: leadId, jobId: landJobId }),
      );
      expect(reviewing._tag).toBe("Failure");

      yield* store.appendWorkerReviewVerdict({
        jobId: landJobId,
        verdict: {
          round: 0,
          verdict: "changes",
          summary: "Issues found.",
          issues: [
            {
              severity: "blocker",
              file: "a.ts",
              line: null,
              problem: "Broken",
              fix: "Fix it",
            },
          ],
          reviewerModel: "Codex 5.4",
          at: DateTime.formatIso(DateTime.nowUnsafe()) as IsoDateTime,
        },
      });
      yield* store.updateWorkerReview({ jobId: landJobId, status: "changes" });

      // Changes requested, no quote: refused even on yolo.
      const refused = yield* Effect.result(
        supervisor.land({ leadThreadId: leadId, jobId: landJobId }),
      );
      expect(refused._tag).toBe("Failure");
      if (refused._tag === "Failure") {
        expect(refused.failure.message).toContain("reviewer requested changes");
      }

      // Owner approval quote overrides; the override is recorded.
      const landed = yield* supervisor.land({
        leadThreadId: leadId,
        jobId: landJobId,
        ownerApprovalQuote: "land it anyway",
      });
      expect(landed.landed).toBe(true);
      const review = yield* store.getWorkerReview(landJobId);
      expect(review?.landOverride?.quote).toBe("land it anyway");
      expect(NodeFS.readFileSync(NodePath.join(repo.main, "file.txt"), "utf8")).toBe(
        "worker change\n",
      );
    }).pipe(
      Effect.provide(
        landTestLayer({
          threads: {
            [leadId]: reviewLead(),
            [workerId]: {
              ...makeThread(workerId, "worker", undefined),
              worktreePath: repo.worktree,
              branch: "worker-1",
            },
          },
          subagents: [
            {
              id: NodeId.make(landJobId),
              threadId: leadId,
              status: "completed",
              title: "Fix pricing",
              childThreadId: workerId,
              completedAt: DateTime.makeUnsafe(now.epochMilliseconds - 3_600_000),
            },
          ],
          messages: [ownerMessage],
          workspaceRoot: repo.main,
          dispatched,
        }),
      ),
    );
  }).pipe(Effect.provide(layerRealGit)),
);
