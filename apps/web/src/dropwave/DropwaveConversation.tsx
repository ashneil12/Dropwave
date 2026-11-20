import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  AuthOrchestrationOperateScope,
  type DropwaveBotProfile,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { Link, Navigate } from "@tanstack/react-router";
import { ArrowUpRightIcon, FileTextIcon, ListTodoIcon, PlusIcon } from "lucide-react";

import { openCommandPalette } from "../commandPaletteBus";
import { Button } from "../components/ui/button";
import { SidebarInset } from "../components/ui/sidebar";
import { useEnvironmentScope } from "../state/session";
import { useAllEnvironmentShellsBootstrapped } from "../state/entities";
import { buildThreadRouteParams } from "../threadRoutes";
import { BotAvatar } from "./BotAvatar";
import { isCurrentWork, workFor, workState, workStateLabel } from "./model";
import { useDropwaveWorkspace } from "./workspaceContext";

export function DropwaveIndex() {
  const workspace = useDropwaveWorkspace();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  if (!workspace) return null;
  const { project, lead, leadHidden } = workspace;
  if (lead && !leadHidden) {
    return (
      <Navigate
        to="/$environmentId/$threadId"
        params={buildThreadRouteParams(scopeThreadRef(lead.environmentId, lead.id))}
        replace
      />
    );
  }
  return (
    <SidebarInset>
      {bootstrapped || project ? (
        <section data-dropwave-landing="">
          <div data-dropwave-hero-mark="">
            <BotAvatar size={35} />
          </div>
          <h1>{project?.title ?? "Give your project a lead"}</h1>
          <p>
            {leadHidden
              ? "This project’s lead is hidden by your thread filters."
              : project
                ? "Set up a single place to plan the work and coordinate your team."
                : "Add a project folder to start a conversation with your lead bot."}
          </p>
          {leadHidden ? (
            <Button render={<Link to="/settings/threads" />}>Thread settings</Button>
          ) : project ? (
            <Button
              onClick={() =>
                workspace.openPanel({ kind: "profile", target: { kind: "new-lead", project } })
              }
            >
              Create a lead <ArrowUpRightIcon />
            </Button>
          ) : (
            <Button onClick={() => openCommandPalette({ open: "add-project" })}>
              <PlusIcon /> Add a project
            </Button>
          )}
        </section>
      ) : (
        <p data-dropwave-loading="" role="status">
          Loading projects…
        </p>
      )}
    </SidebarInset>
  );
}

export function DropwaveConversationTools({
  thread,
  onOpenFiles,
}: {
  thread: EnvironmentThreadShell | null;
  onOpenFiles: () => void;
}) {
  const workspace = useDropwaveWorkspace();
  if (!workspace) return null;
  const bot = workspace.activeBot;
  const project = workspace.project;
  if (!bot && project && !workspace.lead) {
    return (
      <button
        data-dropwave-header-button=""
        type="button"
        onClick={() =>
          workspace.openPanel({ kind: "profile", target: { kind: "new-lead", project } })
        }
      >
        Create lead
      </button>
    );
  }
  if (!bot || !thread) return null;
  const owner = scopeThreadRef(bot.environmentId, bot.id);
  const current = workFor(workspace.threads, owner).filter(isCurrentWork).length;
  const state = workState(thread);
  return (
    <div data-dropwave-conversation-tools="">
      {state === "ready" || state === "done" ? null : (
        <span data-dropwave-status="" data-dropwave-header-status="" data-status={state}>
          <span aria-hidden="true" />
          {workStateLabel[state]}
        </span>
      )}
      <button
        type="button"
        data-dropwave-header-button=""
        onClick={() => workspace.openPanel({ kind: "work", owner })}
        aria-label={current > 0 ? `Work, ${current} active` : "Work"}
      >
        <ListTodoIcon />
        <span>Work</span>
        {current > 0 ? <span data-dropwave-work-count="">{current}</span> : null}
      </button>
      <button
        type="button"
        data-dropwave-header-button=""
        data-dropwave-files-button=""
        aria-label="Project files"
        onClick={onOpenFiles}
      >
        <FileTextIcon />
        <span>Docs</span>
      </button>
    </div>
  );
}

