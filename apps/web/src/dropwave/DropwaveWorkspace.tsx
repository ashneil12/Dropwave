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
import { T, Var, useGT, useMessages } from "gt-react";
import { PlusIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { openCommandPalette } from "../commandPaletteBus";
import { AppSidebarLayout } from "../components/AppSidebarLayout";
import { SidebarInset, useSidebar } from "../components/ui/sidebar";
import { useComposerDraftStore } from "../composerDraftStore";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useMediaQuery } from "../hooks/useMediaQuery";
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
import { BotAvatar } from "./BotAvatar";
import { DropwaveDocsView } from "./DropwaveDocsView";
import { DropwaveDesktopActivity, DropwavePanels } from "./DropwavePanels";
import { DropwaveToolbar, useDropwaveAppearance } from "./DropwaveToolbar";
import {
  botOwner,
  formatShortAge,
  isCurrentWork,
  isWorkspaceBot,
  keyOfThread,
  needsOwner,
  newestWorkFirst,
  workFor,
  workState,
  workStateGlyph,
  workStateLabel,
} from "./model";
import {
  DropwaveModeContext,
  DropwaveWorkspaceContext,
  useDropwaveWorkspace,
  type DropwaveMainView,
  type WorkspacePanel,
} from "./workspaceContext";
import "./workspace.css";

const LAST_PROJECT_KEY = "dropwave:last-project";
const ProjectKey = Schema.NullOr(Schema.String);
const RAIL_VISIBLE_OLDER_LIMIT = 4;

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
  const [mainView, setMainView] = useState<DropwaveMainView>("chat");
  const [activityOpen, setActivityOpen] = useState(false);
  const [openAsksCount, setOpenAsksCount] = useState(0);
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

  const [asksRefreshNonce, setAsksRefreshNonce] = useState(0);
  const listAsksCmd = useAtomCommand(serverEnvironment.dropwaveAsksList, { reportFailure: false });
  const refreshOpenAsksCount = () => setAsksRefreshNonce((n) => n + 1);
  const activeUpdatedAt = activeThread?.updatedAt ?? null;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- syncs open ask count badge when project or active thread updates
  useEffect(() => {
    if (!project || asksRefreshNonce < 0) return;
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
  }, [activeUpdatedAt, asksRefreshNonce, listAsksCmd, project]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- syncs root attribute and dark class so header, composer, settings, and dialogs share Dropwave's dark glass theme
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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- retains the active bot's delegated session family for the Sessions rail
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
        openAsksCount: project ? openAsksCount : 0,
        refreshOpenAsksCount,
        selectProject: (chosen) => {
          setLastProject(keyOfProject(chosen));
          setPanel(null);
          setMainView("chat");
          const chosenLead = leadFor(chosen, roster);
          if (chosenLead && !hiddenKeys.has(keyOfThread(chosenLead))) {
            openThread(scopeThreadRef(chosenLead.environmentId, chosenLead.id));
          } else void navigate({ to: "/" });
        },
        openThread,
        openPanel: setPanel,
      }}
    >
      <DropwaveModeContext value={true}>
        <AppSidebarLayout
          workspaceSidebar={<DropwaveRail />}
          workspaceStyle={appearance.style}
          workspaceToolbar={
            <DropwaveToolbar
              appearance={appearance}
              activityOpen={inlineActivity ? activityOpen : panel?.kind === "activity"}
              toggleActivity={() => {
                if (inlineActivity) setActivityOpen(!activityOpen);
                else setPanel(panel?.kind === "activity" ? null : { kind: "activity" });
              }}
            />
          }
          workspacePanel={
            inlineActivity && activityOpen && !modalOpen ? (
              <DropwaveDesktopActivity onClose={() => setActivityOpen(false)} />
            ) : undefined
          }
        >
          {mainView === "docs" && !modalOpen && project ? (
            <SidebarInset>
              <DropwaveDocsView />
            </SidebarInset>
          ) : (
            children
          )}
        </AppSidebarLayout>
      </DropwaveModeContext>
      {!modalOpen && panel !== null ? (
        <DropwavePanels panel={panel} onClose={() => setPanel(null)} />
      ) : null}
    </DropwaveWorkspaceContext>
  );
}

