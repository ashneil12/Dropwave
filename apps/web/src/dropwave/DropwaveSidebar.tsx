import { scopedProjectKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import * as Schema from "effect/Schema";
import { T, Var, useGT, useMessages } from "gt-react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ImageIcon,
  PanelLeftCloseIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  UploadIcon,
} from "lucide-react";
import { useState } from "react";

import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { DropwaveBotAvatar, type BotAvatarStatus } from "./DropwaveBotAvatar";
import type { useDropwaveAppearance } from "./DropwaveToolbar";
import {
  formatShortAge,
  isCurrentWork,
  keyOfThread,
  newestWorkFirst,
  workFor,
  workState,
  workStateLabel,
} from "./model";
import { useDropwaveWorkspace } from "./workspaceContext";

const PinnedProjectsSchema = Schema.Array(Schema.String);
const WALLPAPER_PRESETS = [
  { key: "mountains", file: "mountains.jpg" },
  { key: "ocean", file: "ocean.jpg" },
  { key: "abstract", file: "abstract.jpg" },
  { key: "sunrise", file: "sunrise.jpg" },
  { key: "dusk", file: "dusk.png" },
] as const;

function keyOfProject(project: EnvironmentProject) {
  return scopedProjectKey({ environmentId: project.environmentId, projectId: project.id });
}

function avatarStatusFor(thread: EnvironmentThreadShell | null): BotAvatarStatus {
  if (!thread) return "none";
  const st = workState(thread);
  if (st === "needs-you" || st === "failed") return "needs-you";
  if (st === "working") return "working";
  if (st === "waiting") return "waiting";
  return "idle";
}

function roleForBot(bot: EnvironmentThreadShell): "lead" | "qa" | "growth" | "specialist" {
  const profile = bot.source.dropwaveBot;
  if (profile?.kind === "lead") return "lead";
  const text =
    `${bot.title} ${profile?.kind === "teammate" ? (profile.role ?? "") : ""}`.toLowerCase();
  if (text.includes("qa") || text.includes("test") || text.includes("verif")) return "qa";
  if (text.includes("seo") || text.includes("growth") || text.includes("market")) return "growth";
  return "specialist";
}