export function DropwaveChatAvatar({
  size,
  threadRef,
  profile = false,
}: { size?: number; threadRef?: ScopedThreadRef | null; profile?: boolean } = {}) {
  const workspace = useDropwaveWorkspace();
  const bot = workspace?.activeBot;
  const project = workspace?.project;
  if (
    !bot ||
    !project ||
    (threadRef && (bot.id !== threadRef.threadId || bot.environmentId !== threadRef.environmentId))
  )
    return null;
  const projectIndex = workspace.projects.indexOf(project);
  const teammateIndex = workspace.bots
    .filter(
      (thread) =>
        thread.environmentId === bot.environmentId &&
        thread.source.dropwaveBot?.kind === "teammate" &&
        thread.source.dropwaveBot.leadThreadId === workspace.lead?.id,
    )
    .indexOf(bot);
  const avatar = (
    <BotAvatar
      {...(size === undefined ? {} : { size })}
      seed={
        bot.source.dropwaveBot?.kind === "lead"
          ? Math.max(0, projectIndex) % 3
          : 3 + (Math.max(0, teammateIndex) % 3)
      }
    />
  );
  return profile ? (
    <button
      type="button"
      data-dropwave-profile-button=""
      aria-label="Bot profile"
      onClick={() => workspace.openPanel({ kind: "profile", target: { kind: "edit", bot } })}
    >
      {avatar}
    </button>
  ) : (
    avatar
  );
}

const leadStarters = [
  {
    label: "Plan work",
    prompt: "Help me plan the next piece of work. Start by asking what outcome I’m looking for.",
  },
  {
    label: "Dry-run workflow",
    prompt:
      "Use a hypothetical task to dry-run our saved workflow. Show who owns each step, what evidence it needs, and any missing decisions. Keep the dry run read-only. Do not start workers or make changes.",
  },
];
const teammateStarters = [
  {
    label: "Check assigned work",
    prompt:
      "Summarize the work assigned to you and tell me what you need to start. Keep it read-only for now.",
  },
];

export function DropwaveConversationStart({
  title,
  profile,
  onUsePrompt,
}: {
  title: string;
  profile: DropwaveBotProfile;
  onUsePrompt: (prompt: string) => void;
}) {
  const options = profile.kind === "lead" ? leadStarters : teammateStarters;
  const caption =
    profile.brief ||
    (profile.kind === "lead"
      ? "Bring an idea, a decision, or a piece of work."
      : "Ask about this teammate’s work.");
  return (
    <section data-dropwave-conversation-start="" aria-label={`Start a conversation with ${title}`}>
      <div data-dropwave-hero-mark="">
        <BotAvatar size={35} seed={profile.kind === "lead" ? 0 : 3} />
      </div>
      <h1>{title}</h1>
      <p>{caption}</p>
      <div data-dropwave-starters="">
        {options.map(({ label, prompt }) => (
          <button
            type="button"
            data-dropwave-header-button=""
            key={label}
            onClick={() => onUsePrompt(prompt)}
          >
            {label} <ArrowUpRightIcon />
          </button>
        ))}
      </div>
    </section>
  );
}

export function DropwaveDecisionRule({
  threadRef,
  question,
}: {
  threadRef: ScopedThreadRef;
  question: string;
}) {
  const workspace = useDropwaveWorkspace();
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const lead = workspace?.lead;
  if (
    !workspace ||
    !lead ||
    !canOperate ||
    lead.id !== threadRef.threadId ||
    lead.environmentId !== threadRef.environmentId ||
    lead.source.pendingRuntimeRequest?.userOnly === true
  )
    return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() =>
        workspace.openPanel({
          kind: "profile",
          target: { kind: "edit", bot: lead, decision: question },
        })
      }
    >
      Save a standing rule
    </Button>
  );
}
