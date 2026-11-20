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
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { T, Var, useGT } from "gt-react";
import { PanelLeftOpenIcon } from "lucide-react";
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
import { DropwaveAsksPanel } from "./DropwaveAsksPanel";
import { DropwaveBotAvatar } from "./DropwaveBotAvatar";
import { DropwaveChatPillar } from "./DropwaveChatPillar";
import { DropwaveConversationalSetup } from "./DropwaveConversationalSetup";
import { DropwaveDocsView } from "./DropwaveDocsView";
import { DropwaveLiveDecisionModal } from "./DropwaveLiveDecisionModal";
import { DropwavePanels } from "./DropwavePanels";
import { DropwaveSettingsDialog } from "./DropwaveSettingsDialog";
import { DropwaveSidebar } from "./DropwaveSidebar";
import { useDropwaveAppearance } from "./DropwaveToolbar";
import { botOwner, isWorkspaceBot, keyOfThread, needsOwner, newestWorkFirst } from "./model";
import {
  DropwaveModeContext,
  DropwaveWorkspaceContext,
  type DropwaveMainView,
  type WorkspacePanel,
} from "./workspaceContext";
import "./workspace.css";

const LAST_PROJECT_KEY = "dropwave:last-project";
const ProjectKey = Schema.NullOr(Schema.String);
const DefaultRiskSchema = Schema.Literals(["careful", "normal", "yolo"]);

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
  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorage(
    "dropwave:sidebar-collapsed",
    false,
    Schema.Boolean,
  );
  const [defaultRisk, setDefaultRisk] = useLocalStorage(
    "dropwave:default-risk",
    "yolo",
    DefaultRiskSchema,
  );
  const appearance = useDropwaveAppearance();

  const [panel, setPanel] = useState<WorkspacePanel | null>(null);
  const [mainView, setMainView] = useState<DropwaveMainView>("chat");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [decisionModalOpen, setDecisionModalOpen] = useState(false);
  const [openAsksCount, setOpenAsksCount] = useState(0);
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
  const activeUpdatedAt = activeThread?.updatedAt ?? null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads open ask count for the active project
  useEffect(() => {
    if (!project || refreshNonce < 0) return;
    if (activeUpdatedAt === "__never__") return;
    let cancelled = false;
    void listAsksCmd({
      environmentId: project.environmentId,
      input: { projectId: project.id, includeClosed: false },
    }).then((res) => {
      if (!cancelled && res._tag === "Success") setOpenAsksCount(res.value.asks.length);
    });
    return () => {
      cancelled = true;
    };
  }, [activeUpdatedAt, listAsksCmd, project, refreshNonce]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps obsidian glass tokens active across all portals & T3 pickers
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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- retains active bot delegated session family for sidebar sessions list
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

  const selectProject = (chosen: EnvironmentProject) => {
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
  };

  const headerBot = activeBot ?? lead;
  const headerName = activeThread?.title ?? headerBot?.title ?? gt("Chief of Staff");
  const headerRole =
    headerBot?.source.dropwaveBot?.kind === "lead" ? "lead" : ("specialist" as const);

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
        setMainView: (next) => {
          setMainView(next);
          if (next === "setup") {
            void navigate({ to: "/" });
          }
        },
        openAsksCount,
        refreshOpenAsksCount: () => setRefreshNonce((n) => n + 1),
        selectProject,
        openThread,
        openPanel: setPanel,
        openDecisionQueue: () => setDecisionModalOpen(true),
        openSettings: () => setSettingsOpen(true),
      }}
    >
      <DropwaveModeContext value={true}>
        <div
          data-dw-atelier=""
          data-collapsed={sidebarCollapsed ? "true" : undefined}
          style={appearance.style}
        >
          {/* Left Frosted-Glass Sidebar (Bot faces, auto-collapsing Projects + Pins, Team, Sessions) */}
          {!sidebarCollapsed ? (
            <DropwaveSidebar appearance={appearance} onCollapse={() => setSidebarCollapsed(true)} />
          ) : null}

          {/* Main Open Frosted-Glass Canvas */}
          <main data-dw-canvas="">
            <header data-dw-canvas-head="">
              <div data-dw-canvas-left="">
                {sidebarCollapsed ? (
                  <button
                    type="button"
                    data-dw-rail-icon=""
                    aria-label={gt("Show sidebar")}
                    onClick={() => setSidebarCollapsed(false)}
                  >
                    <PanelLeftOpenIcon className="size-4" />
                  </button>
                ) : null}
                <button
                  type="button"
                  data-dw-canvas-bot=""
                  aria-label={gt("Bot and core loop settings")}
                  onClick={() => {
                    if (headerBot) {
                      setPanel({ kind: "profile", target: { kind: "edit", bot: headerBot } });
                    }
                  }}
                >
                  <DropwaveBotAvatar
                    name={headerName}
                    seed={headerBot?.source.dropwaveBot?.avatarSeed}
                    role={headerRole}
                    size="sm"
                  />
                  <strong>{headerName}</strong>
                  {project ? <span>{project.title}</span> : null}
                </button>
              </div>

              <div data-dw-canvas-right="">
                {needs.length > 0 ? (
                  <button
                    type="button"
                    data-dw-needs-pill="urgent"
                    aria-label={gt("Needs you")}
                    onClick={() => setDecisionModalOpen(true)}
                  >
                    <span data-dw-dot="coral" data-pulse="" />
                    <span>
                      <T>
                        <Var>{needs.length}</Var> needs you
                      </T>
                    </span>
                  </button>
                ) : null}

                <div data-dw-canvas-tabs="" role="tablist" aria-label={gt("Workspace views")}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mainView === "chat"}
                    onClick={() => setMainView("chat")}
                  >
                    <T>Chat</T>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mainView === "docs"}
                    onClick={() => setMainView("docs")}
                  >
                    <T>Docs</T>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={mainView === "asks"}
                    onClick={() => setMainView("asks")}
                  >
                    <T>Asks</T>
                    {openAsksCount > 0 ? <em data-dw-tab-count="">{openAsksCount}</em> : null}
                  </button>
                </div>
              </div>
            </header>

            <div data-dw-canvas-body="">
              {mainView === "setup" ? (
                <DropwaveConversationalSetup
                  key={project ? keyOfProject(project) : "new"}
                  defaultRisk={defaultRisk}
                  onCancel={() => setMainView("chat")}
                />
              ) : mainView === "docs" ? (
                <DropwaveDocsView />
              ) : mainView === "asks" ? (
                <div data-dw-asks-canvas="">
                  <DropwaveAsksPanel />
                </div>
              ) : (
                <DropwaveChatPillar />
              )}
            </div>
          </main>

          {/* Engine Settings route modal */}
          {modalOpen ? <SidebarProvider>{children}</SidebarProvider> : null}
        </div>
      </DropwaveModeContext>

      {/* Live Decision Queue Focus Modal */}
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
