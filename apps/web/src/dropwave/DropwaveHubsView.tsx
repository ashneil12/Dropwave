import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type {
  DropwaveAsk,
  DropwaveDoc,
  DropwaveDocSummary,
  DropwaveMemoryItem,
  ScheduledTask,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/reactivity";
import { useAtomValue } from "@effect/atom-react";
import { T, useGT, useMessages } from "gt-react";
import {
  ActivityIcon,
  ArrowLeftIcon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  LayoutGridIcon,
  PinIcon,
  PinOffIcon,
  ScrollTextIcon,
  SendIcon,
  Trash2Icon,
  Wand2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useLocalStorage } from "../hooks/useLocalStorage";
import { useNowSecond } from "../hooks/useNowSecond";
import { newMessageId } from "../lib/utils";
import { serverEnvironment } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { workState, workStateLabel } from "./model";
import { DropwaveBotAvatar } from "./DropwaveBotAvatar";
import { useDropwaveWorkspace } from "./workspaceContext";

export const PINNED_HUBS_KEY = "dropwave:pinned-hubs";
export const PinnedHubsSchema = Schema.Array(Schema.String);
export const BUILTIN_SHIP_GATE_HUB_ID = "builtin:ship-gate";
const BUILTIN_PROJECT_PULSE_HUB_ID = "builtin:project-pulse";
const BUILTIN_DECISIONS_HUB_ID = "builtin:decisions-log";
const BUILTIN_HABITS_HUB_ID = "builtin:habits-calendar";
/** Retired hub id kept only to sanitize stale pins stored in localStorage. */
const RETIRED_KANBAN_HUB_ID = "builtin:kanban";

function liveHubId(id: string | null | undefined): string | null {
  if (!id || id === RETIRED_KANBAN_HUB_ID) return null;
  return id;
}

const DROPWAVE_HUB_THEME_HEAD = `<style>
:root {
  --bg: transparent;
  --ink: #f4f3ef;
  --muted: rgba(244, 243, 239, 0.58);
  --line: rgba(255, 255, 255, 0.10);
  --surface: rgba(255, 255, 255, 0.06);
  --accent: #a8acff;
  --ok: #5cd68d;
  --warn: #e8b35a;
  --alert: #ef6b6b;
  color-scheme: dark;
}
html, body {
  margin: 0; padding: 18px;
  background: transparent;
  color: var(--ink);
  font-family: "Instrument Sans", Inter, -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased;
}
</style>`;

function injectHubTheme(rawHtml: string): string {
  if (/<head[^>]*>/i.test(rawHtml)) {
    return rawHtml.replace(/<head[^>]*>/i, (m) => `${m}${DROPWAVE_HUB_THEME_HEAD}`);
  }
  return `<!doctype html><html><head><meta charset="utf-8">${DROPWAVE_HUB_THEME_HEAD}</head><body>${rawHtml}</body></html>`;
}

const ChecklistSchema = Schema.Record(Schema.String, Schema.Boolean);

function BuiltinShipGateHub({ projectKey }: { projectKey: string }) {
  const gt = useGT();
  const [checked, setChecked] = useLocalStorage(
    `dropwave:ship-gate:${projectKey}`,
    {},
    ChecklistSchema,
  );
  const gates = [
    { id: "tests", label: gt("Unit & integration tests passing locally") },
    { id: "qa", label: gt("Independent QA agent verified real user flows") },
    { id: "docs", label: gt("Release brief updated in .dropwave/docs/") },
    { id: "asks", label: gt("All tracked owner asks closed with real proof") },
    { id: "rollback", label: gt("Rollback path confirmed before production push") },
  ];
  const doneCount = gates.filter((g) => checked[g.id]).length;

  return (
    <div data-dw-ship-gate="">
      <div data-dw-ship-gate-head="">
        <h3>
          <T>Pre-Ship Verification Gate</T>
        </h3>
        <span data-dw-mono="emerald">
          {doneCount}/{gates.length}
        </span>
      </div>
      <div data-dw-ship-gate-list="">
        {gates.map((gate) => (
          <label key={gate.id} data-dw-check-row="">
            <input
              type="checkbox"
              checked={Boolean(checked[gate.id])}
              onChange={(e) => setChecked({ ...checked, [gate.id]: e.currentTarget.checked })}
            />
            <span>{gate.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** What each bot and worker is doing now, from live thread state + the ask ledger. */
function BuiltinProjectPulseHub() {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const m = useMessages();
  const project = workspace?.project ?? null;
  const [asks, setAsks] = useState<ReadonlyArray<DropwaveAsk>>([]);
  const listAsks = useAtomCommand(serverEnvironment.dropwaveAsksList, { reportFailure: false });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads open asks for per-bot counts
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void listAsks({
      environmentId: project.environmentId,
      input: { projectId: project.id, includeClosed: false },
    }).then((res) => {
      if (!cancelled && res._tag === "Success") setAsks(res.value.asks);
    });
    return () => {
      cancelled = true;
    };
  }, [listAsks, project]);

  if (!workspace || !project) return null;
  const bots = workspace.bots.filter((bot) => bot.projectId === project.id);
  const openByThread = new Map<string, number>();
  for (const ask of asks) {
    if (ask.status === "done" || ask.status === "dropped") continue;
    openByThread.set(ask.botThreadId, (openByThread.get(ask.botThreadId) ?? 0) + 1);
  }
  const working = bots.filter((bot) => workState(bot) === "working").length;
  const waiting = bots.filter((bot) => workState(bot) === "needs-you").length;

  return (
    <div data-dw-hub-builtin="">
      <div data-dw-hub-builtin-head="">
        <h3>
          <T>Project pulse</T>
        </h3>
        <span data-dw-mono="dim">
          {gt("{working} working · {waiting} need you", { working, waiting })}
        </span>
      </div>
      <div data-dw-pulse-list="">
        {bots.map((bot) => {
          const state = workState(bot);
          const openAsks = openByThread.get(bot.id) ?? 0;
          return (
            <div key={bot.id} data-dw-pulse-row="">
              <DropwaveBotAvatar
                name={bot.title}
                seed={bot.source.dropwaveBot?.avatarSeed}
                role={bot.source.dropwaveBot?.kind === "lead" ? "lead" : "specialist"}
                size="sm"
              />
              <div data-dw-pulse-meta="">
                <strong>{bot.title}</strong>
                <small>
                  {m(workStateLabel[state])}
                  {openAsks > 0
                    ? ` · ${gt("{count, plural, one {# open ask} other {# open asks}}", { count: openAsks })}`
                    : ""}
                </small>
              </div>
              <span
                data-dw-dot={
                  state === "working" ? "indigo" : state === "needs-you" ? "coral" : "dim"
                }
              />
            </div>
          );
        })}
        {bots.length === 0 ? (
          <p data-dw-rail-empty="">
            <T>No bots on this project yet.</T>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Every owner decision and standing rule, with date and quote. */
function BuiltinDecisionsHub() {
  const workspace = useDropwaveWorkspace();
  const project = workspace?.project ?? null;
  const [items, setItems] = useState<
    ReadonlyArray<{ key: string; text: string; quote: string | null; at: string; kind: string }>
  >([]);
  const listAsks = useAtomCommand(serverEnvironment.dropwaveAsksList, { reportFailure: false });
  const listMemories = useAtomCommand(serverEnvironment.dropwaveMemoryList, {
    reportFailure: false,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads decide asks and rule memories
  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void Promise.all([
      listAsks({
        environmentId: project.environmentId,
        input: { projectId: project.id, includeClosed: true },
      }),
      listMemories({
        environmentId: project.environmentId,
        input: { projectId: project.id },
      }),
    ]).then(([asksRes, memRes]) => {
      if (cancelled) return;
      const next: Array<{
        key: string;
        text: string;
        quote: string | null;
        at: string;
        kind: string;
      }> = [];
      if (asksRes._tag === "Success") {
        for (const ask of asksRes.value.asks) {
          if (ask.kind !== "decide") continue;
          next.push({
            key: `ask-${ask.id}`,
            text: ask.summary,
            quote: ask.quote || null,
            at: ask.updatedAt,
            kind: ask.status,
          });
        }
      }
      if (memRes._tag === "Success") {
        for (const mem of memRes.value.items as ReadonlyArray<DropwaveMemoryItem>) {
          if (mem.kind !== "rule") continue;
          next.push({
            key: `mem-${mem.id}`,
            text: mem.text,
            quote: mem.quote ?? null,
            at: mem.updatedAt,
            kind: "rule",
          });
        }
      }
      next.sort((a, b) => b.at.localeCompare(a.at));
      setItems(next.slice(0, 40));
    });
    return () => {
      cancelled = true;
    };
  }, [listAsks, listMemories, project]);

  if (!project) return null;
  return (
    <div data-dw-hub-builtin="">
      <div data-dw-hub-builtin-head="">
        <h3>
          <T>Decisions log</T>
        </h3>
        <span data-dw-mono="dim">{items.length}</span>
      </div>
      <div data-dw-decisions-list="">
        {items.map((item) => (
          <div key={item.key} data-dw-decision-row="">
            <div data-dw-decision-main="">
              <strong>{item.text}</strong>
              {item.quote ? <q>{item.quote}</q> : null}
            </div>
            <small data-dw-mono="dim">
              {item.at.slice(0, 10)} · {item.kind}
            </small>
          </div>
        ))}
        {items.length === 0 ? (
          <p data-dw-rail-empty="">
            <T>No decisions logged yet. Asks you settle and rules you set land here.</T>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The week ahead of scheduled habit runs. */
function BuiltinHabitsCalendarHub() {
  const workspace = useDropwaveWorkspace();
  const project = workspace?.project ?? null;
  if (!project) return null;
  return <HabitsCalendar project={project} />;
}

function HabitsCalendar({ project }: { project: EnvironmentProject }) {
  const tasksResult = useAtomValue(
    serverEnvironment.scheduledTasksLive({ environmentId: project.environmentId, input: {} }),
  );
  const tasks: ReadonlyArray<ScheduledTask> = AsyncResult.isSuccess(tasksResult)
    ? tasksResult.value.tasks.filter((task) => task.projectId === project.id)
    : [];

  const nowSeconds = useNowSecond();
  const days = (() => {
    const out: Array<{
      key: string;
      label: string;
      items: Array<{ task: ScheduledTask; at: Date }>;
    }> = [];
    const now = new Date(nowSeconds * 1000);
    for (let i = 0; i < 7; i++) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
      out.push({
        key: day.toISOString().slice(0, 10),
        label: day.toLocaleDateString(undefined, {
          weekday: "short",
          month: "short",
          day: "numeric",
        }),
        items: [],
      });
    }
    for (const task of tasks) {
      if (!task.enabled || !task.nextRunAt) continue;
      const at = new Date(task.nextRunAt);
      const bucket = out.find((d) => d.key === at.toISOString().slice(0, 10));
      if (bucket) bucket.items.push({ task, at });
    }
    return out;
  })();

  const total = days.reduce((sum, d) => sum + d.items.length, 0);
  return (
    <div data-dw-hub-builtin="">
      <div data-dw-hub-builtin-head="">
        <h3>
          <T>Habits calendar</T>
        </h3>
        <span data-dw-mono="dim">{total}</span>
      </div>
      <div data-dw-habits-cal="">
        {days.map((day) => (
          <div
            key={day.key}
            data-dw-cal-day=""
            data-empty={day.items.length === 0 ? "true" : undefined}
          >
            <header>
              <strong>{day.label}</strong>
              <span data-dw-mono="dim">{day.items.length}</span>
            </header>
            {day.items.map(({ task, at }) => (
              <div key={task.id} data-dw-cal-item="">
                <span data-dw-dot={task.enabled ? "emerald" : "dim"} />
                <span>{task.title}</span>
                <small data-dw-mono="dim">
                  {at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                </small>
              </div>
            ))}
          </div>
        ))}
        {total === 0 ? (
          <p data-dw-rail-empty="">
            <T>No habits scheduled this week.</T>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function DropwaveHubsView({
  initialHubId,
  onSelectHubId,
}: {
  initialHubId?: string | null;
  onSelectHubId?: (id: string | null) => void;
}) {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const project = workspace?.project ?? null;

  const [pinnedHubs, setPinnedHubs] = useLocalStorage(
    PINNED_HUBS_KEY,
    [BUILTIN_SHIP_GATE_HUB_ID],
    PinnedHubsSchema,
  );
  const [customHubs, setCustomHubs] = useState<ReadonlyArray<DropwaveDocSummary>>([]);
  const [loadedHubDoc, setLoadedHubDoc] = useState<DropwaveDoc | null>(null);
  const [askLead, setAskLead] = useState("");
  const [sending, setSending] = useState(false);
  const [nonce, setNonce] = useState(0);

  const listDocs = useAtomCommand(serverEnvironment.dropwaveDocsList, { reportFailure: false });
  const readDoc = useAtomCommand(serverEnvironment.dropwaveDocRead, { reportFailure: false });
  const deleteDoc = useAtomCommand(serverEnvironment.dropwaveDocDelete, { reportFailure: false });
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });

  const activeHubId = liveHubId(initialHubId ?? null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- lists custom agent-built HTML hubs from .dropwave/hubs/
  useEffect(() => {
    if (!project || nonce < 0) return;
    let cancelled = false;
    void listDocs({
      environmentId: project.environmentId,
      input: { projectId: project.id },
    }).then((res) => {
      if (!cancelled && res._tag === "Success") {
        setCustomHubs(
          res.value.docs.filter((d) => d.kind === "hub" || d.path.startsWith(".dropwave/hubs/")),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [listDocs, nonce, project]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads active custom hub HTML source
  useEffect(() => {
    if (!project || activeHubId === null || activeHubId.startsWith("builtin:")) {
      return;
    }
    let cancelled = false;
    void readDoc({
      environmentId: project.environmentId,
      input: { projectId: project.id, path: activeHubId },
    }).then((res) => {
      if (!cancelled && res._tag === "Success") {
        setLoadedHubDoc(res.value.doc);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeHubId, project, readDoc]);

  if (!workspace || !project) {
    return (
      <div data-dropwave-panel-empty="">
        <LayoutGridIcon />
        <p>
          <T>Select a project to open built-in and agent-built Hubs.</T>
        </p>
      </div>
    );
  }

  const pinnedSet = new Set(pinnedHubs);
  const togglePin = (id: string) => {
    if (pinnedSet.has(id)) setPinnedHubs(pinnedHubs.filter((item) => item !== id));
    else setPinnedHubs([...pinnedHubs, id]);
  };

  const selectHub = (id: string | null) => {
    onSelectHubId?.(id);
  };

  const sendToLead = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !workspace.lead || sending) return;
    setSending(true);
    const res = await startTurn({
      environmentId: workspace.lead.environmentId,
      input: {
        threadId: workspace.lead.id,
        message: { messageId: newMessageId(), role: "user", text: trimmed, attachments: [] },
        runtimeMode: workspace.lead.source.runtimeMode,
        interactionMode: workspace.lead.source.interactionMode,
      },
    });
    setSending(false);
    if (res._tag === "Success") {
      setAskLead("");
      workspace.openThread(scopeThreadRef(workspace.lead.environmentId, workspace.lead.id));
      workspace.setMainView("chat");
    }
  };

  const askLeadToChangeHub = (name: string) => {
    if (workspace.lead) {
      workspace.prefillComposer(
        scopeThreadRef(workspace.lead.environmentId, workspace.lead.id),
        gt("I’d like to change the “{name}” hub: ", { name }),
      );
      workspace.setMainView("chat");
    }
  };

  const deleteCustomHub = async (path: string) => {
    await deleteDoc({
      environmentId: project.environmentId,
      input: { projectId: project.id, path },
    });
    if (pinnedSet.has(path)) togglePin(path);
    selectHub(null);
    setNonce((n) => n + 1);
  };

  const builtinHubs: ReadonlyArray<{
    id: string;
    title: string;
    line: string;
    icon: typeof CheckCircle2Icon;
  }> = [
    {
      id: BUILTIN_SHIP_GATE_HUB_ID,
      title: gt("Ship Gate"),
      line: gt("The pre-ship checklist"),
      icon: CheckCircle2Icon,
    },
    {
      id: BUILTIN_PROJECT_PULSE_HUB_ID,
      title: gt("Project pulse"),
      line: gt("What every bot is doing now"),
      icon: ActivityIcon,
    },
    {
      id: BUILTIN_DECISIONS_HUB_ID,
      title: gt("Decisions log"),
      line: gt("Every call you made, with the quote"),
      icon: ScrollTextIcon,
    },
    {
      id: BUILTIN_HABITS_HUB_ID,
      title: gt("Habits calendar"),
      line: gt("The week ahead of scheduled runs"),
      icon: CalendarDaysIcon,
    },
  ];

  if (activeHubId !== null) {
    const isBuiltin = activeHubId.startsWith("builtin:");
    const customHub = customHubs.find((hub) => hub.path === activeHubId) ?? null;
    const hubTitle = isBuiltin
      ? (builtinHubs.find((hub) => hub.id === activeHubId)?.title ?? gt("Hub"))
      : (loadedHubDoc?.title ?? customHub?.title ?? gt("Hub"));
    const pinned = pinnedSet.has(activeHubId);
    return (
      <section data-dw-hubs-view="" data-dw-hub-canvas="" aria-label={gt("Hub")}>
        <header data-dw-hub-canvas-head="">
          <button type="button" data-dw-back-pill="" onClick={() => selectHub(null)}>
            <ArrowLeftIcon className="size-3.5" />
            <T>Hubs</T>
          </button>
          <div data-dw-hub-canvas-title="">
            <strong>{hubTitle}</strong>
          </div>
          <div data-dw-head-actions="">
            <button
              type="button"
              data-dw-pin-btn=""
              aria-label={pinned ? gt("Unpin hub") : gt("Pin hub to sidebar")}
              aria-pressed={pinned}
              onClick={() => togglePin(activeHubId)}
            >
              {pinned ? <PinOffIcon className="size-3.5" /> : <PinIcon className="size-3.5" />}
            </button>
            <button type="button" data-dw-back-pill="" onClick={() => askLeadToChangeHub(hubTitle)}>
              <Wand2Icon className="size-3.5" />
              {gt("Ask {name} to change", { name: workspace.lead?.title ?? gt("your lead") })}
            </button>
            {!isBuiltin && loadedHubDoc ? (
              <button
                type="button"
                data-dw-mini-icon=""
                aria-label={gt("Delete custom hub")}
                onClick={() => void deleteCustomHub(loadedHubDoc.path)}
              >
                <Trash2Icon className="size-3.5" />
              </button>
            ) : null}
          </div>
        </header>
        <div data-dw-hubs-stage="" data-canvas="true">
          {activeHubId === BUILTIN_SHIP_GATE_HUB_ID ? (
            <BuiltinShipGateHub projectKey={`${project.environmentId}:${project.id}`} />
          ) : activeHubId === BUILTIN_PROJECT_PULSE_HUB_ID ? (
            <BuiltinProjectPulseHub />
          ) : activeHubId === BUILTIN_DECISIONS_HUB_ID ? (
            <BuiltinDecisionsHub />
          ) : activeHubId === BUILTIN_HABITS_HUB_ID ? (
            <BuiltinHabitsCalendarHub />
          ) : !isBuiltin && loadedHubDoc ? (
            <iframe
              title={loadedHubDoc.title}
              sandbox="allow-scripts"
              srcDoc={injectHubTheme(loadedHubDoc.content)}
            />
          ) : (
            <div data-dropwave-panel-empty="">
              <LayoutGridIcon />
              <p>
                <T>Loading hub…</T>
              </p>
            </div>
          )}
        </div>
      </section>
    );
  }

  return (
    <section data-dw-hubs-view="" data-dw-hubs-home="" aria-label={gt("Hubs")}>
      <div data-dw-hubs-home-scroll="">
        <form
          data-dw-composer-box=""
          data-dw-hub-ask=""
          onSubmit={(event) => {
            event.preventDefault();
            void sendToLead(askLead);
          }}
        >
          <input
            value={askLead}
            onChange={(event) => setAskLead(event.currentTarget.value)}
            placeholder={gt("Describe a hub… e.g. a pricing calculator")}
            aria-label={gt("Ask your lead for a hub")}
            disabled={sending || !workspace.lead}
          />
          <div data-dw-composer-bar="">
            <div data-dw-composer-left="">
              <span data-dw-section-micro="">
                {gt("Ask {name}", { name: workspace.lead?.title ?? gt("your lead") })}
              </span>
            </div>
            <div data-dw-composer-right="">
              <button
                type="submit"
                data-dw-composer-icon=""
                aria-label={gt("Send")}
                disabled={sending || !askLead.trim() || !workspace.lead}
              >
                <SendIcon className="size-3.5" />
              </button>
            </div>
          </div>
        </form>

        <div data-dw-hubs-section="">
          <h3>
            <T>Built in</T>
          </h3>
          <div data-dw-hubs-grid="">
            {builtinHubs.map((hub) => {
              const Icon = hub.icon;
              const pinned = pinnedSet.has(hub.id);
              return (
                <div key={hub.id} data-dw-hub-card="">
                  <button type="button" data-dw-hub-card-open="" onClick={() => selectHub(hub.id)}>
                    <span data-dw-hub-card-icon="">
                      <Icon className="size-4" />
                    </span>
                    <span data-dw-hub-card-meta="">
                      <strong>{hub.title}</strong>
                      <small>{hub.line}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    data-dw-pin-btn=""
                    aria-label={pinned ? gt("Unpin hub") : gt("Pin hub to sidebar")}
                    aria-pressed={pinned}
                    onClick={() => togglePin(hub.id)}
                  >
                    {pinned ? <PinOffIcon className="size-3" /> : <PinIcon className="size-3" />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div data-dw-hubs-section="">
          <h3>
            <T>Made for this project</T>
          </h3>
          {customHubs.length > 0 ? (
            <div data-dw-hubs-grid="">
              {customHubs.map((hub) => {
                const pinned = pinnedSet.has(hub.path);
                return (
                  <div key={hub.path} data-dw-hub-card="">
                    <button
                      type="button"
                      data-dw-hub-card-open=""
                      onClick={() => selectHub(hub.path)}
                    >
                      <span data-dw-hub-card-icon="">
                        <LayoutGridIcon className="size-4" />
                      </span>
                      <span data-dw-hub-card-meta="">
                        <strong>{hub.title}</strong>
                        <small>
                          <T>Agent-built mod</T>
                        </small>
                      </span>
                    </button>
                    <button
                      type="button"
                      data-dw-pin-btn=""
                      aria-label={pinned ? gt("Unpin hub") : gt("Pin hub to sidebar")}
                      aria-pressed={pinned}
                      onClick={() => togglePin(hub.path)}
                    >
                      {pinned ? <PinOffIcon className="size-3" /> : <PinIcon className="size-3" />}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p data-dw-rail-empty="">
              <T>Ask your lead above. Agent-built hubs land here.</T>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
