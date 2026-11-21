// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off globalConsole:off globalFetch:off -- a CLI runner, not library code.
// Dropwave crew live eval: real T3 server on its own home, real provider CLI, real repos.
// Usage: vpr dropwave-crew --out runs/<name> [--case a,b] [--samples n]
//        [--provider <instanceId-substr>] [--model <model-substr>] [--keep-homes]
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";
import * as NodeWS from "@effect/platform-node/NodeWS";
import {
  CommandId,
  EnvironmentHttpApi,
  MessageId,
  ORCHESTRATION_PROTOCOL_VERSION,
  ProjectId,
  ThreadId,
  WsRpcGroup,
  type DropwaveAsk,
  type DropwaveMemoryItem,
  type DropwavePersona,
  type ModelSelection,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import {
  configureDropwaveProject,
  wireChiefOfStaff,
  type DropwaveSetupDeps,
} from "@t3tools/client-runtime/dropwave-setup";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import { FetchHttpClient } from "effect/http";
import * as Layer from "effect/Layer";
import { RpcClient, RpcSerialization } from "effect/rpc";
import { Socket } from "effect/socket";
import * as Stream from "effect/Stream";
import * as Scope from "effect/Scope";

import { LIVE_EVAL_CASES, type LiveEvalCase } from "./cases.ts";
import { evaluateCheck, type CaseState, type CheckResult, type JobInfo } from "./grade.ts";

const parsed = NodeUtil.parseArgs({
  options: {
    out: { type: "string" },
    case: { type: "string" },
    samples: { type: "string", default: "1" },
    provider: { type: "string" },
    model: { type: "string" },
    "keep-homes": { type: "boolean", default: false },
  },
});
const outDir = parsed.values.out;
if (!outDir) {
  console.error(
    "usage: --out <dir> [--case a,b] [--samples n] [--provider i] [--model m] [--keep-homes]",
  );
  process.exit(2);
}
const onlyCases = parsed.values.case ? new Set(parsed.values.case.split(",")) : undefined;
const samples = Number.parseInt(parsed.values.samples ?? "1", 10);
const keepHomes = parsed.values["keep-homes"] === true;

const REPO_ROOT = NodePath.resolve(import.meta.dirname, "../..");
const SERVER_ENTRY = NodePath.join(REPO_ROOT, "apps/server/src/bin.ts");

const newId = <T extends string>(prefix = ""): T => `${prefix}${NodeCrypto.randomUUID()}` as T;
const newCommandId = () => newId<CommandId>();
const newThreadId = () => newId<ThreadId>();
const newMessageId = () => newId<MessageId>();
const newProjectId = () => newId<ProjectId>();

type WsClient = RpcClient.FromGroup<typeof WsRpcGroup>;

interface RunningServer {
  readonly home: string;
  readonly origin: string;
  readonly pid: number;
  readonly token: string;
  readonly scope: Scope.Closeable;
  readonly rpc: WsClient;
  readonly stop: () => Promise<void>;
}

const startedServers: Array<{ pid: number; home: string }> = [];

function call<O, E>(promise: Effect.Effect<O, E>): Promise<O> {
  return Effect.runPromise(promise);
}

async function freePort(): Promise<number> {
  const server = NodeNet.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function waitForFile(path: string, timeoutMs: number): Promise<void> {
  if (NodeFS.existsSync(path)) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      watcher.close();
      reject(new Error(`timed out waiting for ${path}`));
    }, timeoutMs);
    const watchRoot = (() => {
      let dir = NodePath.dirname(path);
      while (!NodeFS.existsSync(dir)) {
        const parent = NodePath.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      return dir;
    })();
    const watcher = NodeFS.watch(watchRoot, { recursive: true }, () => {
      if (NodeFS.existsSync(path)) {
        clearTimeout(timer);
        watcher.close();
        resolve();
      }
    });
    if (NodeFS.existsSync(path)) {
      clearTimeout(timer);
      watcher.close();
      resolve();
    }
  });
}