function DropwaveRail() {
  const workspace = useDropwaveWorkspace();
  const { isMobile, setOpenMobile } = useSidebar();
  const gt = useGT();
  const m = useMessages();
  const [showOlder, setShowOlder] = useState(false);

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

  const sessionOwner = workspace.activeBot ?? workspace.lead;
  const botSessions = sessionOwner
    ? workFor(workspace.threads, scopeThreadRef(sessionOwner.environmentId, sessionOwner.id)).sort(
        newestWorkFirst,
      )
    : [];
  const activeSessions = botSessions.filter(isCurrentWork);
  const finishedSessions = botSessions.filter((session) => !isCurrentWork(session));
  const visibleFinished = showOlder
    ? finishedSessions
    : finishedSessions.slice(0, RAIL_VISIBLE_OLDER_LIMIT);
  const hiddenCount = Math.max(0, finishedSessions.length - RAIL_VISIBLE_OLDER_LIMIT);

  return (
    <div data-dropwave-rail="">
      <ul data-dropwave-projects="" aria-label={gt("Projects")}>
        {workspace.projects.map((project, index) => {
          const key = keyOfProject(project);
          const isCurrent =
            workspace.selectedProjectKey === key &&
            (workspace.activeBot === null || workspace.activeBot.id === workspace.lead?.id);
          return (
            <li key={key}>
              <button
                data-dropwave-project=""
                type="button"
                aria-current={isCurrent ? "true" : undefined}
                onClick={() => {
                  closeMobile();
                  workspace.selectProject(project);
                }}
              >
                <span data-dropwave-project-tile="">
                  <BotAvatar size={54} seed={index % 6} />
                  {workspace.needsProject(project) ? (
                    <span data-dropwave-project-needs="" aria-label={gt("Needs you")} />
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
            aria-label={gt("Add project")}
            onClick={() => {
              closeMobile();
              openCommandPalette({ open: "add-project" });
            }}
          >
            <PlusIcon />
          </button>
        </li>
      </ul>

      <div data-dropwave-rail-scroll="">
        {workspace.project ? (
          <section data-dropwave-team-rail="" aria-label={gt("Helper bots")}>
            <div data-dropwave-rail-section-head="">
              <button
                data-dropwave-team-heading=""
                type="button"
                onClick={() => {
                  closeMobile();
                  workspace.openPanel({ kind: "team" });
                }}
              >
                <T>Team</T> <span aria-hidden="true">›</span>
              </button>
              {workspace.lead ? (
                <button
                  type="button"
                  data-dropwave-icon-button=""
                  aria-label={gt("Add helper bot")}
                  onClick={() => {
                    closeMobile();
                    workspace.openPanel({
                      kind: "profile",
                      target: {
                        kind: "new-teammate",
                        project: workspace.project!,
                        lead: workspace.lead!,
                      },
                    });
                  }}
                >
                  <PlusIcon />
                </button>
              ) : null}
            </div>
            {teammates.length > 0 ? (
              <ul>
                {teammates.map((bot, index) => {
                  const helperWork = workFor(
                    workspace.threads,
                    scopeThreadRef(bot.environmentId, bot.id),
                  ).filter(isCurrentWork);
                  const state = workState(bot);
                  const statusSub =
                    helperWork.length > 0
                      ? gt(
                          "{count, plural, one {Running 1 session} other {Running {count} sessions}}",
                          {
                            count: helperWork.length,
                          },
                        )
                      : bot.source.dropwaveBot?.kind === "teammate" && bot.source.dropwaveBot.role
                        ? `${m(workStateLabel[state])} · ${bot.source.dropwaveBot.role}`
                        : m(workStateLabel[state]);
                  return (
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
                          <small data-status={state}>{statusSub}</small>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p data-dropwave-rail-hint="">
                <T>Solo loop. Add a helper like QA or SEO anytime.</T>
              </p>
            )}
          </section>
        ) : null}

        {sessionOwner ? (
          <section data-dropwave-sessions-rail="" aria-label={gt("Sessions")}>
            <div data-dropwave-rail-section-head="">
              <span data-dropwave-rail-label="">
                <T>Sessions</T>
              </span>
              <span data-dropwave-rail-num="">{botSessions.length}</span>
            </div>

            {activeSessions.length > 0 ? (
              <div data-dropwave-session-group="">
                <span data-dropwave-session-group-label="">
                  <T>Active</T>
                </span>
                <ul>
                  {activeSessions.map((session) => (
                    <RailSessionRow
                      key={keyOfThread(session)}
                      session={session}
                      current={workspace.activeThread?.id === session.id}
                      onOpen={() => {
                        closeMobile();
                        workspace.openThread(scopeThreadRef(session.environmentId, session.id));
                      }}
                    />
                  ))}
                </ul>
              </div>
            ) : null}

            {visibleFinished.length > 0 ? (
              <div data-dropwave-session-group="">
                {activeSessions.length > 0 ? (
                  <span data-dropwave-session-group-label="">
                    <T>Recent</T>
                  </span>
                ) : null}
                <ul>
                  {visibleFinished.map((session) => (
                    <RailSessionRow
                      key={keyOfThread(session)}
                      session={session}
                      current={workspace.activeThread?.id === session.id}
                      onOpen={() => {
                        closeMobile();
                        workspace.openThread(scopeThreadRef(session.environmentId, session.id));
                      }}
                    />
                  ))}
                </ul>
                {hiddenCount > 0 ? (
                  <button
                    type="button"
                    data-dropwave-show-more=""
                    onClick={() => setShowOlder(!showOlder)}
                  >
                    {showOlder ? (
                      <T>Show less</T>
                    ) : (
                      <T>
                        Show <Var>{hiddenCount}</Var> older
                      </T>
                    )}
                  </button>
                ) : null}
              </div>
            ) : activeSessions.length === 0 ? (
              <p data-dropwave-rail-hint="">
                <T>Sessions spawned by this bot appear here automatically.</T>
              </p>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function RailSessionRow({
  session,
  current,
  onOpen,
}: {
  session: EnvironmentThreadShell;
  current: boolean;
  onOpen: () => void;
}) {
  const m = useMessages();
  const state = workState(session);
  const pr = session.pullRequests[0] ?? session.linkedPullRequest;
  return (
    <li>
      <button
        type="button"
        data-dropwave-session-row=""
        data-status={state}
        aria-current={current ? "true" : undefined}
        onClick={onOpen}
      >
        <div data-dropwave-session-top="">
          <span data-dropwave-session-glyph="" data-status={state} aria-hidden="true">
            {workStateGlyph[state]}
          </span>
          <span data-dropwave-session-title="">{session.title}</span>
          {pr ? <span data-dropwave-pr-chip="">#{pr.number}</span> : null}
        </div>
        <div data-dropwave-session-sub="">
          <span data-dropwave-session-state="" data-status={state}>
            {m(workStateLabel[state])}
          </span>
          <span>· {formatShortAge(session.updatedAt)}</span>
        </div>
      </button>
    </li>
  );
}
