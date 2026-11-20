import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { T, Var, useGT, useMessages } from "gt-react";
import {
  ActivityIcon,
  ArrowUpRightIcon,
  CheckIcon,
  ListChecksIcon,
  ListTodoIcon,
  PlusIcon,
} from "lucide-react";
import { useEffect } from "react";

import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import { Button } from "../components/ui/button";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "../components/ui/sheet";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useEnvironmentScope } from "../state/session";
import { threadFamilies } from "../state/threads";
import { DropwaveAsksPanel } from "./DropwaveAsksPanel";
import { DropwaveBotEditor } from "./DropwaveBotEditor";
import {
  attentionFirst,
  botOwner,
  formatShortAge,
  isCurrentWork,
  keyOfThread,
  newestWorkFirst,
  threadParentKey,
  workFor,
  workState,
  workStateLabel,
} from "./model";
import { useDropwaveWorkspace, type WorkspacePanel } from "./workspaceContext";

function Status({ thread }: { thread: EnvironmentThreadShell }) {
  const m = useMessages();
  const state = workState(thread);
  return (
    <span data-dropwave-status="" data-status={state}>
      <span aria-hidden="true" />
      {m(workStateLabel[state])}
    </span>
  );
}

function Row({
  thread,
  onOpen,
  showAge = false,
  children,
}: {
  thread: EnvironmentThreadShell;
  onOpen: () => void;
  showAge?: boolean;
  children?: React.ReactNode;
}) {
  const gt = useGT();
  const profile = threadParentKey(thread) === null ? thread.source.dropwaveBot : undefined;
  const pullRequest = thread.pullRequests[0] ?? thread.linkedPullRequest;
  return (
    <li data-dropwave-row="">
      <button type="button" data-dropwave-row-main="" onClick={onOpen}>
        <span data-dropwave-row-title="">{thread.title}</span>
        {profile?.brief ? <span data-dropwave-row-subtitle="">{profile.brief}</span> : null}
      </button>
      <Status thread={thread} />
      {showAge ? <span data-dropwave-row-age="">{formatShortAge(thread.updatedAt)}</span> : null}
      {pullRequest ? (
        <a
          data-dropwave-pr=""
          href={pullRequest.url}
          target="_blank"
          rel="noreferrer"
          aria-label={gt("Pull request {number}", { number: pullRequest.number })}
        >
          <PullRequestGlyph.pullRequest /> #{pullRequest.number}
          <ArrowUpRightIcon />
        </a>
      ) : null}
      {children}
    </li>
  );
}

function WorkList({
  threads,
  onOpenThread,
  orderByAttention = false,
  preferLead = false,
}: {
  threads: ReadonlyArray<EnvironmentThreadShell>;
  onOpenThread?: () => void;
  orderByAttention?: boolean;
  preferLead?: boolean;
}) {
  const workspace = useDropwaveWorkspace();
  if (!workspace) return null;
  const sorted = [...threads].sort(orderByAttention ? attentionFirst : newestWorkFirst);
  return (
    <ul data-dropwave-list="">
      {sorted.map((thread) => (
        <Row
          key={keyOfThread(thread)}
          thread={thread}
          showAge={orderByAttention}
          onOpen={() => {
            onOpenThread?.();
            if (preferLead) {
              const project = workspace.projects.find(
                (p) => p.id === thread.projectId && p.environmentId === thread.environmentId,
              );
              if (project) {
                workspace.selectProject(project);
                return;
              }
            }
            workspace.openThread(scopeThreadRef(thread.environmentId, thread.id));
          }}
        />
      ))}
    </ul>
  );
}

function WorkGroups({
  threads,
  emptyText,
}: {
  threads: ReadonlyArray<EnvironmentThreadShell>;
  emptyText: string;
}) {
  const current = threads.filter(isCurrentWork);
  const finished = threads.filter((thread) => !isCurrentWork(thread));
  if (threads.length === 0) return <Empty icon={<ListTodoIcon />} text={emptyText} />;
  return (
    <>
      <section data-dropwave-group="">
        <h3>
          <T>Right now</T> <span>{current.length}</span>
        </h3>
        {current.length > 0 ? (
          <WorkList threads={current} />
        ) : (
          <p>
            <T>No sessions running.</T>
          </p>
        )}
      </section>
      {finished.length > 0 ? (
        <section data-dropwave-group="">
          <h3>
            <T>Done</T> <span>{finished.length}</span>
          </h3>
          <WorkList threads={finished} />
        </section>
      ) : null}
    </>
  );
}

function useSessionFamily({ environmentId, threadId }: ScopedThreadRef) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- retain this bot's finished sessions outside the live shell window
  useEffect(
    () => threadFamilies.mount(appAtomRegistry, environmentId, threadId),
    [environmentId, threadId],
  );
}

function SessionFamily({ thread }: { thread: EnvironmentThreadShell }) {
  useSessionFamily(scopeThreadRef(thread.environmentId, thread.id));
  return null;
}

function Activity() {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  if (!workspace) return null;
  const byKey = new Map(workspace.threads.map((thread) => [keyOfThread(thread), thread]));
  const recent = workspace.threads.filter(
    (thread) => thread.latestRun !== null && botOwner(byKey, thread) !== null,
  );
  return (
    <>
      {workspace.bots.map((bot) => (
        <SessionFamily key={keyOfThread(bot)} thread={bot} />
      ))}
      {recent.length > 0 ? (
        <WorkList threads={recent} orderByAttention />
      ) : (
        <Empty
          icon={<ActivityIcon />}
          text={gt("Activity appears here as bots and sessions run.")}
        />
      )}
    </>
  );
}

