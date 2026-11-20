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
import { ListIcon, PlusIcon } from "lucide-react";
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
import { DropwaveDesktopActivity, DropwavePanels } from "./DropwavePanels";
import { DropwaveToolbar, useDropwaveAppearance } from "./DropwaveToolbar";
import { BotAvatar } from "./BotAvatar";
import { useMediaQuery } from "../hooks/useMediaQuery";
import {
  botOwner,
  isWorkspaceBot,
  keyOfThread,
  needsOwner,
  newestWorkFirst,
  workState,
  workStateLabel,
} from "./model";
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
  const [activityOpen, setActivityOpen] = useState(false);
  const inlineActivity = useMediaQuery("lg");
  const appearance = useDropwaveAppearance();
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
              needsProject: (project) =>
                needs.some((thread) => {
                  const owner = botOwner(byKey, thread);
                  return owner !== null && projectIncludes(project, owner);
                }),
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
            : {
                workspaceSidebar: <DropwaveRail />,
                workspaceStyle: appearance.style,
                workspaceToolbar: (
                  <DropwaveToolbar
                    appearance={appearance}
                    activityOpen={inlineActivity ? activityOpen : panel?.kind === "activity"}
                    toggleActivity={() => {
                      if (inlineActivity) setActivityOpen(!activityOpen);
                      else setPanel(panel?.kind === "activity" ? null : { kind: "activity" });
                    }}
                  />
                ),
                workspacePanel:
                  inlineActivity && activityOpen && !modalOpen ? (
                    <DropwaveDesktopActivity onClose={() => setActivityOpen(false)} />
                  ) : undefined,
              })}
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

function DropwaveRail() {
  const workspace = useDropwaveWorkspace();
  const { isMobile, setOpenMobile } = useSidebar();
  if (!workspace) return null;
  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };
  const teammates = workspace.bots.filter(
    (bot) =>
      bot.environmentId === workspace.lead?.environmentId &&
      bot.source.dropwaveBot?.kind === "teammate" &&
      bot.source.dropwaveBot.leadThreadId === workspace.lead.id,
  );

  return (
    <div data-dropwave-rail="">
      <ul data-dropwave-projects="" aria-label="Projects">
        {workspace.projects.map((project, index) => {
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
                <span data-dropwave-project-tile="">
                  <BotAvatar size={54} seed={index % 3} />
                  {workspace.needsProject(project) ? (
                    <span data-dropwave-project-needs="" aria-label="Needs you" />
                  ) : null}
                </span>
                <span data-dropwave-project-caption="">{project.title}</span>
              </button>
            </li>
          );
        })}
        <li>
          <button
            data-dropwave-add-project=""
            type="button"
            aria-label="Add project"
            onClick={() => {
              closeMobile();
              openCommandPalette({ open: "add-project" });
            }}
          >
            <PlusIcon />
          </button>
        </li>
      </ul>
      {workspace.project ? (
        <section data-dropwave-team-rail="" aria-label="Project team">
          <button
            data-dropwave-team-heading=""
            type="button"
            onClick={() => {
              closeMobile();
              workspace.openPanel({ kind: "team" });
            }}
          >
            Team <span aria-hidden="true">›</span>
          </button>
          <ul>
            {teammates.map((bot, index) => (
              <li key={keyOfThread(bot)}>
                <button
                  data-dropwave-teammate=""
                  type="button"
                  aria-current={workspace.activeBot?.id === bot.id ? "true" : undefined}
                  onClick={() => {
                    closeMobile();
                    workspace.openThread(scopeThreadRef(bot.environmentId, bot.id));
                  }}
                >
                  <BotAvatar size={30} seed={3 + (index % 3)} />
                  <span>
                    <strong>{bot.title}</strong>
                    <small>{workStateLabel[workState(bot)]}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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
      </div>
    </div>
  );
}