async function startServer(home: string): Promise<RunningServer> {
  const port = await freePort();
  const proc = NodeChildProcess.spawn(
    process.execPath,
    [SERVER_ENTRY, "serve", "--base-dir", home, "--port", String(port)],
    { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (proc.pid === undefined) throw new Error("server failed to spawn");
  const pid = proc.pid;
  startedServers.push({ pid, home });
  let stderr = "";
  proc.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  proc.stdout.on("data", () => {});
  const runtimePath = NodePath.join(home, "userdata", "server-runtime.json");
  try {
    await waitForFile(runtimePath, 60_000);
  } catch (cause) {
    throw new Error(`server did not start in ${home}\n${stderr.slice(-2000)}`, { cause });
  }
  const runtime = JSON.parse(NodeFS.readFileSync(runtimePath, "utf8")) as { origin: string };
  const issued = NodeChildProcess.execFileSync(
    process.execPath,
    [SERVER_ENTRY, "auth", "session", "issue", "--token-only", "--base-dir", home],
    { cwd: REPO_ROOT, encoding: "utf8" },
  ).trim();
  const ticket = (await (
    await fetch(`${runtime.origin}/api/auth/websocket-ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${issued}` },
    })
  ).json()) as { ticket: string };
  const wsUrl = `${runtime.origin.replace(/^http/, "ws")}/ws?orchestrationProtocol=${ORCHESTRATION_PROTOCOL_VERSION}&wsTicket=${encodeURIComponent(ticket.ticket)}`;
  const scope = await Effect.runPromise(Scope.make());
  const protocol = await Effect.runPromise(
    Layer.build(
      RpcClient.layerProtocolSocket().pipe(
        Layer.provide(Socket.layerWebSocket(wsUrl)),
        Layer.provide(RpcSerialization.layerJson),
        Layer.provide(NodeWS.layerWebSocketConstructor),
      ),
    ).pipe(Effect.provideService(Scope.Scope, scope)),
  );
  const rpc = (await Effect.runPromise(
    RpcClient.make(WsRpcGroup).pipe(
      Effect.provideContext(protocol),
      Effect.provideService(Scope.Scope, scope),
    ),
  )) as WsClient;
  return {
    home,
    origin: runtime.origin,
    pid,
    token: issued,
    scope,
    rpc,
    stop: async () => {
      await Effect.runPromise(Scope.close(scope, Exit.void as never)).catch(() => {});
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already gone */
      }
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 10_000);
        proc.once("exit", () => {
          clearTimeout(t);
          resolve();
        });
      });
    },
  };
}

const ACTIVE_RUN_STATUSES = new Set(["preparing", "queued", "starting", "running", "waiting"]);
const ACTIVE_JOB_STATUSES = new Set(["pending", "running", "waiting"]);

interface CaseContext {
  readonly server: RunningServer;
  projectId: ProjectId;
  readonly projectTitle: string;
  workspaceRoot: string;
  readonly threads: Map<ThreadId, OrchestrationV2ThreadShell>;
  leadId?: ThreadId;
}

class SettleTracker {
  private waiters: Array<{ check: () => Promise<boolean>; resolve: () => void }> = [];
  private evaluating = false;
  timedOut = false;
  private deadline?: NodeJS.Timeout;

  arm(timeoutMs: number) {
    this.deadline = setTimeout(() => {
      this.timedOut = true;
      const waiters = this.waiters.splice(0);
      for (const w of waiters) w.resolve();
    }, timeoutMs);
  }
  disarm() {
    if (this.deadline) clearTimeout(this.deadline);
  }
  /** Called on every shell event; re-evaluates waiters (event-driven, no polling). */
  poke() {
    if (this.evaluating) return;
    this.evaluating = true;
    void this.evaluate().finally(() => {
      this.evaluating = false;
      if (this.waiters.length > 0) this.poke();
    });
  }
  private async evaluate() {
    if (this.waiters.length === 0) return;
    const ready: Array<() => void> = [];
    const keep: typeof this.waiters = [];
    for (const w of this.waiters) {
      try {
        if (await w.check()) ready.push(w.resolve);
        else keep.push(w);
      } catch {
        keep.push(w); // transient RPC failure mid-run: keep waiting
      }
    }
    this.waiters = keep;
    for (const r of ready) r();
  }
  wait(check: () => Promise<boolean>): Promise<void> {
    return new Promise((resolve) => {
      this.waiters.push({ check, resolve });
      this.poke();
    });
  }
}

