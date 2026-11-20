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
import { ChevronDownIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
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
import { DropwaveLiveDecisionModal } from "./DropwaveLiveDecisionModal";
import { DropwavePanels } from "./DropwavePanels";
import { DropwaveSettingsDialog } from "./DropwaveSettingsDialog";
import { DropwaveToolbar, useDropwaveAppearance } from "./DropwaveToolbar";
import { DropwaveWidgetCard } from "./DropwaveWidgets";
import { botOwner, isWorkspaceBot, keyOfThread, needsOwner, newestWorkFirst } from "./model";
import {
  DropwaveModeContext,
  DropwaveWorkspaceContext,
  type DropwaveMainView,
  type DropwaveSlotLayout,
  type DropwaveWidgetKind,
  type WorkspacePanel,
} from "./workspaceContext";
import "./workspace.css";

const LAST_PROJECT_KEY = "dropwave:last-project";
const ProjectKey = Schema.NullOr(Schema.String);
const WidgetKindSchema = Schema.Literals([
  "asks",
  "agents",
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
  topLeft: "asks",
  bottomLeft: "agents",
  topRight: "reviews",
  bottomRight: "sessions",
};
const DefaultRiskSchema = Schema.Literals(["careful", "normal", "yolo"]);
const MAX_TOPBAR_PROJECTS = 4;

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
    "dropwave:slot-layout-v2",
    DEFAULT_SLOTS,
    SlotLayoutSchema,
  );
  const [focusMode, setFocusMode] = useLocalStorage("dropwave:focus-mode", false, Schema.Boolean);
  const [defaultRisk, setDefaultRisk] = useLocalStorage(
    "dropwave:default-risk",
    "yolo",
    DefaultRiskSchema,
  );
  const appearance = useDropwaveAppearance();

  const [panel, setPanel] = useState<WorkspacePanel | null>(null);
  const [mainView, setMainView] = useState<DropwaveMainView>("chat");
  const [openDocPath, setOpenDocPath] = useState<string | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [decisionModalOpen, setDecisionModalOpen] = useState(false);

  const [liveAsks, setLiveAsks] = useState<ReadonlyArray<DropwaveAsk>>([]);
  const [liveDocs, setLiveDocs] = useState<ReadonlyArray<DropwaveDocSummary>>([]);
  const [liveMemories, setLiveMemories] = useState<ReadonlyArray<DropwaveMemoryItem>>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);

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

  const listAsksCmd = useAtomCommand(serverEnvironment.dropwaveAsksList, { reportFailure: false });
  const listDocsCmd = useAtomCommand(serverEnvironment.dropwaveDocsList, { reportFailure: false });
  const listMemCmd = useAtomCommand(serverEnvironment.dropwaveMemoryList, { reportFailure: false });

  const activeUpdatedAt = activeThread?.updatedAt ?? null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads live asks, docs, and memories for active project
  useEffect(() => {
    if (!project || refreshNonce < 0) return;
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
  }, [activeUpdatedAt, listAsksCmd, listDocsCmd, listMemCmd, project, refreshNonce]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps obsidian dark tokens active across all portals
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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- retains active bot delegated session family
  useEffect(() => {
    const owner = activeBot ?? lead;
    if (!owner) return;
    return threadFamilies.mount(appAtomRegistry, owner.environmentId, owner.id);
  }, [activeBot, lead]);

  const openThread = (ref: ScopedThreadRef) => {
    setPanel(null);
    setMainView("chat");
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

  const widgetData = {
    liveAsks,
    liveDocs,
    liveMemories,
    onOpenDoc: (path: string) => setOpenDocPath(path),
  };

  const visibleProjects = projects.slice(0, MAX_TOPBAR_PROJECTS);
  const searchLower = projectSearch.trim().toLowerCase();

  return (
    <DropwaveWorkspaceContext
      value={{
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
        openAsksCount: liveAsks.length,
        refreshOpenAsksCount: () => setRefreshNonce((n) => n + 1),
        selectProject: (chosen) => {
          setLastProject(keyOfProject(chosen));
          setPanel(null);
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
        openDecisionQueue: () => setDecisionModalOpen(true),
        openSettings: () => setSettingsOpen(true),
      }}
    >
      <DropwaveModeContext value={true}>
        <div data-dw-cockpit="" style={appearance.style}>
          {/* Top Venture Bar */}
          <header data-dw-topbar="">
            <div data-dw-topbar-left="">
              <Popover open={projectMenuOpen} onOpenChange={setProjectMenuOpen}>
                <PopoverTrigger type="button" data-dw-brand-btn="" aria-label={gt("All projects")}>
                  <span data-dw-brand-dot="" />
                  {/* oxlint-disable-next-line t3code/no-untranslated-copy -- product brand name */}
                  <strong>Dropwave</strong>
                  <ChevronDownIcon className="size-3.5 opacity-60" />
                </PopoverTrigger>
                <PopoverPopup align="start" width="md" padding="compact" data-dropwave-popover="">
                  <div data-dw-project-switcher="">
                    <label data-dw-switcher-search="">
                      <SearchIcon className="size-3.5" />
                      <input
                        value={projectSearch}
                        onChange={(e) => setProjectSearch(e.currentTarget.value)}
                        placeholder={gt("Switch project…")}
                        aria-label={gt("Switch project")}
                      />
                    </label>
                    <div data-dw-switcher-list="">
                      {projects
                        .filter((p) => !searchLower || p.title.toLowerCase().includes(searchLower))
                        .map((proj) => {
                          const key = keyOfProject(proj);
                          const active = project !== null && keyOfProject(project) === key;
                          return (
                            <button
                              key={key}
                              type="button"
                              data-dw-switcher-item=""
                              aria-current={active ? "true" : undefined}
                              onClick={() => {
                                setLastProject(key);
                                setProjectMenuOpen(false);
                                const chosenLead = leadFor(proj, roster);
                                if (chosenLead && !hiddenKeys.has(keyOfThread(chosenLead))) {
                                  setMainView("chat");
                                  openThread(
                                    scopeThreadRef(chosenLead.environmentId, chosenLead.id),
                                  );
                                } else {
                                  setMainView("setup");
                                  void navigate({ to: "/" });
                                }
                              }}
                            >
                              <span data-dw-switcher-left="">
                                <span data-dw-dot={active ? "emerald" : "dim"} />
                                <strong>{proj.title}</strong>
                              </span>
                            </button>
                          );
                        })}
                    </div>
                    <button
                      type="button"
                      data-dw-switcher-new=""
                      onClick={() => {
                        setProjectMenuOpen(false);
                        setMainView("setup");
                      }}
                    >
                      <PlusIcon className="size-3.5" />
                      <T>New project setup</T>
                    </button>
                  </div>
                </PopoverPopup>
              </Popover>

              <span data-dw-vdiv="" aria-hidden="true" />

              <nav data-dw-ventures="" aria-label={gt("Projects")}>
                {visibleProjects.map((proj) => {
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
                          void navigate({ to: "/" });
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

                {projects.length > MAX_TOPBAR_PROJECTS ? (
                  <button
                    type="button"
                    data-dw-venture-more=""
                    onClick={() => setProjectMenuOpen(true)}
                  >
                    <T>
                      +<Var>{projects.length - MAX_TOPBAR_PROJECTS}</Var>
                    </T>
                  </button>
                ) : null}

                <button
                  type="button"
                  data-dw-venture-add=""
                  aria-label={gt("New project setup")}
                  onClick={() => {
                    setMainView("setup");
                    void navigate({ to: "/" });
                  }}
                >
                  <PlusIcon className="size-3.5" />
                </button>
              </nav>
            </div>

            <DropwaveToolbar appearance={appearance} totalNeedsCount={needs.length} />
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
                  key={project ? keyOfProject(project) : "new"}
                  defaultRisk={defaultRisk}
                  onCancel={() => setMainView("chat")}
                />
              ) : mainView === "docs" ? (
                <DropwaveDocsView initialDocPath={openDocPath} />
              ) : (
                <DropwaveChatPillar />
              )}
            </section>

            {!focusMode ? (
              <div data-dw-wing="right">
                <DropwaveWidgetCard slot="topRight" kind={slots.topRight} data={widgetData} />
                <DropwaveWidgetCard slot="bottomRight" kind={slots.bottomRight} data={widgetData} />
              </div>
            ) : null}
          </main>

          {/* Engine Settings route modal */}
          {modalOpen ? <SidebarProvider>{children}</SidebarProvider> : null}
        </div>
      </DropwaveModeContext>

      {/* Live Decision Queue Modal */}
      <DropwaveLiveDecisionModal
        open={decisionModalOpen}
        needs={needs}
        projects={projects}
        leadsByProjectKey={
          new Map(
            roster
              .filter((b) => b.source.dropwaveBot?.kind === "lead")
              .map((b) => [`${b.environmentId}:${b.projectId}`, b] as const),
          )
        }
        onClose={() => setDecisionModalOpen(false)}
        onOpenThread={openThread}
        onSavedRule={() => setRefreshNonce((n) => n + 1)}
      />

      {/* Dropwave Settings Dialog */}
      <DropwaveSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        appearance={appearance}
        defaultRisk={defaultRisk}
        onChangeDefaultRisk={setDefaultRisk}
      />

      {!modalOpen && panel !== null ? (
        <DropwavePanels panel={panel} onClose={() => setPanel(null)} />
      ) : null}
    </DropwaveWorkspaceContext>
  );
}