export function DropwaveNeeds({ onOpenThread }: { onOpenThread: () => void }) {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  if (!workspace) return null;
  return workspace.needs.length > 0 ? (
    <WorkList threads={workspace.needs} onOpenThread={onOpenThread} preferLead />
  ) : (
    <Empty icon={<CheckIcon />} text={gt("Nothing needs you right now.")} />
  );
}

function BotWork({ owner }: { owner: ScopedThreadRef }) {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const { environmentId, threadId } = owner;
  const family = useAtomValue(threadFamilies.familyAtom(environmentId, threadId));
  useSessionFamily(owner);
  if (!workspace) return null;
  const work = workFor(workspace.threads, owner);
  if (work.length === 0 && family._tag === "Initial") {
    return (
      <p role="status">
        <T>Loading this bot’s work…</T>
      </p>
    );
  }
  if (work.length === 0 && family._tag === "Failure") {
    return (
      <div data-dropwave-team-empty="">
        <p>
          <T>This bot’s sessions couldn’t be loaded.</T>
        </p>
        <Button onClick={() => threadFamilies.refresh(appAtomRegistry, environmentId, threadId)}>
          <T>Try again</T>
        </Button>
      </div>
    );
  }
  return <WorkGroups threads={work} emptyText={gt("This bot hasn’t started any sessions yet.")} />;
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div data-dropwave-panel-empty="">
      {icon}
      <p>{text}</p>
    </div>
  );
}

function Team() {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const canOperate = useEnvironmentScope(
    workspace?.project?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  if (!workspace?.project) return null;
  const { bots, lead, project, leadHidden } = workspace;
  if (leadHidden) {
    return (
      <div data-dropwave-team-empty="">
        <p>
          <T>The Chief of Staff is hidden by your thread filters.</T>
        </p>
        <Button render={<Link to="/settings/threads" />}>
          <T>Thread settings</T>
        </Button>
      </div>
    );
  }
  if (lead === null) {
    return (
      <div data-dropwave-team-empty="">
        <p>
          <T>
            Set up a Chief of Staff for <Var>{project.title}</Var> before adding helper bots.
          </T>
        </p>
        <Button
          disabled={!canOperate}
          onClick={() =>
            workspace.openPanel({ kind: "profile", target: { kind: "new-lead", project } })
          }
        >
          <T>Set up Chief of Staff</T>
        </Button>
      </div>
    );
  }
  const teammates = bots.filter(
    (bot) =>
      bot.environmentId === lead.environmentId &&
      bot.source.dropwaveBot?.kind === "teammate" &&
      bot.source.dropwaveBot.leadThreadId === lead.id,
  );
  const teamRow = (bot: EnvironmentThreadShell) => (
    <Row
      key={keyOfThread(bot)}
      thread={bot}
      onOpen={() => workspace.openThread(scopeThreadRef(bot.environmentId, bot.id))}
    >
      <button
        type="button"
        data-dropwave-small-button=""
        aria-label={gt("Edit {name}", { name: bot.title })}
        disabled={!canOperate}
        onClick={() => workspace.openPanel({ kind: "profile", target: { kind: "edit", bot } })}
      >
        <T>Edit</T>
      </button>
    </Row>
  );
  return (
    <>
      <section data-dropwave-group="">
        <h3>
          <T>Main bot</T>
        </h3>
        <ul data-dropwave-list="">{teamRow(lead)}</ul>
      </section>
      <section data-dropwave-group="">
        <div data-dropwave-group-heading="">
          <h3>
            <T>Helper bots</T>
          </h3>
          <Button
            variant="outline"
            size="sm"
            disabled={!canOperate}
            onClick={() =>
              workspace.openPanel({
                kind: "profile",
                target: { kind: "new-teammate", lead, project },
              })
            }
          >
            <PlusIcon /> <T>Add helper</T>
          </Button>
        </div>
        {teammates.length > 0 ? (
          <ul data-dropwave-list="">{teammates.map(teamRow)}</ul>
        ) : (
          <p>
            <T>Add a helper when you want a dedicated specialist like QA or SEO.</T>
          </p>
        )}
      </section>
    </>
  );
}

export function DropwavePanels({ panel, onClose }: { panel: WorkspacePanel; onClose: () => void }) {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  if (!workspace) return null;
  if (panel.kind === "profile") {
    return <DropwaveBotEditor target={panel.target} onClose={onClose} />;
  }

  let title: string;
  let description: string;
  let body: React.ReactNode;
  let Icon = ListTodoIcon;
  switch (panel.kind) {
    case "team":
      title = gt("Team");
      description = workspace.project?.title ?? gt("Project team");
      body = <Team />;
      break;
    case "asks":
      title = gt("Tracked asks");
      description = workspace.project?.title ?? gt("Zero-loss ask ledger");
      body = <DropwaveAsksPanel />;
      Icon = ListChecksIcon;
      break;
    case "work": {
      const bot = workspace.bots.find(
        (thread) =>
          thread.environmentId === panel.owner.environmentId && thread.id === panel.owner.threadId,
      );
      title = gt("Work");
      description = bot?.title ?? gt("Bot sessions");
      body = <BotWork owner={panel.owner} />;
      break;
    }
    case "activity": {
      title = gt("Activity");
      description = gt("Recent work across your projects");
      body = <Activity />;
      Icon = ActivityIcon;
      break;
    }
  }
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetPopup data-dropwave-sheet="" side="right" variant="inset">
        <SheetHeader>
          <div data-dropwave-sheet-icon="">
            <Icon />
          </div>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div data-dropwave-panel-body="">{body}</div>
      </SheetPopup>
    </Sheet>
  );
}