async function createFixtureProject(
  server: RunningServer,
  caseDef: LiveEvalCase,
  dir: string,
): Promise<ProjectId> {
  for (const [file, content] of Object.entries(caseDef.project.files)) {
    const p = NodePath.join(dir, file);
    NodeFS.mkdirSync(NodePath.dirname(p), { recursive: true });
    NodeFS.writeFileSync(p, content);
  }
  const git = (args: string[]) =>
    NodeChildProcess.execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git(["init", "--quiet", "--initial-branch=main"]);
  git(["add", "--all"]);
  git([
    "-c",
    "user.name=Eval",
    "-c",
    "user.email=eval@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "Initial commit",
  ]);
  const projectId = newProjectId();
  const client = await Effect.runPromise(
    HttpApiClient.make(EnvironmentHttpApi, { baseUrl: server.origin }).pipe(
      Effect.provide(FetchHttpClient.layer),
    ),
  );
  await Effect.runPromise(
    client.projects.mutate({
      headers: { authorization: `Bearer ${server.token}` },
      payload: {
        type: "project.create",
        commandId: newCommandId(),
        projectId,
        title: caseDef.project.title,
        workspaceRoot: dir,
      },
    }),
  );
  return projectId;
}

function setupDeps(server: RunningServer): DropwaveSetupDeps {
  const rpc = server.rpc;
  return {
    listPersonas: async () =>
      ((await call(rpc["dropwave.persona.list"]({}))) as { items: DropwavePersona[] }).items,
    upsertPersona: async (input: Parameters<DropwaveSetupDeps["upsertPersona"]>[0]) =>
      ((await call(rpc["dropwave.persona.upsert"](input))) as { item: DropwavePersona }).item,
    createThread: async (input: Parameters<DropwaveSetupDeps["createThread"]>[0]) => {
      await call(
        rpc["orchestration.dispatchCommand"]({
          type: "thread.create",
          commandId: newCommandId(),
          createdBy: "user",
          creationSource: "web",
          threadId: input.threadId,
          projectId: input.projectId,
          title: input.title,
          dropwaveBot: input.dropwaveBot,
          modelSelection: input.modelSelection,
          runtimeMode: input.runtimeMode,
          interactionMode: input.interactionMode,
          branch: null,
          worktreePath: null,
        } as unknown as OrchestrationV2Command),
      );
    },
    sendMessage: async (input: Parameters<DropwaveSetupDeps["sendMessage"]>[0]) => {
      await call(
        rpc["orchestration.dispatchCommand"]({
          type: "message.dispatch",
          commandId: newCommandId(),
          createdBy: "user",
          creationSource: "web",
          threadId: input.threadId,
          messageId: input.messageId,
          text: input.text,
          attachments: [],
          dispatchMode: { type: "start_immediately" },
        } as unknown as OrchestrationV2Command),
      );
    },
    newThreadId,
    newMessageId,
  };
}

async function getProjection(server: RunningServer, threadId: ThreadId) {
  return (await call(
    server.rpc["orchestration.getThreadProjection"]({ threadId }),
  )) as OrchestrationV2ThreadProjection;
}

