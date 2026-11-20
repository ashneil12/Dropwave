import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { DropwaveAsk, DropwaveDocSummary, DropwaveMemoryItem } from "@t3tools/contracts";
import { T, Var, msg, useGT, useMessages } from "gt-react";
import { BrainIcon, ChevronDownIcon, FileTextIcon, PlusIcon } from "lucide-react";
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
import type { SampleVenture } from "./sampleData";
import {
  useDropwaveWorkspace,
  type DropwaveSlotLayout,
  type DropwaveWidgetKind,
} from "./workspaceContext";

const WIDGET_OPTIONS: ReadonlyArray<{
  readonly kind: DropwaveWidgetKind;
  readonly label: string;
}> = [
  { kind: "mission", label: msg("Mission Control") },
  { kind: "helpers", label: msg("Helper Bots") },
  { kind: "reviews", label: msg("Pending Reviews") },
  { kind: "sessions", label: msg("Running Sessions") },
  { kind: "docs", label: msg("Docs & Briefs") },
  { kind: "memory", label: msg("Memory & Rules") },
];

export interface DropwaveWidgetData {
  readonly venture: SampleVenture | null;
  readonly liveAsks: ReadonlyArray<DropwaveAsk>;
  readonly liveDocs: ReadonlyArray<DropwaveDocSummary>;
  readonly liveMemories: ReadonlyArray<DropwaveMemoryItem>;
  readonly onSelectPreviewHelper?: (helperId: string | null) => void;
  readonly activePreviewHelperId?: string | null;
  readonly onIgnorePreviewReview?: (reviewId: string) => void;
  readonly onOpenDoc?: (pathOrId: string) => void;
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

  const isPreview = workspace.mode === "preview" && data.venture !== null;
  const venture = data.venture;

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

