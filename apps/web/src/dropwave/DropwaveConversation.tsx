import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  AuthOrchestrationOperateScope,
  type DropwaveBotProfile,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { Link, Navigate } from "@tanstack/react-router";
import { T, msg, useGT, useMessages } from "gt-react";
import {
  ArrowUpRightIcon,
  BookmarkCheckIcon,
  FileTextIcon,
  ListChecksIcon,
  PlusIcon,
} from "lucide-react";

import { openCommandPalette } from "../commandPaletteBus";
import { ChildThreadApprovals } from "../components/chat/ChildThreadApprovals";
import { Button } from "../components/ui/button";
import { SidebarInset } from "../components/ui/sidebar";
import { useAllEnvironmentShellsBootstrapped } from "../state/entities";
import { useEnvironmentScope } from "../state/session";
import { buildThreadRouteParams } from "../threadRoutes";
import { BotAvatar } from "./BotAvatar";
import { workState, workStateLabel } from "./model";
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
            <BotAvatar size={36} />
          </div>
          <h1>{project?.title ?? <T>Start a project in Dropwave</T>}</h1>
          <p>
            {leadHidden ? (
              <T>This project’s Chief of Staff is hidden by your thread filters.</T>
            ) : project ? (
              <T>
                Set up one main bot for this project. It maps your core loop, coordinates workers
                and bots, and only interrupts you when a decision needs you.
              </T>
            ) : (
              <T>Add a project folder to launch your Chief of Staff and core loop.</T>
            )}
          </p>
          {leadHidden ? (
            <Button render={<Link to="/settings/threads" />}>
              <T>Thread settings</T>
            </Button>
          ) : project ? (
            <Button
              onClick={() =>
                workspace.openPanel({ kind: "profile", target: { kind: "new-lead", project } })
              }
            >
              <T>Set up Chief of Staff</T> <ArrowUpRightIcon />
            </Button>
          ) : (
            <Button onClick={() => openCommandPalette({ open: "add-project" })}>
              <PlusIcon /> <T>Add a project</T>
            </Button>
          )}
        </section>
      ) : (
        <p data-dropwave-loading="" role="status">
          <T>Loading projects…</T>
        </p>
      )}
    </SidebarInset>
  );
}

export function DropwaveConversationTools({ thread }: { thread: EnvironmentThreadShell | null }) {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const m = useMessages();
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
        <T>Set up Chief of Staff</T>
      </button>
    );
  }
  if (!bot || !thread) return null;
  const state = workState(thread);
  return (
    <div data-dropwave-conversation-tools="">
      {state === "ready" || state === "done" ? null : (
        <span data-dropwave-status="" data-dropwave-header-status="" data-status={state}>
          <span aria-hidden="true" />
          {m(workStateLabel[state])}
        </span>
      )}
      <button
        type="button"
        data-dropwave-header-button=""
        onClick={() => workspace.openPanel({ kind: "asks" })}
        aria-label={
          workspace.openAsksCount > 0
            ? gt("Tracked asks, {count} open", { count: workspace.openAsksCount })
            : gt("Tracked asks")
        }
      >
        <ListChecksIcon />
        <span>
          <T>Asks</T>
        </span>
        {workspace.openAsksCount > 0 ? (
          <span data-dropwave-work-count="">{workspace.openAsksCount}</span>
        ) : null}
      </button>
      <button
        type="button"
        data-dropwave-header-button=""
        data-dropwave-files-button=""
        aria-label={gt("Project docs and memory")}
        aria-pressed={workspace.mainView === "docs"}
        onClick={() => workspace.setMainView(workspace.mainView === "docs" ? "chat" : "docs")}
      >
        <FileTextIcon />
        <span>
          <T>Docs</T>
        </span>
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
  const gt = useGT();
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
          ? Math.max(0, projectIndex) % 6
          : 3 + (Math.max(0, teammateIndex) % 3)
      }
    />
  );
  return profile ? (
    <button
      type="button"
      data-dropwave-profile-button=""
      aria-label={gt("Bot and core loop settings")}
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
    label: msg("Design core loop"),
    prompt:
      "Let’s set up this project’s core loop together. Ask me what shipped means here, propose the loop steps and any bots we need, then save them with dropwave_team.",
  },
  {
    label: msg("Plan next work"),
    prompt:
      "Help me plan the next piece of work. Ask what outcome I want and track every ask so nothing gets missed.",
  },
  {
    label: msg("Dry-run loop"),
    prompt:
      "Dry-run our saved core loop on a sample task. Show who owns each step, what proof is required, and any missing rules. Keep it read-only.",
  },
];