async function collectState(ctx: CaseContext): Promise<CaseState> {
  const { server, projectId } = ctx;
  const rpc = server.rpc;
  const asks = (
    (await call(rpc["dropwave.asks.list"]({ projectId, includeClosed: true }))) as {
      asks: DropwaveAsk[];
    }
  ).asks;
  const memories = (
    (await call(rpc["dropwave.memory.list"]({ projectId }))) as { items: DropwaveMemoryItem[] }
  ).items;
  const personas = ((await call(rpc["dropwave.persona.list"]({}))) as { items: DropwavePersona[] })
    .items;
  const docs = await call(rpc["dropwave.docs.list"]({ projectId }));
  const docBodies: Array<{ kind: string; text: string }> = [];
  for (const doc of docs.docs ?? []) {
    try {
      const read = (await call(
        rpc["dropwave.docs.read"]({ projectId, path: doc.path ?? doc.kind } as never),
      )) as { content?: string; body?: string; doc?: { content?: string } };
      docBodies.push({
        kind: doc.kind,
        text: read.content ?? read.body ?? read.doc?.content ?? JSON.stringify(read),
      });
    } catch {
      docBodies.push({ kind: doc.kind, text: "" });
    }
  }
  const projections = new Map<ThreadId, OrchestrationV2ThreadProjection>();
  for (const [id, shell] of ctx.threads) {
    if (shell.projectId !== projectId) continue;
    try {
      projections.set(id, await getProjection(server, id));
    } catch {
      /* thread may be gone */
    }
  }
  const leadProjection = ctx.leadId ? projections.get(ctx.leadId) : undefined;
  const leadProfile =
    leadProjection?.thread.dropwaveBot?.kind === "lead"
      ? leadProjection.thread.dropwaveBot
      : undefined;
  // A lead "reply" is the final assistant message of each run: providers emit short
  // preamble items ("I'll check…") ahead of the real answer within one turn.
  const leadReplyByRun = new Map<string, { text: string }>();
  for (const m of leadProjection?.messages ?? []) {
    if (m.role !== "assistant" || m.streaming) continue;
    leadReplyByRun.set(m.runId ?? m.id, { text: m.text });
  }
  const leadReplies = [...leadReplyByRun.values()];
  const leadFileChanges = [...projections.entries()].flatMap(([id, p]) =>
    p.thread.dropwaveBot?.kind === "lead" && ctx.threads.get(id)?.projectId === projectId
      ? p.turnItems.filter((item) => item.type === "file_change")
      : [],
  );
  // Supervisor direct-edit counters live in the eval home's dropwave.sqlite.
  let supervisorEditCount = 0;
  try {
    const db = new NodeSqlite.DatabaseSync(
      NodePath.join(server.home, "userdata", "dropwave.sqlite"),
      {
        readOnly: true,
      },
    );
    const rows = db
      .prepare(
        "SELECT key, value_json FROM dropwave_supervisor_kv WHERE key LIKE 'lead-direct-edit:%'",
      )
      .all() as Array<{ key: string; value_json: string }>;
    db.close();
    supervisorEditCount = rows
      .filter((r) => !r.key.startsWith("lead-direct-edit-seen:"))
      .reduce((sum, r) => sum + (Number(JSON.parse(r.value_json)) || 0), 0);
  } catch {
    supervisorEditCount = -1; // db missing or unreadable: report, don't fabricate
  }
  const jobs: JobInfo[] = [];
  const seenJobs = new Set<string>();
  for (const [, p] of projections) {
    if (p.thread.dropwaveBot?.kind !== "lead") continue;
    for (const sub of p.subagents) {
      if (seenJobs.has(sub.id)) continue;
      seenJobs.add(sub.id);
      let worktreePath: string | undefined;
      if (sub.childThreadId !== null) {
        const child = ctx.threads.get(sub.childThreadId);
        worktreePath = child?.worktreePath ?? undefined;
        if (!worktreePath) {
          try {
            const childProjection = await getProjection(server, sub.childThreadId);
            worktreePath = childProjection.thread.worktreePath ?? undefined;
          } catch {
            /* child gone */
          }
        }
      }
      jobs.push({
        id: sub.id,
        status: sub.status,
        title: sub.title ?? undefined,
        modelSelection: sub.modelSelection ?? undefined,
        worktreePath,
        startedAt: sub.startedAt ? DateTime.toEpochMillis(sub.startedAt) : undefined,
        completedAt: sub.completedAt ? DateTime.toEpochMillis(sub.completedAt) : undefined,
      });
    }
  }
  const teammateMessages = new Map<
    string,
    Array<{ text: string; senderThreadId?: string | undefined }>
  >();
  for (const [, p] of projections) {
    const bot = p.thread.dropwaveBot;
    if (bot?.kind !== "teammate") continue;
    teammateMessages.set(
      bot.role ?? p.thread.title,
      p.messages.map((m) => ({
        text: m.text,
        senderThreadId: m.senderThreadId as string | undefined,
      })),
    );
  }
  return {
    asks,
    memories,
    personas,
    docs: docBodies,
    leadReplies: leadReplies.map((m) => m.text),
    leadFileChangeCount: leadFileChanges.length,
    supervisorEditCount,
    jobs,
    teammateMessages,
    leadProfile,
    personasById: new Map(personas.map((p) => [p.id, p])),
    teammateProfiles: [...projections.values()].flatMap((p) => {
      const bot = p.thread.dropwaveBot;
      return bot?.kind === "teammate" ? [{ title: p.thread.title, role: bot.role ?? "" }] : [];
    }),
    workspaceRoot: ctx.workspaceRoot,
  };
}

