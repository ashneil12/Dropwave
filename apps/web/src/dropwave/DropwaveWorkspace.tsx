import {
  scopedProjectKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { threadKey } from "@t3tools/client-runtime/state/entities";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type {
  DropwaveAsk,
  DropwaveDocSummary,
  DropwaveMemoryItem,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { T, Var, useGT } from "gt-react";
import { PlusIcon, ZapIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { SidebarProvider } from "../components/ui/sidebar";
import { useComposerDraftStore } from "../composerDraftStore";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useShownThreadRouteTarget } from "../hooks/useShownThreadRouteTarget";
import { useRightPanelStore } from "../rightPanelStore";
import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  useHiddenThreadKeys,
  useProjects,
  useThreadShell,
  useThreadShells,
} from "../state/entities";
import { serverEnvironment } from "../state/server";
import { threadFamilies } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { buildThreadRouteParams } from "../threadRoutes";
import { DropwaveChatPillar } from "./DropwaveChatPillar";
import { DropwaveConversationalSetup } from "./DropwaveConversationalSetup";
import { DropwaveDocsView } from "./DropwaveDocsView";
import { DropwavePanels } from "./DropwavePanels";
import { DropwaveToolbar, useDropwaveAppearance } from "./DropwaveToolbar";
import { DropwaveWidgetCard } from "./DropwaveWidgets";
import { botOwner, isWorkspaceBot, keyOfThread, needsOwner, newestWorkFirst } from "./model";
import {
  INITIAL_SAMPLE_VENTURES,
  type SampleDoc,
  type SampleMemory,
  type SampleVenture,
} from "./sampleData";
import {
  DropwaveModeContext,
  DropwaveWorkspaceContext,
  type DropwaveMainView,
  type DropwaveMode,
  type DropwaveSlotLayout,
  type DropwaveWidgetKind,
  type WorkspacePanel,
} from "./workspaceContext";
import "./workspace.css";

const LAST_PROJECT_KEY = "dropwave:last-project";
const ProjectKey = Schema.NullOr(Schema.String);
const WidgetKindSchema = Schema.Literals([
  "mission",
  "helpers",
  "reviews",
  "sessions",
  "docs",
  "memory",
]);
const SlotLayoutSchema = Schema.Struct({
  topLeft: WidgetKindSchema,
  bottomLeft: WidgetKindSchema,
  topRight: WidgetKindSchema,
  bottomRight: WidgetKindSchema,
});
const DEFAULT_SLOTS: DropwaveSlotLayout = {
  topLeft: "mission",
  bottomLeft: "helpers",
  topRight: "reviews",
  bottomRight: "sessions",
};
const ModeOverrideSchema = Schema.NullOr(Schema.Literals(["preview", "live"]));

function keyOfProject(project: EnvironmentProject) {
  return scopedProjectKey({ environmentId: project.environmentId, projectId: project.id });
}

function projectIncludes(project: EnvironmentProject, thread: EnvironmentThreadShell) {
  return project.id === thread.projectId && project.environmentId === thread.environmentId;
}

function leadFor(project: EnvironmentProject, bots: ReadonlyArray<EnvironmentThreadShell>) {
  return (
    bots.find(
      (thread) => projectIncludes(project, thread) && thread.source.dropwaveBot?.kind === "lead",
    ) ?? null
  );
}

export function DropwaveWorkspace({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const gt = useGT();
  const { shownTarget, modalOpen } = useShownThreadRouteTarget();

  const projects = useProjects().filter(
    (project) => project.archivedAt == null && !project.isScratch,
  );
  const allThreads = useThreadShells().filter((thread) => thread.deletedAt === null);
  const hiddenKeys = useHiddenThreadKeys();
  const threads = allThreads.filter((thread) => !hiddenKeys.has(keyOfThread(thread)));
  const byKey = new Map(allThreads.map((thread) => [keyOfThread(thread), thread]));
  const roster = allThreads.filter(isWorkspaceBot);
  const bots = roster.filter((thread) => !hiddenKeys.has(keyOfThread(thread)));
  const activeThread = useThreadShell(
    shownTarget?.kind === "server" ? shownTarget.threadRef : null,
  );
  const draft = useComposerDraftStore((store) =>
    shownTarget?.kind === "draft" ? store.getDraftSession(shownTarget.draftId) : null,
  );

  const [lastProject, setLastProject] = useLocalStorage(LAST_PROJECT_KEY, null, ProjectKey);
  const [slots, setSlots] = useLocalStorage(
    "dropwave:slot-layout",
    DEFAULT_SLOTS,
    SlotLayoutSchema,
  );
  const [focusMode, setFocusMode] = useLocalStorage("dropwave:focus-mode", false, Schema.Boolean);
  const [modeOverride, setModeOverride] = useLocalStorage(
    "dropwave:workspace-mode",
    null,
    ModeOverrideSchema,
  );
  const appearance = useDropwaveAppearance();

  const [panel, setPanel] = useState<WorkspacePanel | null>(null);
  const [mainView, setMainView] = useState<DropwaveMainView>("chat");
  const [highlightReviewId, setHighlightReviewId] = useState<string | null>(null);
  const [openDocId, setOpenDocId] = useState<string | null>(null);

  // Sample workspace state (interactive Preview mode so founder can experience full Dropwave immediately)
  const [ventures, setVentures] = useState<ReadonlyArray<SampleVenture>>(INITIAL_SAMPLE_VENTURES);
  const [selectedVentureId, setSelectedVentureId] = useState(INITIAL_SAMPLE_VENTURES[0]!.id);
  const [activePreviewHelperId, setActivePreviewHelperId] = useState<string | null>(null);
  const [resolvedReviews, setResolvedReviews] = useState<Record<string, string>>({});

  // Live Dropwave backend data for side widgets
  const [liveAsks, setLiveAsks] = useState<ReadonlyArray<DropwaveAsk>>([]);
  const [liveDocs, setLiveDocs] = useState<ReadonlyArray<DropwaveDocSummary>>([]);
  const [liveMemories, setLiveMemories] = useState<ReadonlyArray<DropwaveMemoryItem>>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const hasAnyLiveLead = roster.some((b) => b.source.dropwaveBot?.kind === "lead");
  const mode: DropwaveMode = modeOverride ?? (hasAnyLiveLead ? "live" : "preview");

  const activeBot = botOwner(byKey, activeThread);
  const routeProject = activeBot ?? activeThread ?? draft;
  const project =
    projects.find(
      (candidate) =>
        candidate.id === routeProject?.projectId &&
        candidate.environmentId === routeProject.environmentId,
    ) ??
    projects.find((candidate) => keyOfProject(candidate) === lastProject) ??
    projects[0] ??
    null;
  const lead = project ? leadFor(project, roster) : null;
  const leadHidden = lead !== null && hiddenKeys.has(keyOfThread(lead));
  const needs = threads
    .filter(
      (thread) =>
        thread.archivedAt === null && needsOwner(thread) && botOwner(byKey, thread) !== null,
    )
    .sort(newestWorkFirst);

  const activeVenture = ventures.find((v) => v.id === selectedVentureId) ?? ventures[0] ?? null;

  const listAsksCmd = useAtomCommand(serverEnvironment.dropwaveAsksList, { reportFailure: false });
  const listDocsCmd = useAtomCommand(serverEnvironment.dropwaveDocsList, { reportFailure: false });
  const listMemCmd = useAtomCommand(serverEnvironment.dropwaveMemoryList, { reportFailure: false });

  const activeUpdatedAt = activeThread?.updatedAt ?? null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads live Dropwave asks, docs, and memories for the active project
  useEffect(() => {
    if (mode !== "live" || !project || refreshNonce < 0) return;
    if (activeUpdatedAt === "__never__") return;
    let cancelled = false;
    void listAsksCmd({
      environmentId: project.environmentId,
      input: { projectId: project.id, includeClosed: false },
    }).then((res) => {
      if (!cancelled && res._tag === "Success") setLiveAsks(res.value.asks);
    });
    void listDocsCmd({
      environmentId: project.environmentId,
      input: { projectId: project.id },
    }).then((res) => {
      if (!cancelled && res._tag === "Success") setLiveDocs(res.value.docs);
    });
    void listMemCmd({
      environmentId: project.environmentId,
      input: { projectId: project.id },
    }).then((res) => {
      if (!cancelled && res._tag === "Success") setLiveMemories(res.value.items);
    });
    return () => {
      cancelled = true;
    };
  }, [activeUpdatedAt, listAsksCmd, listDocsCmd, listMemCmd, mode, project, refreshNonce]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- stamps dark glass root attributes for Settings dialogs and popovers
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    root.dataset.dropwaveActive = "";
    root.classList.add("dark");
    return () => {
      delete root.dataset.dropwaveActive;
      if (!hadDark) root.classList.remove("dark");
    };
  }, []);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- retains active bot delegated session family for live sessions widget
  useEffect(() => {
    const owner = activeBot ?? lead;
    if (!owner) return;
    return threadFamilies.mount(appAtomRegistry, owner.environmentId, owner.id);
  }, [activeBot, lead]);

  const openThread = (ref: ScopedThreadRef) => {
    setPanel(null);
    setMainView("chat");
    setModeOverride("live");
    const panels = useRightPanelStore.getState();
    if (panels.threadPanelVisibilityByThreadKey[scopedThreadKey(ref)] === undefined) {
      panels.setThreadPanelOpen(ref, "inline", false);
    }
    const thread = byKey.get(threadKey(ref));
    const owner = botOwner(byKey, thread ?? null);
    const projectThread = owner ?? thread;
    const match = projectThread
      ? projects.find((candidate) => projectIncludes(candidate, projectThread))
      : null;
    if (match) setLastProject(keyOfProject(match));
    void navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  };

  const setSlotWidget = (slot: keyof DropwaveSlotLayout, kind: DropwaveWidgetKind) => {
    setSlots({ ...slots, [slot]: kind });
  };

  const jumpToReview = (reviewId: string) => {
    setMainView("chat");
    setActivePreviewHelperId(null);
    setHighlightReviewId(reviewId);
    setTimeout(() => {
      document.getElementById(`review-${reviewId}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 40);
  };

  const handleResolvePreviewReview = (
    reviewId: string,
    choiceLabel: string,
    alwaysDoThis: boolean,
  ) => {
    if (!activeVenture) return;
    setResolvedReviews((prev) => ({
      ...prev,
      [reviewId]: alwaysDoThis
        ? gt("Saved rule & chose: {choice}", { choice: choiceLabel })
        : gt("Chose: {choice} (just this once)", { choice: choiceLabel }),
    }));
    setVentures((prev) =>
      prev.map((v) => {
        if (v.id !== activeVenture.id) return v;
        const review = v.reviews.find((r) => r.id === reviewId);
        return {
          ...v,
          reviews: v.reviews.filter((r) => r.id !== reviewId),
          objectives: v.objectives.map((o) =>
            o.status === "approval" ? { ...o, status: "live" as const, badge: "Resolved" } : o,
          ),
          memories:
            alwaysDoThis && review
              ? [
                  {
                    id: `mem-${Date.now()}`,
                    kind: "rule",
                    text: gt("Always: {choice} ({title})", {
                      choice: choiceLabel,
                      title: review.title,
                    }),
                    quote: review.question,
                  },
                  ...v.memories,
                ]
              : v.memories,
        };
      }),
    );
  };

  const handleIgnorePreviewReview = (reviewId: string) => {
    if (!activeVenture) return;
    setVentures((prev) =>
      prev.map((v) =>
        v.id === activeVenture.id
          ? { ...v, reviews: v.reviews.filter((r) => r.id !== reviewId) }
          : v,
      ),
    );
  };

  const handleSendPreviewMessage = (text: string) => {
    if (!activeVenture) return;
    const nowTime = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    setVentures((prev) =>
      prev.map((v) => {
        if (v.id !== activeVenture.id) return v;
        const nextObjId = `ask-${Date.now()}`;
        return {
          ...v,
          objectives: [
            {
              id: nextObjId,
              title: text.slice(0, 44),
              status: "working",
              badge: "Tracked",
            },
            ...v.objectives,
          ],
          messages: [
            ...v.messages,
            {
              id: `u-${Date.now()}`,
              role: "owner",
              author: "Founder",
              authorCode: "S",
              time: nowTime,
              text,
            },
            {
              id: `b-${Date.now() + 1}`,
              role: "bot",
              author: v.leadName,
              authorCode: v.leadCode,
              time: nowTime,
              text: gt(
                "Logged in Mission Control and queued through the {name} core loop. Switch to Live in the top bar anytime to run real agents on your repos.",
                { name: v.name },
              ),
            },
          ],
        };
      }),
    );
  };

  const handleSavePreviewDoc = (doc: SampleDoc) => {
    if (!activeVenture) return;
    setVentures((prev) =>
      prev.map((v) => {
        if (v.id !== activeVenture.id) return v;
        const exists = v.docs.some((d) => d.id === doc.id);
        return {
          ...v,
          docs: exists ? v.docs.map((d) => (d.id === doc.id ? doc : d)) : [doc, ...v.docs],
        };
      }),
    );
  };

  const handleAddPreviewMemory = (mem: SampleMemory) => {
    if (!activeVenture) return;
    setVentures((prev) =>
      prev.map((v) => (v.id === activeVenture.id ? { ...v, memories: [mem, ...v.memories] } : v)),
    );
  };

  const handleRemovePreviewMemory = (id: string) => {
    if (!activeVenture) return;
    setVentures((prev) =>
      prev.map((v) =>
        v.id === activeVenture.id
          ? { ...v, memories: v.memories.filter((item) => item.id !== id) }
          : v,
      ),
    );
  };

  const totalNeedsCount =
    mode === "preview" ? ventures.reduce((sum, v) => sum + v.reviews.length, 0) : needs.length;

  const targetText =
    mode === "preview" && activeVenture
      ? activeVenture.targetLine
      : project
        ? project.title
        : gt("No project linked");
  const statusText =
    mode === "preview" && activeVenture
      ? activeVenture.statusWord
      : lead
        ? gt("Autonomous Execution")
        : gt("Ready for setup");

  const widgetData = {
    venture: mode === "preview" ? activeVenture : null,
    liveAsks,
    liveDocs,
    liveMemories,
    activePreviewHelperId,
    onSelectPreviewHelper: (id: string | null) => {
      setActivePreviewHelperId(id);
      setMainView("chat");
    },
    onIgnorePreviewReview: handleIgnorePreviewReview,
    onOpenDoc: (docId: string) => setOpenDocId(docId),
  };

  return (
    <DropwaveWorkspaceContext
      value={{
        mode,
        setMode: (next) => {
          setModeOverride(next);
          setMainView("chat");
        },
        projects,
        project,
        threads,
        bots,
        lead,
        leadHidden,
        needsProject: (candidate) =>
          needs.some((thread) => {
            const owner = botOwner(byKey, thread);
            return owner !== null && projectIncludes(candidate, owner);
          }),
        activeThread,
        activeBot,
        needs,
        selectedProjectKey: project ? keyOfProject(project) : null,
        mainView,
        setMainView,
        openAsksCount:
          mode === "preview" ? (activeVenture?.objectives.length ?? 0) : liveAsks.length,
        refreshOpenAsksCount: () => setRefreshNonce((n) => n + 1),
        selectProject: (chosen) => {
          setLastProject(keyOfProject(chosen));
          setPanel(null);
          setModeOverride("live");
          const chosenLead = leadFor(chosen, roster);
          if (chosenLead && !hiddenKeys.has(keyOfThread(chosenLead))) {
            setMainView("chat");
            openThread(scopeThreadRef(chosenLead.environmentId, chosenLead.id));
          } else {
            setMainView("setup");
            void navigate({ to: "/" });
          }
        },
        openThread,
        openPanel: setPanel,
        slots,
        setSlotWidget,
        focusMode,
        setFocusMode,
        highlightReviewId,
        jumpToReview,
      }}
    >
      <DropwaveModeContext value={true}>
        <div data-dw-cockpit="" style={appearance.style}>
          {/* Top Venture Switcher Bar */}
          <header data-dw-topbar="">
            <div data-dw-topbar-left="">
              <span data-dw-brand="">
                <span data-dw-brand-dot="" />
                {/* oxlint-disable-next-line t3code/no-untranslated-copy -- product brand name */}
                <strong>Dropwave</strong>
              </span>

              <span data-dw-vdiv="" aria-hidden="true" />

              <nav data-dw-ventures="" aria-label={gt("Projects")}>
                {mode === "preview"
                  ? ventures.map((v) => {
                      const active = activeVenture?.id === v.id;
                      const hasUrgent = v.reviews.length > 0;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          data-dw-venture-pill=""
                          aria-current={active ? "true" : undefined}
                          onClick={() => {
                            setSelectedVentureId(v.id);
                            setActivePreviewHelperId(null);
                            setMainView("chat");
                          }}
                        >
                          <span
                            data-dw-dot={active ? "emerald" : hasUrgent ? "coral" : "dim"}
                            data-pulse={active ? "" : undefined}
                          />
                          <span>{v.name}</span>
                          {v.tag ? <small>{v.tag}</small> : null}
                        </button>
                      );
                    })
                  : projects.map((proj) => {
                      const key = keyOfProject(proj);
                      const active = project !== null && keyOfProject(project) === key;
                      const hasUrgent = needs.some((t) => {
                        const owner = botOwner(byKey, t);
                        return owner !== null && projectIncludes(proj, owner);
                      });
                      return (
                        <button
                          key={key}
                          type="button"
                          data-dw-venture-pill=""
                          aria-current={active ? "true" : undefined}
                          onClick={() => {
                            setLastProject(key);
                            const chosenLead = leadFor(proj, roster);
                            if (chosenLead && !hiddenKeys.has(keyOfThread(chosenLead))) {
                              setMainView("chat");
                              openThread(scopeThreadRef(chosenLead.environmentId, chosenLead.id));
                            } else {
                              setMainView("setup");
                            }
                          }}
                        >
                          <span
                            data-dw-dot={active ? "emerald" : hasUrgent ? "coral" : "dim"}
                            data-pulse={active ? "" : undefined}
                          />
                          <span>{proj.title}</span>
                        </button>
                      );
                    })}
                <button
                  type="button"
                  data-dw-venture-add=""
                  aria-label={gt("New project setup")}
                  onClick={() => setMainView("setup")}
                >
                  <PlusIcon className="size-3.5" />
                </button>
              </nav>
            </div>

            <div data-dw-topbar-center="">
              <span data-dw-target-pill="">
                <span data-dw-muted-label="">
                  <T>Active Target:</T>
                </span>
                <strong>{targetText}</strong>
                <span data-dw-muted-sep="">·</span>
                <span data-dw-mono="emerald">{statusText}</span>
              </span>
            </div>

            <DropwaveToolbar
              appearance={appearance}
              ventures={ventures}
              totalNeedsCount={totalNeedsCount}
              onSelectPreviewReview={(ventureId, reviewId) => {
                setSelectedVentureId(ventureId);
                jumpToReview(reviewId);
              }}
            />
          </header>

          {/* Main Spatial 3-Zone Workspace */}
          <main data-dw-spatial="" data-focus={focusMode ? "true" : undefined}>
            {!focusMode ? (
              <div data-dw-wing="left">
                <DropwaveWidgetCard slot="topLeft" kind={slots.topLeft} data={widgetData} />
                <DropwaveWidgetCard slot="bottomLeft" kind={slots.bottomLeft} data={widgetData} />
              </div>
            ) : null}

            <section data-dw-center-pillar="">
              {mainView === "setup" ? (
                <DropwaveConversationalSetup
                  onCancel={() => setMainView("chat")}
                  onCreatedPreviewVenture={(newVenture) => {
                    setVentures((prev) => [newVenture, ...prev]);
                    setSelectedVentureId(newVenture.id);
                    setActivePreviewHelperId(null);
                    setMainView("chat");
                  }}
                />
              ) : mainView === "docs" ? (
                <DropwaveDocsView
                  venture={mode === "preview" ? activeVenture : null}
                  initialDocId={openDocId}
                  onSavePreviewDoc={handleSavePreviewDoc}
                  onAddPreviewMemory={handleAddPreviewMemory}
                  onRemovePreviewMemory={handleRemovePreviewMemory}
                />
              ) : (
                <DropwaveChatPillar
                  venture={mode === "preview" ? activeVenture : null}
                  activePreviewHelperId={activePreviewHelperId}
                  onClearPreviewHelper={() => setActivePreviewHelperId(null)}
                  resolvedReviews={resolvedReviews}
                  onResolvePreviewReview={handleResolvePreviewReview}
                  onSendPreviewMessage={handleSendPreviewMessage}
                  onOpenDoc={(docId) => setOpenDocId(docId)}
                />
              )}
            </section>

            {!focusMode ? (
              <div data-dw-wing="right">
                <DropwaveWidgetCard slot="topRight" kind={slots.topRight} data={widgetData} />
                <DropwaveWidgetCard slot="bottomRight" kind={slots.bottomRight} data={widgetData} />
              </div>
            ) : null}
          </main>

          {/* Subtle Bottom Status Dock */}
          <footer data-dw-footer="">
            <div data-dw-footer-left="">
              <span data-dw-footer-badge="">S</span>
              <strong>
                <T>Solo Founder</T>
              </strong>
              <span data-dw-muted-sep="">·</span>
              <span data-dw-status-inline="emerald">
                <span data-dw-dot="emerald" />
                <T>Orchestrating</T>
              </span>
            </div>
            <div data-dw-footer-right="">
              <ZapIcon className="size-3" data-dw-icon="indigo" />
              <span>
                {mode === "preview" ? (
                  <T>Preview Showcase · click Live for connected repos</T>
                ) : (
                  <T>
                    Live Harness · <Var>{projects.length}</Var> projects
                  </T>
                )}
              </span>
            </div>
          </footer>

          {/* Settings & route modals render cleanly on top */}
          {modalOpen ? <SidebarProvider>{children}</SidebarProvider> : null}
        </div>
      </DropwaveModeContext>
      {!modalOpen && panel !== null ? (
        <DropwavePanels panel={panel} onClose={() => setPanel(null)} />
      ) : null}
    </DropwaveWorkspaceContext>
  );
}
