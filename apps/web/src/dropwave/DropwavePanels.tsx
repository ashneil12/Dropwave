import { PullRequestGlyph } from "../components/pullRequest/pullRequestIcons";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { AuthOrchestrationOperateScope, type ScopedThreadRef } from "@t3tools/contracts";
import {
  ActivityIcon,
  ArrowUpRightIcon,
  CheckIcon,
  InboxIcon,
  ListTodoIcon,
  PlusIcon,
} from "lucide-react";
import { useEffect } from "react";

import { Button } from "../components/ui/button";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPopup,
  SheetTitle,
} from "../components/ui/sheet";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { threadFamilies } from "../state/threads";
import { useEnvironmentScope } from "../state/session";
import { DropwaveBotEditor } from "./DropwaveBotEditor";
import {
  botOwner,
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
  const state = workState(thread);
  return (
    <span data-dropwave-status="" data-status={state}>
      <span aria-hidden="true" />
      {workStateLabel[state]}
    </span>
  );
}

function Row({
  thread,
  onOpen,
  children,
}: {
  thread: EnvironmentThreadShell;
  onOpen: () => void;
  children?: React.ReactNode;
}) {
  const profile = threadParentKey(thread) === null ? thread.source.dropwaveBot : undefined;
  const pullRequest = thread.pullRequests[0] ?? thread.linkedPullRequest;
  return (
    <li data-dropwave-row="">
      <button type="button" data-dropwave-row-main="" onClick={onOpen}>
        <span data-dropwave-row-title="">{thread.title}</span>
        {profile?.brief ? <span data-dropwave-row-subtitle="">{profile.brief}</span> : null}
      </button>
      <Status thread={thread} />
      {pullRequest ? (
        <a
          data-dropwave-pr=""
          href={pullRequest.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`Pull request ${pullRequest.number}`}
        >
          <PullRequestGlyph.pullRequest /> #{pullRequest.number}
          <ArrowUpRightIcon />
        </a>
      ) : null}
      {children}
    </li>
  );
}

function WorkList({ threads }: { threads: ReadonlyArray<EnvironmentThreadShell> }) {
  const workspace = useDropwaveWorkspace();
  if (!workspace) return null;
  return (
    <ul data-dropwave-list="">
      {[...threads].sort(newestWorkFirst).map((thread) => (
        <Row
          key={keyOfThread(thread)}
          thread={thread}
          onOpen={() => workspace.openThread(scopeThreadRef(thread.environmentId, thread.id))}
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
          Right now <span>{current.length}</span>
        </h3>
        {current.length > 0 ? <WorkList threads={current} /> : <p>No sessions running.</p>}
      </section>
      {finished.length > 0 ? (
        <section data-dropwave-group="">
          <h3>
            Finished <span>{finished.length}</span>
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
        <WorkGroups threads={recent} emptyText="No activity yet." />
      ) : (
        <Empty icon={<ActivityIcon />} text="Activity will appear when a bot starts working." />
      )}
    </>
  );
}

function BotWork({ owner }: { owner: ScopedThreadRef }) {
  const workspace = useDropwaveWorkspace();
  const { environmentId, threadId } = owner;
  const family = useAtomValue(threadFamilies.familyAtom(environmentId, threadId));
  useSessionFamily(owner);
  if (!workspace) return null;
  const work = workFor(workspace.threads, owner);
  if (work.length === 0 && family._tag === "Initial") {
    return <p role="status">Loading this bot’s work…</p>;
  }
  if (work.length === 0 && family._tag === "Failure") {
    return (
      <div data-dropwave-team-empty="">
        <p>This bot’s sessions couldn’t be loaded.</p>
        <Button onClick={() => threadFamilies.refresh(appAtomRegistry, environmentId, threadId)}>
          Try again
        </Button>
      </div>
    );
  }
  return <WorkGroups threads={work} emptyText="This bot hasn’t started any sessions yet." />;
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
  const canOperate = useEnvironmentScope(
    workspace?.project?.environmentId ?? null,
    AuthOrchestrationOperateScope,
  );
  if (!workspace?.project) return null;
  const { bots, lead, project, leadHidden } = workspace;
  if (leadHidden) {
    return (
      <div data-dropwave-team-empty="">
        <p>The lead is hidden by your thread filters.</p>
        <Button render={<Link to="/settings/threads" />}>Thread settings</Button>
      </div>
    );
  }
  if (lead === null) {
    return (
      <div data-dropwave-team-empty="">
        <p>Set up a lead for {project.title} before adding teammates.</p>
        <Button
          disabled={!canOperate}
          onClick={() =>
            workspace.openPanel({ kind: "profile", target: { kind: "new-lead", project } })
          }
        >
          Create lead
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
        aria-label={`Edit ${bot.title}`}
        disabled={!canOperate}
        onClick={() => workspace.openPanel({ kind: "profile", target: { kind: "edit", bot } })}
      >
        Edit
      </button>
    </Row>
  );
  return (
    <>
      <section data-dropwave-group="">
        <h3>Project lead</h3>
        <ul data-dropwave-list="">{teamRow(lead)}</ul>
      </section>
      <section data-dropwave-group="">
        <div data-dropwave-group-heading="">
          <h3>Teammates</h3>
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
            <PlusIcon /> Add teammate
          </Button>
        </div>
        {teammates.length > 0 ? (
          <ul data-dropwave-list="">{teammates.map(teamRow)}</ul>
        ) : (
          <p>Add a teammate when you need a specialist, such as QA or design.</p>
        )}
      </section>
    </>
  );
}

export function DropwavePanels({ panel, onClose }: { panel: WorkspacePanel; onClose: () => void }) {
  const workspace = useDropwaveWorkspace();
  if (!workspace) return null;
  if (panel.kind === "profile") {
    return <DropwaveBotEditor target={panel.target} onClose={onClose} />;
  }

  let title: string;
  let description: string;
  let body: React.ReactNode;
  switch (panel.kind) {
    case "team":
      title = "Team";
      description = workspace.project?.title ?? "Project team";
      body = <Team />;
      break;
    case "work": {
      const bot = workspace.bots.find(
        (thread) =>
          thread.environmentId === panel.owner.environmentId && thread.id === panel.owner.threadId,
      );
      title = "Work";
      description = bot?.title ?? "Bot sessions";
      body = <BotWork owner={panel.owner} />;
      break;
    }
    case "activity": {
      title = "Activity";
      description = "Recent work across your projects";
      body = <Activity />;
      break;
    }
    case "needs":
      title = "Needs you";
      description = "Questions and approvals across your projects";
      body =
        workspace.needs.length > 0 ? (
          <WorkList threads={workspace.needs} />
        ) : (
          <Empty icon={<CheckIcon />} text="You’re all caught up." />
        );
      break;
  }
  const Icon =
    panel.kind === "needs" ? InboxIcon : panel.kind === "activity" ? ActivityIcon : ListTodoIcon;
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