  if (kind === "mission") {
    const riskLevel = isPreview
      ? venture!.riskLevel
      : workspace.lead?.source.dropwaveBot?.kind === "lead"
        ? (workspace.lead.source.dropwaveBot.riskLevel ?? "yolo")
        : "yolo";
    const riskBadge =
      riskLevel === "yolo"
        ? gt("Proactive: High")
        : riskLevel === "careful"
          ? gt("Careful")
          : gt("Balanced");
    const openCount = isPreview ? venture!.objectives.length : data.liveAsks.length;
    const progressPct = isPreview
      ? venture!.sprintProgress
      : openCount === 0
        ? 100
        : Math.min(
            95,
            Math.max(
              24,
              Math.round(
                (data.liveAsks.filter((a) => a.status === "started" || a.status === "done").length /
                  Math.max(1, openCount)) *
                  100,
              ),
            ),
          );
    const headline = isPreview
      ? venture!.sprintTitle
      : workspace.project
        ? workspace.project.title
        : gt("Core Loop");

    return (
      <section data-dw-card="" data-widget="mission">
        <div data-dw-card-top="">
          <div data-dw-card-head="">
            <span data-dw-card-title="">
              <span data-dw-dot="indigo" />
              <span>
                <T>Mission Control</T>
              </span>
            </span>
            <div data-dw-card-head-right="">
              <span data-dw-badge="emerald">{riskBadge}</span>
              {slotSwitcher}
            </div>
          </div>

          <div data-dw-sprint="">
            <div data-dw-sprint-row="">
              <strong>{headline}</strong>
              <span data-dw-mono="emerald">{progressPct}%</span>
            </div>
            <div data-dw-progress-track="">
              <div data-dw-progress-fill="indigo" style={{ width: `${progressPct}%` }} />
            </div>
          </div>

          <div data-dw-obj-list="">
            {isPreview ? (
              venture!.objectives.map((obj) => (
                <button
                  key={obj.id}
                  type="button"
                  data-dw-obj-row=""
                  onClick={() => {
                    if (obj.status === "approval" && venture!.reviews[0]) {
                      workspace.jumpToReview(venture!.reviews[0].id);
                    } else {
                      workspace.openPanel({ kind: "asks" });
                    }
                  }}
                >
                  <span data-dw-obj-left="">
                    <span
                      data-dw-dot={
                        obj.status === "approval"
                          ? "coral"
                          : obj.status === "waiting"
                            ? "amber"
                            : "emerald"
                      }
                    />
                    <span>{obj.title}</span>
                  </span>
                  <span
                    data-dw-mono={
                      obj.status === "approval"
                        ? "coral"
                        : obj.status === "live"
                          ? "emerald"
                          : "muted"
                    }
                  >
                    {obj.badge}
                  </span>
                </button>
              ))
            ) : data.liveAsks.length > 0 ? (
              data.liveAsks.slice(0, 4).map((ask) => (
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
                <T>Every ask you send in chat is tracked here through your core loop.</T>
              </p>
            )}
          </div>
        </div>

        <div data-dw-card-foot="">
          <span data-dw-muted-label="">
            {isPreview ? <T>Autonomous budget</T> : <T>Tracked asks</T>}
          </span>
          {isPreview ? (
            <span data-dw-mono="bright">
              ${venture!.budgetUsed} <small>/ ${venture!.budgetLimit}</small>
            </span>
          ) : (
            <button
              type="button"
              data-dw-inline-link=""
              onClick={() => workspace.openPanel({ kind: "asks" })}
            >
              <T>
                <Var>{data.liveAsks.length}</Var> open
              </T>
            </button>
          )}
        </div>
      </section>
    );
  }

  if (kind === "helpers") {
    const liveHelpers = workspace.bots.filter(
      (bot) =>
        bot.environmentId === workspace.lead?.environmentId &&
        bot.source.dropwaveBot?.kind === "teammate" &&
        bot.source.dropwaveBot.leadThreadId === workspace.lead.id,
    );
    const activeHelperCount = isPreview ? venture!.helpers.length : liveHelpers.length;

    return (
      <section data-dw-card="" data-widget="helpers">
        <div data-dw-card-top="">
          <div data-dw-card-head="">
            <span data-dw-card-title="">
              <span>
                <T>Helper Bots</T>
              </span>
            </span>
            <div data-dw-card-head-right="">
              <span data-dw-status-inline="emerald">
                <span data-dw-dot="emerald" />
                <T>
                  <Var>{activeHelperCount}</Var> Active
                </T>
              </span>
              {!isPreview && workspace.lead && workspace.project ? (
                <button
                  type="button"
                  data-dw-slot-swap=""
                  aria-label={gt("Add helper bot")}
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
            {isPreview ? (
              venture!.helpers.length > 0 ? (
                venture!.helpers.map((helper) => (
                  <button
                    key={helper.id}
                    type="button"
                    data-dw-helper-row=""
                    aria-current={data.activePreviewHelperId === helper.id ? "true" : undefined}
                    onClick={() =>
                      data.onSelectPreviewHelper?.(
                        data.activePreviewHelperId === helper.id ? null : helper.id,
                      )
                    }
                  >
                    <span data-dw-monogram={helper.tone}>{helper.code}</span>
                    <span data-dw-helper-info="">
                      <span data-dw-helper-head="">
                        <strong>{helper.name}</strong>
                        <span data-dw-mono={helper.state === "active" ? "emerald" : "amber"}>
                          {helper.state}
                        </span>
                      </span>
                      <small>{helper.statusLine}</small>
                    </span>
                  </button>
                ))
              ) : (
                <p data-dw-card-empty="">
                  <T>Solo loop. Main bot handles every step end-to-end.</T>
                </p>
              )
            ) : liveHelpers.length > 0 ? (
              liveHelpers.map((bot, idx) => {
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
                    onClick={() => workspace.openThread(scopeThreadRef(bot.environmentId, bot.id))}
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
                        {bot.source.dropwaveBot?.kind === "teammate" && bot.source.dropwaveBot.role
                          ? bot.source.dropwaveBot.role
                          : bot.source.dropwaveBot?.brief || gt("Specialist teammate")}
                      </small>
                    </span>
                  </button>
                );
              })
            ) : (
              <p data-dw-card-empty="">
                <T>Solo loop. Ask Chief of Staff to wire a QA or SEO helper anytime.</T>
              </p>
            )}
          </div>
        </div>

        <div data-dw-branch-foot="">
          <div data-dw-branch-head="">
            <span>
              <T>Active Branches</T>
            </span>
            <span data-dw-mono="muted">
              {isPreview ? (
                <T>
                  <Var>{venture!.branches.length + 1}</Var> runs
                </T>
              ) : (
                <T>
                  <Var>{workspace.threads.filter(isCurrentWork).length}</Var> runs
                </T>
              )}
            </span>
          </div>
          {isPreview ? (
            <div data-dw-branch-rows="">
              {venture!.branches.map((branch) => (
                <div key={branch.id} data-dw-branch-row="">
                  <span data-dw-mono={branch.tone}>{branch.ref}</span>
                  <span>{branch.summary}</span>
                </div>
              ))}
            </div>
          ) : (
            <div data-dw-branch-rows="">
              {workspace.threads
                .filter((t) => t.branch !== null || t.linkedPullRequest !== null)
                .slice(0, 2)
                .map((t) => (
                  <button
                    key={keyOfThread(t)}
                    type="button"
                    data-dw-branch-row=""
                    onClick={() => workspace.openThread(scopeThreadRef(t.environmentId, t.id))}
                  >
                    <span data-dw-mono="emerald">
                      {t.linkedPullRequest ? `#${t.linkedPullRequest.number}` : t.branch}
                    </span>
                    <span>{t.title}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
      </section>
    );
  }

  if (kind === "reviews") {
    const reviews = isPreview ? venture!.reviews : [];
    const liveNeeds = isPreview ? [] : workspace.needs;
    const totalUrgent = isPreview ? reviews.length : liveNeeds.length;

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
                <span data-dw-badge="coral">
                  <T>
                    <Var>{totalUrgent}</Var> urgent
                  </T>
                </span>
              ) : (
                <span data-dw-badge="emerald">
                  <T>Clear</T>
                </span>
              )}
              {slotSwitcher}
            </div>
          </div>

          <div data-dw-review-list="">
            {isPreview ? (
              reviews.length > 0 ? (
                reviews.map((rev, index) => (
                  <div key={rev.id} data-dw-review-item={index === 0 ? "urgent" : "normal"}>
                    <div data-dw-review-head="">
                      <strong>{rev.title}</strong>
                      <span data-dw-mono={index === 0 ? "coral" : "muted"}>
                        {rev.sessionTag.replace("Session ", "")}
                      </span>
                    </div>
                    <p>{rev.summary}</p>
                    {index === 0 ? (
                      <div data-dw-review-actions="">
                        <button
                          type="button"
                          data-dw-coral-btn=""
                          onClick={() => workspace.jumpToReview(rev.id)}
                        >
                          <T>Resolve in Chat</T>
                        </button>
                        <button
                          type="button"
                          data-dw-ghost-xs=""
                          onClick={() => data.onIgnorePreviewReview?.(rev.id)}
                        >
                          <T>Ignore</T>
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <p data-dw-card-empty="">
                  <T>Nothing blocked. Your bots are running autonomously.</T>
                </p>
              )
            ) : liveNeeds.length > 0 ? (
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
                      onClick={() =>
                        workspace.openThread(scopeThreadRef(thread.environmentId, thread.id))
                      }
                    >
                      <T>Resolve in Chat</T>
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <p data-dw-card-empty="">
                <T>Nothing needs you right now.</T>
              </p>
            )}
          </div>
        </div>

        <div data-dw-card-foot-center="">
          {totalUrgent > 0 ? (
            <T>Auto-reminder active until resolved</T>
          ) : (
            <T>All clear across projects</T>
          )}
        </div>
      </section>
    );
  }

  if (kind === "sessions") {
    const owner = workspace.activeBot ?? workspace.lead;
    const liveSessions =
      !isPreview && owner
        ? workFor(workspace.threads, scopeThreadRef(owner.environmentId, owner.id)).sort(
            newestWorkFirst,
          )
        : [];
    const activeCount = isPreview
      ? venture!.sessions.filter((s) => s.status === "running" || s.status === "awaiting").length
      : liveSessions.filter(isCurrentWork).length;
    const queuedCount = isPreview
      ? venture!.sessions.filter((s) => s.status === "queued").length
      : liveSessions.filter((s) => workState(s) === "waiting").length;

    return (
      <section data-dw-card="" data-widget="sessions">
        <div data-dw-card-top="">
          <div data-dw-card-head="">
            <span data-dw-card-title="">
              <span data-dw-dot="emerald" data-pulse="" />
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
            {isPreview ? (
              venture!.sessions.map((session) => (
                <div key={session.id} data-dw-session-card={session.status}>
                  <div data-dw-session-card-head="">
                    <strong>{session.title}</strong>
                    <span
                      data-dw-mono={
                        session.status === "awaiting"
                          ? "coral-pill"
                          : session.progress !== undefined
                            ? "emerald"
                            : "muted"
                      }
                    >
                      {session.badge}
                    </span>
                  </div>
                  {session.progress !== undefined ? (
                    <div data-dw-progress-track="sm">
                      <div
                        data-dw-progress-fill="emerald"
                        style={{ width: `${session.progress}%` }}
                      />
                    </div>
                  ) : null}
                  <div data-dw-session-card-sub="">
                    <span>{session.subtitle}</span>
                    {session.age ? <span data-dw-mono="dim">{session.age}</span> : null}
                  </div>
                </div>
              ))
            ) : liveSessions.length > 0 ? (
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
              <Var>{isPreview ? venture!.sessions.length : liveSessions.length}</Var> sessions
            </T>
          </span>
          <span data-dw-mono="emerald">
            <T>Nominal</T>
          </span>
        </div>
      </section>
    );
  }

  if (kind === "docs") {
    const items = isPreview
      ? venture!.docs.map((d) => ({
          id: d.id,
          title: d.title,
          meta: `${d.kind} · ${d.updated}`,
        }))
      : data.liveDocs.map((d) => ({
          id: d.path,
          title: d.title,
          meta: `${d.kind} · ${formatShortAge(d.updatedAt)}`,
        }));
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
            {items.length > 0 ? (
              items.slice(0, 5).map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  data-dw-obj-row=""
                  onClick={() => {
                    data.onOpenDoc?.(doc.id);
                    workspace.setMainView("docs");
                  }}
                >
                  <span data-dw-obj-left="">
                    <FileTextIcon className="size-3 shrink-0" data-dw-icon="indigo" />
                    <span>{doc.title}</span>
                  </span>
                  <span data-dw-mono="muted">{doc.meta}</span>
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
          <span data-dw-mono="muted">{items.length}</span>
        </div>
      </section>
    );
  }

  // kind === "memory"
  const memItems = isPreview
    ? venture!.memories
    : data.liveMemories.map((item) => ({
        id: item.id,
        kind: item.kind,
        text: item.text,
      }));
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
          {memItems.length > 0 ? (
            memItems.slice(0, 4).map((mem) => (
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
        <span data-dw-mono="muted">{memItems.length}</span>
      </div>
    </section>
  );
}