async function runCase(
  server: RunningServer,
  caseDef: LiveEvalCase,
  sample: number,
): Promise<{ row: Record<string, unknown> }> {
  const startedAt = Date.now();
  const tracker = new SettleTracker();
  tracker.arm(caseDef.timeoutMinutes * 60_000);
  const ctx: CaseContext = {
    server,
    projectId: newProjectId(),
    projectTitle: caseDef.project.title,
    workspaceRoot: "",
    threads: new Map(),
  };
  const notes: string[] = [];
  let step = "init";
  try {
    // Subscribe to the shell stream for event-driven settle waits.
    const stream = server.rpc["orchestration.subscribeShell"](
      {} as never,
    ) as unknown as Stream.Stream<{
      kind: string;
      thread?: OrchestrationV2ThreadShell;
      threadId?: ThreadId;
      snapshot?: { threads?: OrchestrationV2ThreadShell[] };
    }>;
    Effect.runFork(
      Stream.runForEach(stream, (item) =>
        Effect.sync(() => {
          if (item.kind === "thread.updated" && item.thread) {
            ctx.threads.set(item.thread.id, item.thread);
          } else if (item.kind === "snapshot" && item.snapshot?.threads) {
            for (const t of item.snapshot.threads) ctx.threads.set(t.id, t);
          } else if (item.kind === "thread.removed" && item.threadId) {
            ctx.threads.delete(item.threadId);
          }
          tracker.poke();
        }),
      ).pipe(Effect.ignore),
    );

    const workspaceRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), `dwe-${caseDef.id}-`));
    ctx.workspaceRoot = NodePath.join(workspaceRoot, caseDef.project.title);
    step = "fixture";
    const projectId = await createFixtureProject(server, caseDef, ctx.workspaceRoot);
    ctx.projectId = projectId;

    type EvalProvider = {
      instanceId: string;
      driver?: string;
      availability?: string;
      models: Array<{ slug: string; isDefault?: boolean }>;
    };
    const pickProvider = (providers: EvalProvider[]) =>
      providers.find((p) =>
        parsed.values.provider
          ? p.instanceId.includes(parsed.values.provider!) ||
            p.driver?.includes(parsed.values.provider!)
          : p.instanceId.includes("codex") || p.driver === "codex",
      ) ?? providers.find((p) => p.models.length > 0);
    step = "providers";
    // Provider catalogs land asynchronously after the server boots; wait on the
    // config stream until the chosen provider reports its models.
    const provider = await new Promise<EvalProvider>((resolve, reject) => {
      let providers: EvalProvider[] = [];
      const timer = setTimeout(
        () => reject(new Error("timed out waiting for provider model catalog")),
        120_000,
      );
      const stream = server.rpc["subscribeServerConfig"]({}) as unknown as Stream.Stream<{
        type: string;
        config?: { providers?: EvalProvider[] };
        payload?: { providers?: EvalProvider[] };
      }>;
      Effect.runFork(
        Stream.runForEachWhile(stream, (event) =>
          Effect.sync(() => {
            if (event.type === "snapshot" && event.config?.providers) {
              providers = event.config.providers;
            } else if (
              (event.type === "providerStatuses" || event.type === "providerStatusDeltas") &&
              event.payload?.providers
            ) {
              const byId = new Map(providers.map((p) => [p.instanceId, p]));
              for (const delta of event.payload.providers) {
                byId.set(delta.instanceId, { ...byId.get(delta.instanceId), ...delta });
              }
              providers = [...byId.values()];
            }
            const chosen = pickProvider(providers);
            if (chosen && chosen.models.length > 0) {
              clearTimeout(timer);
              resolve(chosen);
              return false;
            }
            return true;
          }),
        ),
      );
    }).catch((cause) => {
      throw cause instanceof Error ? cause : new Error(String(cause));
    });
    const modelSlug = parsed.values.model
      ? provider.models.find((m) => m.slug.includes(parsed.values.model!))?.slug
      : (provider.models.find((m) => m.isDefault)?.slug ?? provider.models[0]?.slug);
    if (!modelSlug) throw new Error(`no model on provider ${provider.instanceId}`);
    const modelSelection = { instanceId: provider.instanceId, model: modelSlug } as ModelSelection;
    notes.push(`model: ${provider.instanceId}/${modelSlug}`);

    step = "setup";
    const deps = setupDeps(server);
    const runtimeMode = "full-access";
    const interactionMode = "default";

    if (caseDef.project.setup.mode === "onboarding") {
      const wired = await wireChiefOfStaff(deps, {
        project: { id: projectId, title: caseDef.project.title, workspaceRoot: ctx.workspaceRoot },
        modelSelection,
        runtimeMode,
        interactionMode,
        riskLevel: "normal",
        chiefRoleLabel: "Chief of Staff",
      });
      ctx.leadId = wired.leadThreadId;
      notes.push(`persona=${wired.persona.name} firstRun=${wired.firstRun}`);
    } else {
      const setup = caseDef.project.setup;
      // Choose a worker model on the same provider when asked for the cheapest option.
      let workerModelSelection: ModelSelection | undefined;
      if (setup.workerModel === "cheapest_available") {
        const others = provider.models.filter((m) => m.slug !== modelSlug);
        const cheap = others.find((m) => /mini|haiku|luna|flash|small/i.test(m.slug)) ?? others[0];
        if (cheap) {
          workerModelSelection = {
            instanceId: provider.instanceId,
            model: cheap.slug,
          } as ModelSelection;
          notes.push(`workerModel=${provider.instanceId}/${cheap.slug}`);
        } else {
          notes.push("workerModel requested but no alternative model on provider");
        }
      }
      for (const text of setup.ownerMemories ?? []) {
        await call(
          server.rpc["dropwave.memory.save"]({
            projectId,
            scope: "global",
            about: "owner",
            kind: "fact",
            text,
          } as never),
        );
      }
      const configured = await configureDropwaveProject(deps, {
        project: { id: projectId, title: caseDef.project.title },
        modelSelection,
        runtimeMode,
        interactionMode,
        riskLevel: setup.riskLevel,
        chiefRoleLabel: "Chief of Staff",
        workerModelSelection,
        helpers: (setup.helpers ?? []).map((h) =>
          h === "QA"
            ? { name: "QA", roleLabel: "Verification & QA" }
            : { name: "SEO", roleLabel: "SEO & content" },
        ),
      });
      ctx.leadId = configured.leadThreadId;
    }

    const settled = async (): Promise<boolean> => {
      // after_idle: no run in flight for any bot in the project and no delegated job running.
      // The thread map fills from the shell subscription; until the lead thread has
      // arrived, zero threads is vacuously "settled" while the first run is queued.
      if (ctx.leadId !== undefined && !ctx.threads.has(ctx.leadId)) return false;
      for (const [id, shell] of ctx.threads) {
        if (shell.projectId !== ctx.projectId) continue;
        // Shell `activeRunId` can lag a finished run if its update raced the
        // subscription, so the fresh projection is the authority.
        const p = await getProjection(ctx.server, id);
        if (p.runs.some((r) => ACTIVE_RUN_STATUSES.has(r.status))) return false;
        if (p.subagents.some((s) => ACTIVE_JOB_STATUSES.has(s.status))) return false;
        const lastAssistant = [...p.messages].reverse().find((m) => m.role === "assistant");
        if (lastAssistant?.streaming) return false;
      }
      return true;
    };
    const leadSettled = async (): Promise<boolean> => {
      if (!ctx.leadId) return false;
      const p = await getProjection(ctx.server, ctx.leadId);
      if (p.runs.some((r) => ACTIVE_RUN_STATUSES.has(r.status))) return false;
      const lastAssistant = [...p.messages].reverse().find((m) => m.role === "assistant");
      return lastAssistant !== undefined && !lastAssistant.streaming;
    };

    step = "turns";
    let first = true;
    for (const turn of caseDef.turns) {
      if (turn.when === "after_reply") await tracker.wait(leadSettled);
      else if (turn.when === "after_idle") await tracker.wait(settled);
      if (tracker.timedOut) break;
      if (!ctx.leadId) throw new Error("no lead thread");
      const baseline = await getProjection(server, ctx.leadId);
      const baselineRuns = baseline.runs.length;
      const baselineAssistant = baseline.messages.filter((m) => m.role === "assistant").length;
      await call(
        server.rpc["orchestration.dispatchCommand"]({
          type: "message.dispatch",
          commandId: newCommandId(),
          createdBy: "user",
          creationSource: "web",
          threadId: ctx.leadId,
          messageId: newMessageId(),
          text: turn.text,
          attachments: [],
          dispatchMode: { type: "start_immediately" },
        } as unknown as OrchestrationV2Command),
      );
      // Wait for the turn to register (a run or a new assistant message) before the
      // next turn's settle wait can evaluate real state.
      await tracker.wait(async () => {
        if (ctx.leadId === undefined) return true;
        const p = await getProjection(server, ctx.leadId);
        return (
          p.runs.length > baselineRuns ||
          p.messages.filter((m) => m.role === "assistant").length > baselineAssistant
        );
      });
      first = false;
    }
    void first;
    if (!tracker.timedOut) await tracker.wait(settled);
    step = "grade";
  } catch (cause) {
    notes.push(
      `error[${step}]: ${cause instanceof Error ? (cause.stack ?? cause.message) : JSON.stringify(cause)}`,
    );
  } finally {
    tracker.disarm();
  }

  const state = await collectState(ctx);
  const checkResults: CheckResult[] = caseDef.checks.map((check) =>
    evaluateCheck(check, state, {
      allChecks: caseDef.checks,
      caseEnd: Date.now(),
      exec: (command, cwd) =>
        NodeChildProcess.spawnSync(command, { shell: true, cwd, stdio: "pipe" }).status ?? 1,
    }),
  );
  const failed = checkResults.filter((r) => !r.pass);
  return {
    row: {
      case: caseDef.id,
      kind: caseDef.kind,
      sample,
      timedOut: tracker.timedOut,
      durationMs: Date.now() - startedAt,
      pass: failed.length === 0 && !tracker.timedOut,
      checks: checkResults,
      notes,
      home: server.home,
      projectId: ctx.projectId,
      leadId: ctx.leadId,
    },
  };
}