export function DropwaveSidebar({
  appearance,
  onCollapse,
}: {
  appearance: ReturnType<typeof useDropwaveAppearance>;
  onCollapse: () => void;
}) {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const m = useMessages();
  const [pinnedKeys, setPinnedKeys] = useLocalStorage(
    "dropwave:pinned-projects",
    [],
    PinnedProjectsSchema,
  );
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");

  if (!workspace) return null;

  const pinnedSet = new Set(pinnedKeys);

  // Pinned projects always show as bot-face tiles at top; if none pinned yet, show up to 3 projects including active
  const tileProjects: Array<EnvironmentProject> = [];
  if (pinnedKeys.length > 0) {
    for (const proj of workspace.projects) {
      if (pinnedSet.has(keyOfProject(proj))) tileProjects.push(proj);
    }
    if (
      workspace.project &&
      !tileProjects.some((p) => keyOfProject(p) === keyOfProject(workspace.project!))
    ) {
      tileProjects.unshift(workspace.project);
    }
  } else {
    tileProjects.push(...workspace.projects.slice(0, 3));
  }

  const togglePin = (projKey: string) => {
    if (pinnedSet.has(projKey)) {
      setPinnedKeys(pinnedKeys.filter((k) => k !== projKey));
    } else {
      setPinnedKeys([...pinnedKeys, projKey]);
    }
  };

  const leadForProject = (proj: EnvironmentProject) =>
    workspace.bots.find(
      (b) =>
        b.projectId === proj.id &&
        b.environmentId === proj.environmentId &&
        b.source.dropwaveBot?.kind === "lead",
    ) ?? null;

  const helpers = workspace.lead
    ? workspace.bots.filter(
        (bot) =>
          bot.environmentId === workspace.lead!.environmentId &&
          bot.source.dropwaveBot?.kind === "teammate" &&
          bot.source.dropwaveBot.leadThreadId === workspace.lead!.id,
      )
    : [];

  const sessionOwner = workspace.activeBot ?? workspace.lead;
  const allSessions = sessionOwner
    ? workFor(workspace.threads, scopeThreadRef(sessionOwner.environmentId, sessionOwner.id)).sort(
        newestWorkFirst,
      )
    : [];
  const activeSessions = allSessions.filter((s) => isCurrentWork(s) || workState(s) === "failed");
  const recentSessions = allSessions.filter((s) => !isCurrentWork(s) && workState(s) !== "failed");

  const searchLower = projectSearch.trim().toLowerCase();
  const filteredProjects = workspace.projects.filter(
    (p) => !searchLower || p.title.toLowerCase().includes(searchLower),
  );

  return (
    <aside data-dw-rail="" aria-label={gt("Workspace sidebar")}>
      {/* Brand + quiet top utilities */}
      <div data-dw-rail-brand="">
        <div data-dw-brand-mark="">
          <span data-dw-brand-dot="" />
          {/* oxlint-disable-next-line t3code/no-untranslated-copy -- product brand name */}
          <strong>Dropwave</strong>
        </div>
        <div data-dw-rail-top-actions="">
          <Popover>
            <PopoverTrigger
              type="button"
              data-dw-rail-icon=""
              aria-label={gt("Wallpaper and glass")}
            >
              <ImageIcon className="size-3.5" />
            </PopoverTrigger>
            <PopoverPopup
              width="md"
              align="start"
              data-dropwave-popover=""
              aria-label={gt("Wallpaper and glass")}
            >
              <div data-dropwave-appearance="">
                <span>
                  <T>Wallpaper</T>
                </span>
                <div data-dropwave-wallpapers="" role="group" aria-label={gt("Wallpapers")}>
                  {WALLPAPER_PRESETS.map((wall) => (
                    <button
                      key={wall.key}
                      type="button"
                      aria-label={wall.key}
                      aria-pressed={appearance.wallpaper === wall.key}
                      onClick={() => appearance.setWallpaper(wall.key)}
                    >
                      <img src={`/dropwave/${wall.file}`} alt="" />
                    </button>
                  ))}
                </div>
                <label data-dropwave-upload-wall="">
                  <UploadIcon />
                  <span>
                    <T>Use your own image</T>
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        appearance.setCustomWallpaper(String(reader.result));
                        appearance.setWallpaper("custom");
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
                <label>
                  <T>Glass strength</T>
                  <input
                    type="range"
                    min={0.4}
                    max={1.6}
                    step={0.05}
                    value={appearance.strength}
                    onChange={(event) => appearance.setStrength(event.currentTarget.valueAsNumber)}
                  />
                </label>
              </div>
            </PopoverPopup>
          </Popover>

          <button
            type="button"
            data-dw-rail-icon=""
            aria-label={gt("Hide sidebar")}
            onClick={onCollapse}
          >
            <PanelLeftCloseIcon className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Section 1: Pinned Bot-Face Project Squircles + Auto-Collapsing Project Drawer */}
      <div data-dw-rail-section="">
        <div data-dw-rail-head="">
          <button
            type="button"
            data-dw-rail-collapse-btn=""
            aria-expanded={projectsExpanded}
            onClick={() => setProjectsExpanded((open) => !open)}
          >
            <span>
              <T>Projects</T>
            </span>
            {projectsExpanded ? (
              <ChevronDownIcon className="size-3 opacity-60" />
            ) : (
              <ChevronRightIcon className="size-3 opacity-60" />
            )}
          </button>
          <span data-dw-rail-count="">
            {tileProjects.length} / {workspace.projects.length}
          </span>
        </div>

        {/* Pinned / active bot-face squircle tiles */}
        <div data-dw-venture-tiles="">
          {tileProjects.slice(0, 3).map((proj) => {
            const pKey = keyOfProject(proj);
            const active = workspace.project !== null && keyOfProject(workspace.project) === pKey;
            const projLead = leadForProject(proj);
            const urgent = workspace.needsProject(proj);
            return (
              <button
                key={pKey}
                type="button"
                data-dw-venture-tile=""
                aria-current={active ? "true" : undefined}
                aria-label={proj.title}
                onClick={() => {
                  setProjectsExpanded(false);
                  workspace.selectProject(proj);
                }}
              >
                <DropwaveBotAvatar
                  name={projLead?.title ?? proj.title}
                  seed={projLead?.source.dropwaveBot?.avatarSeed}
                  role="lead"
                  size="lg"
                  status={urgent ? "needs-you" : "none"}
                />
                <span data-dw-tile-caption="">{proj.title}</span>
              </button>
            );
          })}

          <button
            type="button"
            data-dw-venture-tile="add"
            aria-label={gt("New project setup")}
            onClick={() => {
              setProjectsExpanded(false);
              workspace.setMainView("setup");
            }}
          >
            <PlusIcon className="size-4 opacity-70" />
            <span data-dw-tile-caption="">
              <T>New</T>
            </span>
          </button>
        </div>

        {/* Auto-collapsing All Projects list with Pin toggles */}
        {projectsExpanded ? (
          <div data-dw-project-drawer="">
            {workspace.projects.length > 4 ? (
              <label data-dw-switcher-search="">
                <SearchIcon className="size-3" />
                <input
                  value={projectSearch}
                  onChange={(e) => setProjectSearch(e.currentTarget.value)}
                  placeholder={gt("Find project…")}
                  aria-label={gt("Find project")}
                />
              </label>
            ) : null}
            <div data-dw-project-drawer-list="">
              {filteredProjects.map((proj) => {
                const pKey = keyOfProject(proj);
                const active =
                  workspace.project !== null && keyOfProject(workspace.project) === pKey;
                const pinned = pinnedSet.has(pKey);
                return (
                  <div
                    key={pKey}
                    data-dw-project-drawer-row=""
                    data-active={active ? "true" : undefined}
                  >
                    <button
                      type="button"
                      data-dw-project-drawer-pick=""
                      onClick={() => {
                        workspace.selectProject(proj);
                        setProjectsExpanded(false);
                      }}
                    >
                      <span
                        data-dw-dot={
                          workspace.needsProject(proj) ? "coral" : active ? "emerald" : "dim"
                        }
                      />
                      <span>{proj.title}</span>
                    </button>
                    <button
                      type="button"
                      data-dw-pin-btn=""
                      aria-label={pinned ? gt("Unpin project") : gt("Pin project to top")}
                      aria-pressed={pinned}
                      onClick={() => togglePin(pKey)}
                    >
                      {pinned ? <PinOffIcon className="size-3" /> : <PinIcon className="size-3" />}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {/* Section 2: Team (Lead + Specialists with expressive bot faces!) */}
      <div data-dw-rail-section="">
        <div data-dw-rail-head="">
          <span>
            <T>Team</T>
          </span>
          {workspace.lead && workspace.project ? (
            <button
              type="button"
              data-dw-rail-plus=""
              aria-label={gt("Add specialist bot")}
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
              <PlusIcon className="size-3" />
            </button>
          ) : null}
        </div>

        <div data-dw-team-list="">
          {workspace.lead ? (
            <>
              <button
                type="button"
                data-dw-team-row=""
                aria-current={workspace.activeBot?.id === workspace.lead.id ? "true" : undefined}
                onClick={() =>
                  workspace.openThread(
                    scopeThreadRef(workspace.lead!.environmentId, workspace.lead!.id),
                  )
                }
              >
                <DropwaveBotAvatar
                  name={workspace.lead.title}
                  seed={workspace.lead.source.dropwaveBot?.avatarSeed}
                  role="lead"
                  size="md"
                  status={avatarStatusFor(workspace.lead)}
                />
                <span data-dw-team-meta="">
                  <span data-dw-team-top="">
                    <strong>{workspace.lead.title}</strong>
                    <span data-dw-team-state="lead">
                      <T>Lead</T>
                    </span>
                  </span>
                  <small>
                    {workspace.lead.source.dropwaveBot?.brief || gt("Owns the core loop")}
                  </small>
                </span>
              </button>

              {helpers.map((bot) => {
                const state = workState(bot);
                return (
                  <button
                    key={keyOfThread(bot)}
                    type="button"
                    data-dw-team-row=""
                    aria-current={workspace.activeBot?.id === bot.id ? "true" : undefined}
                    onClick={() => workspace.openThread(scopeThreadRef(bot.environmentId, bot.id))}
                  >
                    <DropwaveBotAvatar
                      name={bot.title}
                      seed={bot.source.dropwaveBot?.avatarSeed}
                      role={roleForBot(bot)}
                      size="md"
                      status={avatarStatusFor(bot)}
                    />
                    <span data-dw-team-meta="">
                      <span data-dw-team-top="">
                        <strong>{bot.title}</strong>
                        <span
                          data-dw-team-state={
                            state === "working"
                              ? "working"
                              : state === "needs-you" || state === "failed"
                                ? "urgent"
                                : "idle"
                          }
                        >
                          {m(workStateLabel[state])}
                        </span>
                      </span>
                      <small>
                        {bot.source.dropwaveBot?.kind === "teammate" && bot.source.dropwaveBot.role
                          ? bot.source.dropwaveBot.role
                          : bot.source.dropwaveBot?.brief || gt("Specialist bot")}
                      </small>
                    </span>
                  </button>
                );
              })}
            </>
          ) : (
            <button
              type="button"
              data-dw-setup-cta=""
              onClick={() => workspace.setMainView("setup")}
            >
              <PlusIcon className="size-3.5" />
              <T>Set up Chief of Staff</T>
            </button>
          )}
        </div>
      </div>

      {/* Section 3: Sessions (DevinBot-style clean grouped list — Active & Recent) */}
      <div data-dw-rail-sessions="">
        {activeSessions.length > 0 ? (
          <div data-dw-session-group="">
            <div data-dw-rail-head="">
              <span>
                <T>Active runs</T>
              </span>
              <span data-dw-rail-count="">
                <T>
                  <Var>{activeSessions.length}</Var> runs
                </T>
              </span>
            </div>
            <div data-dw-session-rows="">
              {activeSessions.slice(0, 5).map((session) => {
                const state = workState(session);
                const urgent = state === "needs-you" || state === "failed";
                const tag = session.linkedPullRequest
                  ? `#${session.linkedPullRequest.number}`
                  : session.branch
                    ? session.branch.slice(0, 10)
                    : gt("run");
                return (
                  <button
                    key={keyOfThread(session)}
                    type="button"
                    data-dw-srow={urgent ? "urgent" : "active"}
                    aria-current={workspace.activeThread?.id === session.id ? "true" : undefined}
                    onClick={() =>
                      workspace.openThread(scopeThreadRef(session.environmentId, session.id))
                    }
                  >
                    <span
                      data-dw-dot={urgent ? "amber" : state === "working" ? "emerald" : "amber"}
                    />
                    <span data-dw-stag={urgent ? "amber" : "emerald"}>{tag}</span>
                    <span data-dw-slabel="">{session.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div data-dw-session-group="">
          <div data-dw-rail-head="">
            <span>
              <T>Sessions</T>
            </span>
            <span data-dw-rail-count="">{recentSessions.length}</span>
          </div>
          {recentSessions.length > 0 ? (
            <div data-dw-session-rows="">
              {recentSessions.slice(0, 6).map((session) => {
                const tag = session.linkedPullRequest
                  ? `#${session.linkedPullRequest.number}`
                  : formatShortAge(session.updatedAt);
                return (
                  <button
                    key={keyOfThread(session)}
                    type="button"
                    data-dw-srow="done"
                    aria-current={workspace.activeThread?.id === session.id ? "true" : undefined}
                    onClick={() =>
                      workspace.openThread(scopeThreadRef(session.environmentId, session.id))
                    }
                  >
                    <span data-dw-dot="dim" />
                    <span data-dw-stag="dim">{tag}</span>
                    <span data-dw-slabel="">{session.title}</span>
                  </button>
                );
              })}
            </div>
          ) : activeSessions.length === 0 ? (
            <p data-dw-rail-empty="">
              <T>Delegated worktree runs appear here live.</T>
            </p>
          ) : null}
        </div>
      </div>

      {/* Clean minimal footer — Settings only (no bottom Asks clutter!) */}
      <footer data-dw-rail-foot="">
        <button type="button" data-dw-rail-foot-btn="" onClick={() => workspace.openSettings()}>
          <SettingsIcon className="size-3.5" />
          <T>Settings</T>
        </button>
      </footer>
    </aside>
  );
}
