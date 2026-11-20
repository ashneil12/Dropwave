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
import { Link, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  ActivityIcon,
  InboxIcon,
  ListIcon,
  PlusIcon,
  Settings2Icon,
  UsersRoundIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { openCommandPalette } from "../commandPaletteBus";
import { AppSidebarLayout } from "../components/AppSidebarLayout";
import { useSidebar } from "../components/ui/sidebar";
import { useComposerDraftStore } from "../composerDraftStore";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useShownThreadRouteTarget } from "../hooks/useShownThreadRouteTarget";
import {
  useHiddenThreadKeys,
  useProjects,
  useThreadShell,
  useThreadShells,
} from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { useRightPanelStore } from "../rightPanelStore";
import { DropwavePanels } from "./DropwavePanels";
import { botOwner, isWorkspaceBot, keyOfThread, needsOwner, newestWorkFirst } from "./model";
import {
  DropwaveWorkspaceContext,
  DropwaveModeContext,
  useDropwaveWorkspace,
  type WorkspacePanel,
} from "./workspaceContext";
import "./workspace.css";

const LAST_PROJECT_KEY = "dropwave:last-project";
const ProjectKey = Schema.NullOr(Schema.String);

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
  const [panel, setPanel] = useState<WorkspacePanel | null>(null);
  const [classic, setClassic] = useState(false);
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

  const openThread = (ref: ScopedThreadRef) => {
    setPanel(null);
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

  return (
    <DropwaveWorkspaceContext
      value={
        classic
          ? null
          : {
              projects,
              project,
              threads,
              bots,
              lead,
              leadHidden,
              activeThread,
              activeBot,
              needs,
              selectedProjectKey: project ? keyOfProject(project) : null,
              selectProject: (chosen) => {
                setLastProject(keyOfProject(chosen));
                setPanel(null);
                const chosenLead = leadFor(chosen, roster);
                if (chosenLead && !hiddenKeys.has(keyOfThread(chosenLead))) {
                  openThread(scopeThreadRef(chosenLead.environmentId, chosenLead.id));
                } else void navigate({ to: "/" });
              },
              openThread,
              openPanel: setPanel,
              showClassicSidebar: () => {
                setPanel(null);
                setClassic(true);
              },
            }
      }
    >
      <DropwaveModeContext value={!classic}>
        <AppSidebarLayout
          {...(classic
            ? {
                sidebarAccessory: (
                  <button
                    data-dropwave-classic-return=""
                    type="button"
                    onClick={() => setClassic(false)}
                  >
                    Back to Dropwave
                  </button>
                ),
              }
            : { workspaceSidebar: <DropwaveRail /> })}
        >
          {children}
        </AppSidebarLayout>
      </DropwaveModeContext>
      {!classic && !modalOpen && panel !== null ? (
        <DropwavePanels panel={panel} onClose={() => setPanel(null)} />
      ) : null}
    </DropwaveWorkspaceContext>
  );
}

export function DropwaveMark() {
  return (
    <span data-dropwave-mark="" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function ProjectMark({ name }: { name: string }) {
  const hue = [...name].reduce((result, letter) => (result * 31 + letter.charCodeAt(0)) % 360, 250);
  const style: React.CSSProperties & { "--dw-project-hue": number } = { "--dw-project-hue": hue };
  return (
    <span data-dropwave-project-mark="" style={style} aria-hidden="true">
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}

function DropwaveRail() {
  const workspace = useDropwaveWorkspace();
  const { isMobile, setOpenMobile } = useSidebar();
  if (!workspace) return null;
  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };
  const showPanel = (panel: WorkspacePanel) => {
    closeMobile();
    workspace.openPanel(panel);
  };

  return (
    <div data-dropwave-rail="">
      <div data-dropwave-brand="">
        <DropwaveMark />
        <span>Dropwave</span>
      </div>
      <div data-dropwave-projects="">
        <div data-dropwave-section-label="">
          <span>Projects</span>
          <button
            data-dropwave-icon-button=""
            type="button"
            aria-label="Add project"
            onClick={() => {
              closeMobile();
              openCommandPalette({ open: "add-project" });
            }}
          >
            <PlusIcon />
          </button>
        </div>
        <ul aria-label="Projects">
          {workspace.projects.map((project) => {
            const key = keyOfProject(project);
            return (
              <li key={key}>
                <button
                  data-dropwave-project=""
                  type="button"
                  aria-current={workspace.selectedProjectKey === key ? "true" : undefined}
                  onClick={() => {
                    closeMobile();
                    workspace.selectProject(project);
                  }}
                >
                  <ProjectMark name={project.title} />
                  <span>{project.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div data-dropwave-nav="">
        <button
          type="button"
          data-dropwave-nav-row=""
          onClick={() => showPanel({ kind: "team" })}
          disabled={!workspace.project}
        >
          <UsersRoundIcon /> Team
        </button>
        <button
          type="button"
          data-dropwave-nav-row=""
          onClick={() => showPanel({ kind: "activity" })}
        >
          <ActivityIcon /> Activity
        </button>
        <button type="button" data-dropwave-nav-row="" onClick={() => showPanel({ kind: "needs" })}>
          <InboxIcon /> Needs you
          {workspace.needs.length > 0 ? (
            <span data-dropwave-count="">{workspace.needs.length}</span>
          ) : null}
        </button>
      </div>
      <div data-dropwave-rail-footer="">
        <button
          type="button"
          data-dropwave-nav-row=""
          onClick={() => {
            closeMobile();
            workspace.showClassicSidebar();
          }}
        >
          <ListIcon /> All threads
        </button>
        <Link to="/settings/general" data-dropwave-nav-row="" onClick={closeMobile}>
          <Settings2Icon /> Settings
        </Link>
      </div>
    </div>
  );
}