async function main() {
  NodeFS.mkdirSync(outDir!, { recursive: true });
  const cases = LIVE_EVAL_CASES.filter((c) => !onlyCases || onlyCases.has(c.id));
  if (cases.length === 0) throw new Error("no cases selected");
  const homes = new Map<string, RunningServer>();
  const rows: Array<Record<string, unknown>> = [];
  const homeFor = async (key: string): Promise<RunningServer> => {
    const existing = homes.get(key);
    if (existing) return existing;
    const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), `dwe-home-${key}-`));
    const server = await startServer(home);
    homes.set(key, server);
    return server;
  };
  try {
    for (const caseDef of cases) {
      for (let sample = 0; sample < samples; sample++) {
        const homeKey =
          caseDef.home === "fresh" ? `${caseDef.id}-${sample}` : caseDef.home.slice(7);
        const server = await homeFor(homeKey);
        console.log(`[run] ${caseDef.id} sample ${sample + 1}/${samples} on ${server.origin}`);
        const { row } = await runCase(server, caseDef, sample);
        rows.push(row);
        const failed = (row.checks as CheckResult[]).filter((r) => !r.pass);
        console.log(
          `[done] ${caseDef.id} sample ${sample + 1}: ${row.pass ? "PASS" : "FAIL"}` +
            (failed.length ? ` (${failed.map((f) => f.checkId).join(", ")})` : ""),
        );
        if (caseDef.home === "fresh") {
          await server.stop();
          homes.delete(homeKey);
          if (!keepHomes) NodeFS.rmSync(server.home, { recursive: true, force: true });
        }
      }
    }
  } finally {
    for (const server of homes.values()) await server.stop();
    for (const { pid } of startedServers) {
      try {
        process.kill(pid, 0);
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    if (!keepHomes) {
      for (const { home } of startedServers) NodeFS.rmSync(home, { recursive: true, force: true });
    }
  }

  NodeFS.writeFileSync(
    NodePath.join(outDir!, "results.jsonl"),
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  const lines: string[] = ["# dropwave-crew summary", ""];
  lines.push(`| case | sample | result | failed checks |`);
  lines.push(`| --- | --- | --- | --- |`);
  for (const row of rows) {
    const failed = (row.checks as CheckResult[]).filter((r) => !r.pass);
    lines.push(
      `| ${row.case} | ${row.sample} | ${row.pass ? "PASS" : "FAIL"}${row.timedOut ? " (timeout)" : ""} | ${failed.map((f) => f.checkId).join(", ") || "—"} |`,
    );
  }
  for (const row of rows) {
    for (const check of row.checks as CheckResult[]) {
      if (check.pass) continue;
      lines.push(`\n## ${row.case} sample ${row.sample}: ${check.checkId}`);
      lines.push(`- evidence: ${check.evidence}`);
    }
  }
  NodeFS.writeFileSync(NodePath.join(outDir!, "summary.md"), lines.join("\n") + "\n");
  const passCount = rows.filter((r) => r.pass).length;
  console.log(`\n${passCount}/${rows.length} rows passed. out=${outDir}`);
  process.exit(passCount === rows.length ? 0 : 1);
}

main().catch((cause) => {
  for (const { pid } of startedServers) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* gone */
    }
  }
  console.error(cause);
  process.exit(1);
});