const teammateStarters = [
  {
    label: msg("Check assigned work"),
    prompt:
      "Summarize the work currently assigned to you and what evidence you need to finish. Keep it read-only for now.",
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
  const gt = useGT();
  const m = useMessages();
  const options = profile.kind === "lead" ? leadStarters : teammateStarters;
  return (
    <section
      data-dropwave-conversation-start=""
      aria-label={gt("Start a conversation with {name}", { name: title })}
    >
      <div data-dropwave-hero-mark="">
        <BotAvatar size={36} seed={profile.kind === "lead" ? 0 : 3} />
      </div>
      <h1>{title}</h1>
      <p>
        {profile.brief ? (
          profile.brief
        ) : profile.kind === "lead" ? (
          <T>Dump ideas, decisions, or tasks. Everything is tracked through your core loop.</T>
        ) : (
          <T>Inspect or coordinate directly with this bot.</T>
        )}
      </p>
      <div data-dropwave-starters="">
        {options.map(({ label, prompt }) => (
          <button
            type="button"
            data-dropwave-header-button=""
            key={label}
            onClick={() => onUsePrompt(prompt)}
          >
            {m(label)} <ArrowUpRightIcon />
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
      variant="outline"
      size="sm"
      data-dropwave-always-rule=""
      onClick={() =>
        workspace.openPanel({
          kind: "profile",
          target: { kind: "edit", bot: lead, decision: question },
        })
      }
    >
      <BookmarkCheckIcon className="size-3.5" />
      <T>Always do this (save rule)</T>
    </Button>
  );
}

/**
 * Surfaces approvals from helper bots (like QA/SEO) and their child workers right inside the
 * Lead bot's chat so the owner never has to leave the main conversation to unblock the team.
 */
export function DropwaveProjectApprovals({
  activeThreadRef,
}: {
  activeThreadRef: ScopedThreadRef | null;
}) {
  const workspace = useDropwaveWorkspace();
  if (!workspace?.lead || !activeThreadRef) return null;
  if (
    workspace.lead.id !== activeThreadRef.threadId ||
    workspace.lead.environmentId !== activeThreadRef.environmentId
  ) {
    return null;
  }
  const helperRefs = workspace.bots
    .filter(
      (bot) =>
        bot.environmentId === workspace.lead!.environmentId &&
        bot.source.dropwaveBot?.kind === "teammate" &&
        bot.source.dropwaveBot.leadThreadId === workspace.lead!.id,
    )
    .map((bot) => scopeThreadRef(bot.environmentId, bot.id));

  if (helperRefs.length === 0) return null;
  return (
    <>
      {helperRefs.map((helperRef) => (
        <ChildThreadApprovals
          key={`${helperRef.environmentId}:${helperRef.threadId}`}
          threadRef={helperRef}
        />
      ))}
    </>
  );
}

export function useDropwaveAssistantAuthor(threadRef: ScopedThreadRef | null): string | null {
  const workspace = useDropwaveWorkspace();
  if (!workspace) return null;
  const match = threadRef
    ? workspace.bots.find(
        (bot) => bot.id === threadRef.threadId && bot.environmentId === threadRef.environmentId,
      )
    : workspace.activeBot;
  // oxlint-disable-next-line t3code/no-untranslated-copy -- product brand name
  return match?.title ?? workspace.lead?.title ?? "Dropwave";
}
