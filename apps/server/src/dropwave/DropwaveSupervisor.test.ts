import { expect, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
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
        const ask1 = openAsks[0]!;
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
        expect(afterFail.find((a) => a.id === ask1.id)?.status).toBe("heard");
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
