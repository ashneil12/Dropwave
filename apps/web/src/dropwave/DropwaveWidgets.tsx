import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { DropwaveAsk, DropwaveDocSummary, DropwaveMemoryItem } from "@t3tools/contracts";
import { T, Var, msg, useGT, useMessages } from "gt-react";
import { BrainIcon, ChevronDownIcon, ExpandIcon, FileTextIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import {
  formatShortAge,
  isCurrentWork,
  keyOfThread,
  newestWorkFirst,
  workFor,
  workState,
  workStateLabel,
} from "./model";
import {
  useDropwaveWorkspace,
  type DropwaveSlotLayout,
  type DropwaveWidgetKind,
} from "./workspaceContext";

const WIDGET_OPTIONS: ReadonlyArray<{
  readonly kind: DropwaveWidgetKind;
  readonly label: string;
}> = [
  { kind: "asks", label: msg("Core Loop & Asks") },
  { kind: "agents", label: msg("Team & Agents") },
  { kind: "reviews", label: msg("Pending Reviews") },
  { kind: "sessions", label: msg("Running Sessions") },
  { kind: "docs", label: msg("Docs & Briefs") },
  { kind: "memory", label: msg("Memory & Rules") },
];

export interface DropwaveWidgetData {
  readonly liveAsks: ReadonlyArray<DropwaveAsk>;
  readonly liveDocs: ReadonlyArray<DropwaveDocSummary>;
  readonly liveMemories: ReadonlyArray<DropwaveMemoryItem>;
  readonly onOpenDoc?: (path: string) => void;
}

export function DropwaveWidgetCard({
  slot,
  kind,
  data,
}: {
  slot: keyof DropwaveSlotLayout;
  kind: DropwaveWidgetKind;
  data: DropwaveWidgetData;
}) {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const m = useMessages();
  const [menuOpen, setMenuOpen] = useState(false);

  if (!workspace) return null;

  const slotSwitcher = (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger type="button" data-dw-slot-swap="" aria-label={gt("Switch panel screen")}>
        <ChevronDownIcon />
      </PopoverTrigger>
      <PopoverPopup align="end" width="sm" padding="compact" data-dropwave-popover="">
        <div data-dw-slot-menu="">
          <span data-dw-slot-menu-title="">
            <T>Panel screen</T>
          </span>
          {WIDGET_OPTIONS.map((opt) => (
            <button
              key={opt.kind}
              type="button"
              data-dw-slot-item=""
              aria-current={kind === opt.kind ? "true" : undefined}
              onClick={() => {
                workspace.setSlotWidget(slot, opt.kind);
                setMenuOpen(false);
              }}
            >
              {m(opt.label)}
            </button>
          ))}
        </div>
      </PopoverPopup>
    </Popover>
  );

  // 1. Core Loop & Asks
  if (kind === "asks") {
    const loopSteps =
      workspace.lead?.source.dropwaveBot?.kind === "lead"
        ? (workspace.lead.source.dropwaveBot.loopSteps?.map((s) => s.title) ??
          workspace.lead.source.dropwaveBot.workflow)
        : [];

    return (
      <section data-dw-card="" data-widget="asks">
        <div data-dw-card-top="">
          <div data-dw-card-head="">
            <span data-dw-card-title="">
              <span data-dw-dot="indigo" />
              <span>
                <T>Core Loop & Asks</T>
              </span>
            </span>
            <div data-dw-card-head-right="">
              <button
                type="button"
                data-dw-slot-swap=""
                aria-label={gt("Add or manage asks")}
                onClick={() => workspace.openPanel({ kind: "asks" })}
              >
                <PlusIcon />
              </button>
              {slotSwitcher}
            </div>
          </div>

          {loopSteps.length > 0 ? (
            <div data-dw-loop-strip="" aria-label={gt("Core loop steps")}>
              {loopSteps.slice(0, 4).map((step, idx) => (
                <span key={step} data-dw-loop-chip="">
                  <em>{idx + 1}</em>
                  <span>{step}</span>
                </span>
              ))}
            </div>
          ) : null}

          <div data-dw-obj-list="">
            {data.liveAsks.length > 0 ? (
              data.liveAsks.slice(0, 5).map((ask) => (
                <button
                  key={ask.id}
                  type="button"
                  data-dw-obj-row=""
                  onClick={() => workspace.openPanel({ kind: "asks" })}
                >
                  <span data-dw-obj-left="">
                    <span
                      data-dw-dot={
                        ask.status === "waiting"
                          ? "coral"
                          : ask.status === "started"
                            ? "emerald"
                            : "amber"
                      }
                    />
                    <span>{ask.summary}</span>
                  </span>
                  <span data-dw-mono="muted">#{ask.n}</span>
                </button>
              ))
            ) : (
              <p data-dw-card-empty="">
                <T>Every ask you send in chat is tracked here until verified done.</T>
              </p>
            )}
          </div>
        </div>

        <div data-dw-card-foot="">
          <span data-dw-muted-label="">
            <T>
              <Var>{data.liveAsks.length}</Var> tracked asks
            </T>
          </span>
          <button
            type="button"
            data-dw-inline-link=""
            onClick={() => workspace.openPanel({ kind: "asks" })}
          >
            <T>Open ledger</T>
          </button>
        </div>
      </section>
    );
  }

  // 2. Team & Agents
  if (kind === "agents") {
    const liveHelpers = workspace.bots.filter(
      (bot) =>
        bot.environmentId === workspace.lead?.environmentId &&
        bot.source.dropwaveBot?.kind === "teammate" &&
        bot.source.dropwaveBot.leadThreadId === workspace.lead.id,
    );
    const totalAgents = (workspace.lead ? 1 : 0) + liveHelpers.length;

    return (
      <section data-dw-card="" data-widget="agents">
        <div data-dw-card-top="">
          <div data-dw-card-head="">
            <span data-dw-card-title="">
              <span>
                <T>Team & Agents</T>
              </span>
            </span>
            <div data-dw-card-head-right="">
              <span data-dw-status-inline="emerald">
                <span data-dw-dot="emerald" />
                <T>
                  <Var>{totalAgents}</Var>
                </T>
              </span>
              {workspace.lead && workspace.project ? (
                <button
                  type="button"
                  data-dw-slot-swap=""
                  aria-label={gt("Add agent")}
                  onClick={() =>
                    workspace.openPanel({
                      kind: "profile",
                      target: {
                        kind: "new-teammate",
                        project: workspace.project!,
                        lead: workspace.lead!,
                      },
                    })
                  }
                >
                  <PlusIcon />
                </button>
              ) : null}
              {slotSwitcher}
            </div>
          </div>

          <div data-dw-helper-list="">
            {workspace.lead ? (
              <>
                <button
                  type="button"
                  data-dw-helper-row=""
                  aria-current={workspace.activeBot?.id === workspace.lead.id ? "true" : undefined}
                  onClick={() =>
                    workspace.openThread(
                      scopeThreadRef(workspace.lead!.environmentId, workspace.lead!.id),
                    )
                  }
                >
                  <span data-dw-monogram="violet">
                    {workspace.lead.title
                      .split(/\s+/)
                      .map((w) => w[0] ?? "")
                      .join("")
                      .slice(0, 2)
                      .toUpperCase() || "CS"}
                  </span>
                  <span data-dw-helper-info="">
                    <span data-dw-helper-head="">
                      <strong>{workspace.lead.title}</strong>
                      <span data-dw-badge="violet">
                        <T>Lead</T>
                      </span>
                    </span>
                    <small>
                      {workspace.lead.source.dropwaveBot?.brief || gt("Owns the core loop")}
                    </small>
                  </span>
                </button>
                {liveHelpers.map((bot, idx) => {
                  const state = workState(bot);
                  const initials = bot.title
                    .split(/\s+/)
                    .map((w) => w[0] ?? "")
                    .join("")
                    .slice(0, 3)
                    .toUpperCase();
                  return (
                    <button
                      key={keyOfThread(bot)}
                      type="button"
                      data-dw-helper-row=""
                      aria-current={workspace.activeBot?.id === bot.id ? "true" : undefined}
                      onClick={() =>
                        workspace.openThread(scopeThreadRef(bot.environmentId, bot.id))
                      }
                    >
                      <span data-dw-monogram={idx % 2 === 0 ? "indigo" : "emerald"}>
                        {initials || "AI"}
                      </span>
                      <span data-dw-helper-info="">
                        <span data-dw-helper-head="">
                          <strong>{bot.title}</strong>
                          <span
                            data-dw-mono={
                              state === "working"
                                ? "emerald"
                                : state === "needs-you"
                                  ? "coral"
                                  : "amber"
                            }
                          >
                            {m(workStateLabel[state])}
                          </span>
                        </span>
                        <small>
                          {bot.source.dropwaveBot?.kind === "teammate" &&
                          bot.source.dropwaveBot.role
                            ? bot.source.dropwaveBot.role
                            : bot.source.dropwaveBot?.brief || gt("Specialist agent")}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </>
            ) : (
              <p data-dw-card-empty="">
                <T>Run conversational setup to wire your Chief of Staff and specialist agents.</T>
              </p>
            )}
          </div>
        </div>

        <div data-dw-card-foot="">
          <span data-dw-muted-label="">
            <T>Click any agent to chat</T>
          </span>
          {workspace.lead ? (
            <button
              type="button"
              data-dw-inline-link=""
              onClick={() =>
                workspace.openPanel({
                  kind: "profile",
                  target: { kind: "edit", bot: workspace.lead! },
                })
              }
            >
              <T>Edit loop</T>
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  // 3. Pending Reviews
  if (kind === "reviews") {
    const liveNeeds = workspace.needs;
    const totalUrgent = liveNeeds.length;

    return (
      <section data-dw-card="" data-widget="reviews">
        <div data-dw-card-top="">
          <div data-dw-card-head="">
            <span data-dw-card-title="" data-accent="coral">
              <span data-dw-dot="coral" />
              <span>
                <T>Pending Reviews</T>
              </span>
            </span>
            <div data-dw-card-head-right="">
              {totalUrgent > 0 ? (
                <button
                  type="button"
                  data-dw-badge="coral"
                  onClick={() => workspace.openDecisionQueue()}
                >
                  <T>
                    <Var>{totalUrgent}</Var> urgent
                  </T>
                </button>
              ) : (
                <span data-dw-badge="emerald">
                  <T>Clear</T>
                </span>
              )}
              {slotSwitcher}
            </div>
          </div>

          <div data-dw-review-list="">
            {liveNeeds.length > 0 ? (
              liveNeeds.slice(0, 3).map((thread, index) => (
                <div
                  key={keyOfThread(thread)}
                  data-dw-review-item={index === 0 ? "urgent" : "normal"}
                >
                  <div data-dw-review-head="">
                    <strong>{thread.title}</strong>
                    <span data-dw-mono="coral">{formatShortAge(thread.updatedAt)}</span>
                  </div>
                  <p>
                    <T>Waiting on your decision or approval to continue.</T>
                  </p>
                  <div data-dw-review-actions="">
                    <button
                      type="button"
                      data-dw-coral-btn=""
                      onClick={() => workspace.openDecisionQueue()}
                    >
                      <ExpandIcon className="size-3" />
                      <T>Review & decide</T>
                    </button>
                    <button
                      type="button"
                      data-dw-ghost-xs=""
                      onClick={() =>
                        workspace.openThread(scopeThreadRef(thread.environmentId, thread.id))
                      }
                    >
                      <T>Open chat</T>
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p data-dw-card-empty="">
                <T>Nothing blocked. Your agents are running autonomously.</T>
              </p>
            )}
          </div>
        </div>

        <div data-dw-card-foot="">
          <span data-dw-muted-label="">
            {totalUrgent > 0 ? <T>Step through with full context</T> : <T>All clear</T>}
          </span>
          {totalUrgent > 0 ? (
            <button
              type="button"
              data-dw-inline-link=""
              onClick={() => workspace.openDecisionQueue()}
            >
              <T>Review queue</T>
            </button>
          ) : null}
        </div>
      </section>
    );
  }

  // 4. Running Sessions
  if (kind === "sessions") {
    const owner = workspace.activeBot ?? workspace.lead;
    const liveSessions = owner
      ? workFor(workspace.threads, scopeThreadRef(owner.environmentId, owner.id)).sort(
          newestWorkFirst,
        )
      : [];
    const activeCount = liveSessions.filter(isCurrentWork).length;
    const queuedCount = liveSessions.filter((s) => workState(s) === "waiting").length;

    return (
      <section data-dw-card="" data-widget="sessions">
        <div data-dw-card-top="">
          <div data-dw-card-head="">
            <span data-dw-card-title="">
              <span data-dw-dot="emerald" data-pulse={activeCount > 0 ? "" : undefined} />
              <span>
                <T>Running Sessions</T>
              </span>
            </span>
            <div data-dw-card-head-right="">
              <span data-dw-mono="muted">
                <T>
                  <Var>{activeCount}</Var> active · <Var>{queuedCount}</Var> queued
                </T>
              </span>
              {slotSwitcher}
            </div>
          </div>

          <div data-dw-session-cards="">
            {liveSessions.length > 0 ? (
              liveSessions.slice(0, 4).map((session) => {
                const state = workState(session);
                const cardStatus =
                  state === "needs-you" || state === "failed"
                    ? "awaiting"
                    : state === "working"
                      ? "running"
                      : "queued";
                return (
                  <button
                    key={keyOfThread(session)}
                    type="button"
                    data-dw-session-card={cardStatus}
                    onClick={() =>
                      workspace.openThread(scopeThreadRef(session.environmentId, session.id))
                    }
                  >
                    <div data-dw-session-card-head="">
                      <strong>{session.title}</strong>
                      <span
                        data-dw-mono={
                          cardStatus === "awaiting"
                            ? "coral-pill"
                            : cardStatus === "running"
                              ? "emerald"
                              : "muted"
                        }
                      >
                        {m(workStateLabel[state])}
                      </span>
                    </div>
                    <div data-dw-session-card-sub="">
                      <span>
                        {session.linkedPullRequest
                          ? gt("PR #{number}", { number: session.linkedPullRequest.number })
                          : session.branch || gt("Worktree session")}
                      </span>
                      <span data-dw-mono="dim">{formatShortAge(session.updatedAt)}</span>
                    </div>
                  </button>
                );
              })
            ) : (
              <p data-dw-card-empty="">
                <T>Worker sessions spawned by your lead bot stream here live.</T>
              </p>
            )}
          </div>
        </div>

        <div data-dw-card-foot="">
          <span data-dw-status-inline="muted">
            <span data-dw-dot="emerald" />
            <T>
              <Var>{liveSessions.length}</Var> sessions
            </T>
          </span>
          <span data-dw-mono="emerald">
            <T>Live</T>
          </span>
        </div>
      </section>
    );
  }

  // 5. Docs & Briefs
  if (kind === "docs") {
    return (
      <section data-dw-card="" data-widget="docs">
        <div data-dw-card-top="">
          <div data-dw-card-head="">
            <span data-dw-card-title="">
              <FileTextIcon className="size-3.5" data-dw-icon="indigo" />
              <span>
                <T>Docs & Briefs</T>
              </span>
            </span>
            <div data-dw-card-head-right="">
              <button
                type="button"
                data-dw-inline-link=""
                onClick={() => workspace.setMainView("docs")}
              >
                <T>Open all</T>
              </button>
              {slotSwitcher}
            </div>
          </div>
          <div data-dw-obj-list="">
            {data.liveDocs.length > 0 ? (
              data.liveDocs.slice(0, 5).map((doc) => (
                <button
                  key={doc.path}
                  type="button"
                  data-dw-obj-row=""
                  onClick={() => {
                    data.onOpenDoc?.(doc.path);
                    workspace.setMainView("docs");
                  }}
                >
                  <span data-dw-obj-left="">
                    <FileTextIcon className="size-3 shrink-0" data-dw-icon="indigo" />
                    <span>{doc.title}</span>
                  </span>
                  <span data-dw-mono="muted">
                    {doc.kind} · {formatShortAge(doc.updatedAt)}
                  </span>
                </button>
              ))
            ) : (
              <p data-dw-card-empty="">
                <T>No project docs yet. Open Docs to draft a brief.</T>
              </p>
            )}
          </div>
        </div>
        <div data-dw-card-foot="">
          <span data-dw-muted-label="">
            <T>Shared with bots</T>
          </span>
          <span data-dw-mono="muted">{data.liveDocs.length}</span>
        </div>
      </section>
    );
  }

  // 6. Memory & Rules
  return (
    <section data-dw-card="" data-widget="memory">
      <div data-dw-card-top="">
        <div data-dw-card-head="">
          <span data-dw-card-title="">
            <BrainIcon className="size-3.5" data-dw-icon="violet" />
            <span>
              <T>Memory & Rules</T>
            </span>
          </span>
          <div data-dw-card-head-right="">
            <button
              type="button"
              data-dw-inline-link=""
              onClick={() => workspace.setMainView("docs")}
            >
              <T>Manage</T>
            </button>
            {slotSwitcher}
          </div>
        </div>
        <div data-dw-obj-list="">
          {data.liveMemories.length > 0 ? (
            data.liveMemories.slice(0, 4).map((mem) => (
              <div key={mem.id} data-dw-mem-chip="">
                <span data-dw-badge="violet">{mem.kind}</span>
                <p>{mem.text}</p>
              </div>
            ))
          ) : (
            <p data-dw-card-empty="">
              <T>Standing rules learned from your decisions appear here.</T>
            </p>
          )}
        </div>
      </div>
      <div data-dw-card-foot="">
        <span data-dw-muted-label="">
          <T>Project-isolated</T>
        </span>
        <span data-dw-mono="muted">{data.liveMemories.length}</span>
      </div>
    </section>
  );
}
