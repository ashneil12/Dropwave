import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  DropwaveAsk,
  DropwaveAskStatus,
  EnvironmentId,
  OrchestrationV2Subagent,
  ThreadId,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { T, Var, useGT } from "gt-react";
import { CheckIcon, ListChecksIcon, PlusIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { useEffect, useState, type DragEvent } from "react";

import { Dialog, DialogPopup } from "../components/ui/dialog";
import { serverEnvironment } from "../state/server";
import { environmentThreadDetails } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { DropwaveBotAvatar } from "./DropwaveBotAvatar";
import {
  ASK_BOARD_LANE_ORDER,
  askWorkerPhase,
  groupAsksByLane,
  laneDropStatus,
  type AskBoardLaneId,
  type AskWorkerPhase,
} from "./DropwaveAskBoard.logic";
import { formatShortAge } from "./model";
import { useDropwaveWorkspace } from "./workspaceContext";

const ASK_DRAG_MIME = "application/x-dropwave-ask";

/** Subagent records for every bot thread that owns an ask, keyed by thread id. */
const askBoardSubagentsAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    const refs = JSON.parse(key) as ReadonlyArray<readonly [string, string]>;
    const result: Record<string, ReadonlyArray<OrchestrationV2Subagent> | null> = {};
    for (const [environmentId, threadId] of refs) {
      const ref = scopeThreadRef(environmentId as EnvironmentId, threadId as ThreadId);
      result[threadId] =
        get(environmentThreadDetails.threadAtom(ref))?.projection.subagents ?? null;
    }
    return result;
  }).pipe(Atom.withLabel(`dropwave-ask-board-subagents:${key}`)),
);

const LANE_DOT: Record<AskBoardLaneId, string> = {
  heard: "amber",
  working: "indigo",
  waiting: "coral",
  checking: "emerald",
  done: "emerald",
};

function LaneTitle({ lane }: { lane: AskBoardLaneId }) {
  switch (lane) {
    case "heard":
      return <T>Heard</T>;
    case "working":
      return <T>Working</T>;
    case "waiting":
      return <T>Waiting on you</T>;
    case "checking":
      return <T>Checking</T>;
    case "done":
      return <T>Done</T>;
  }
}

function laneAriaLabel(lane: AskBoardLaneId, gt: (message: string) => string): string {
  switch (lane) {
    case "heard":
      return gt("Heard");
    case "working":
      return gt("Working");
    case "waiting":
      return gt("Waiting on you");
    case "checking":
      return gt("Checking");
    case "done":
      return gt("Done");
  }
}

function AskCard({
  ask,
  phase,
  busy,
  onRequestDone,
  onRequestDrop,
  onReopen,
  onDragStart,
  onDragEnd,
}: {
  ask: DropwaveAsk;
  phase: AskWorkerPhase;
  busy: boolean;
  onRequestDone: (ask: DropwaveAsk) => void;
  onRequestDrop: (ask: DropwaveAsk) => void;
  onReopen: (ask: DropwaveAsk) => void;
  onDragStart: (event: DragEvent<HTMLElement>, ask: DropwaveAsk) => void;
  onDragEnd: () => void;
}) {
  const gt = useGT();
  const workspace = useDropwaveWorkspace();
  const bot = workspace?.bots.find((b) => b.id === ask.botThreadId) ?? null;
  const isClosed = ask.status === "done" || ask.status === "dropped";
  const isDropped = ask.status === "dropped";
  return (
    <article
      data-dw-ask-card=""
      data-status={ask.status}
      data-closed={isClosed ? "true" : undefined}
      draggable
      onDragStart={(event) => onDragStart(event, ask)}
      onDragEnd={onDragEnd}
    >
      <header data-dw-ask-card-top="">
        <span data-dw-ask-num="">
          #<Var>{ask.n}</Var>
        </span>
        {phase === "active" ? (
          <span data-dw-dot="emerald" data-pulse="" aria-label={gt("Worker running")} />
        ) : null}
        {bot ? (
          <DropwaveBotAvatar
            name={bot.title}
            seed={bot.source.dropwaveBot?.avatarSeed}
            role={bot.source.dropwaveBot?.kind === "lead" ? "lead" : "specialist"}
            size="sm"
            status={phase === "active" ? "working" : "none"}
          />
        ) : null}
        <span data-dw-ask-age="">{formatShortAge(ask.updatedAt)}</span>
      </header>
      <p data-dw-ask-summary="">{ask.summary}</p>
      {ask.quote ? <blockquote data-dw-ask-quote="">{ask.quote}</blockquote> : null}
      {ask.note ? <small data-dw-ask-note="">{ask.note}</small> : null}
      {ask.proof ? <small data-dw-ask-proof="">{ask.proof}</small> : null}
      {isDropped ? (
        <span data-dw-ask-dropped="">
          <T>Dropped</T>
        </span>
      ) : null}
      <footer data-dw-ask-card-actions="">
        {!isClosed ? (
          <>
            <button
              type="button"
              data-dw-ask-act=""
              disabled={busy}
              onClick={() => onRequestDone(ask)}
            >
              <CheckIcon />
              <T>Done</T>
            </button>
            <button
              type="button"
              data-dw-ask-act=""
              data-tone="drop"
              disabled={busy}
              onClick={() => onRequestDrop(ask)}
            >
              <XIcon />
              <T>Drop</T>
            </button>
          </>
        ) : (
          <button type="button" data-dw-ask-act="" disabled={busy} onClick={() => onReopen(ask)}>
            <RotateCcwIcon />
            <T>Reopen</T>
          </button>
        )}
      </footer>
    </article>
  );
}

function AddAskForm({
  value,
  busy,
  inline,
  onChange,
  onSubmit,
}: {
  value: string;
  busy: boolean;
  inline?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const gt = useGT();
  return (
    <form
      data-dw-ask-add=""
      data-inline={inline ? "" : undefined}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <input
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={gt("Add an ask that was missed…")}
      />
      <button
        type="submit"
        data-dw-ask-add-btn=""
        disabled={busy || !value.trim()}
        aria-label={gt("Add ask")}
      >
        <PlusIcon />
      </button>
    </form>
  );
}

export function DropwaveAsksPanel() {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const project = workspace?.project ?? null;
  const targetBot = workspace?.lead ?? workspace?.activeBot ?? null;
  const [asks, setAsks] = useState<ReadonlyArray<DropwaveAsk>>([]);
  const [newAskText, setNewAskText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{
    ask: DropwaveAsk;
    action: "done" | "drop";
  } | null>(null);
  const [dragAskId, setDragAskId] = useState<string | null>(null);
  const [dropLane, setDropLane] = useState<AskBoardLaneId | null>(null);
  const [showAllClosed, setShowAllClosed] = useState(false);

  const listAsksCmd = useAtomCommand(serverEnvironment.dropwaveAsksList, { reportFailure: false });
  const addAskCmd = useAtomCommand(serverEnvironment.dropwaveAskAdd, { reportFailure: false });
  const updateAskCmd = useAtomCommand(serverEnvironment.dropwaveAskUpdate, {
    reportFailure: false,
  });

  const [reloadNonce, setReloadNonce] = useState(0);
  const triggerReload = () => setReloadNonce((n) => n + 1);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads tracked asks from server when project or mutation nonce changes
  useEffect(() => {
    if (!project || reloadNonce < 0) return;
    let cancelled = false;
    void listAsksCmd({
      environmentId: project.environmentId,
      input: { projectId: project.id, includeClosed: true },
    }).then((res) => {
      if (cancelled) return;
      if (res._tag === "Success") {
        setError(null);
        setAsks(res.value.asks);
        workspace?.refreshOpenAsksCount();
      } else if (!isAtomCommandInterrupted(res)) {
        const cause = squashAtomCommandFailure(res);
        setError(cause instanceof Error ? cause.message : gt("Could not load asks."));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [gt, listAsksCmd, project, reloadNonce, workspace]);

  const subagentsKey = project
    ? JSON.stringify(
        [...new Set(asks.map((ask) => ask.botThreadId))]
          .sort()
          .map((id) => [project.environmentId, id]),
      )
    : "[]";
  const subagentsByThread = useAtomValue(askBoardSubagentsAtom(subagentsKey));

  if (!workspace || !project) return null;

  const phaseFor = (ask: DropwaveAsk): AskWorkerPhase =>
    askWorkerPhase(ask.jobs, subagentsByThread[ask.botThreadId] ?? null);

  const maybeAsks = asks.filter((ask) => ask.status === "maybe");
  const boardAsks = asks.filter((ask) => ask.status !== "maybe");
  const lanes = groupAsksByLane(boardAsks, phaseFor);

  const addAsk = async () => {
    if (!targetBot || !newAskText.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await addAskCmd({
      environmentId: project.environmentId,
      input: {
        projectId: project.id,
        botThreadId: targetBot.id,
        text: newAskText.trim(),
      },
    });
    setBusy(false);
    if (res._tag === "Success") {
      setNewAskText("");
      workspace?.refreshOpenAsksCount();
      triggerReload();
    } else if (!isAtomCommandInterrupted(res)) {
      const cause = squashAtomCommandFailure(res);
      setError(cause instanceof Error ? cause.message : gt("Could not add ask."));
    }
  };

  const setStatus = async (
    askId: string,
    status: DropwaveAskStatus,
    extra?: { proof?: string },
  ) => {
    if (busy) return;
    setBusy(true);
    const res = await updateAskCmd({
      environmentId: project.environmentId,
      input: {
        askId,
        status,
        ...(extra?.proof ? { proof: extra.proof } : {}),
      },
    });
    setBusy(false);
    if (res._tag === "Success") {
      setConfirm(null);
      workspace?.refreshOpenAsksCount();
      triggerReload();
    } else if (!isAtomCommandInterrupted(res)) {
      const cause = squashAtomCommandFailure(res);
      setError(cause instanceof Error ? cause.message : gt("Could not update ask."));
    }
  };

  const confirmAction = () => {
    if (!confirm) return;
    if (confirm.action === "done") {
      void setStatus(confirm.ask.id, "done", { proof: gt("Marked done by owner") });
    } else {
      void setStatus(confirm.ask.id, "dropped");
    }
  };

  const moveAskToLane = (askId: string, lane: AskBoardLaneId) => {
    const status = laneDropStatus(lane);
    if (status === null) return;
    const ask = asks.find((candidate) => candidate.id === askId);
    if (!ask || ask.status === status) return;
    if (status === "done") {
      setConfirm({ ask, action: "done" });
      return;
    }
    void setStatus(askId, status);
  };

  const closedSorted = [...lanes.done].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const visibleClosed = showAllClosed ? closedSorted : closedSorted.slice(0, 10);
  const hiddenClosedCount = closedSorted.length - visibleClosed.length;

  const onCardDragStart = (event: DragEvent<HTMLElement>, ask: DropwaveAsk) => {
    event.dataTransfer.setData(ASK_DRAG_MIME, ask.id);
    event.dataTransfer.effectAllowed = "move";
    setDragAskId(ask.id);
  };

  const onLaneDragOver = (event: DragEvent<HTMLElement>, lane: AskBoardLaneId) => {
    if (!dragAskId || laneDropStatus(lane) === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropLane(lane);
  };

  const onLaneDrop = (event: DragEvent<HTMLElement>, lane: AskBoardLaneId) => {
    event.preventDefault();
    const askId = event.dataTransfer.getData(ASK_DRAG_MIME) || dragAskId;
    setDropLane(null);
    setDragAskId(null);
    if (askId) moveAskToLane(askId, lane);
  };

  const renderCard = (ask: DropwaveAsk) => (
    <AskCard
      key={ask.id}
      ask={ask}
      phase={phaseFor(ask)}
      busy={busy}
      onRequestDone={(a) => setConfirm({ ask: a, action: "done" })}
      onRequestDrop={(a) => setConfirm({ ask: a, action: "drop" })}
      onReopen={(a) => void setStatus(a.id, "heard")}
      onDragStart={onCardDragStart}
      onDragEnd={() => {
        setDragAskId(null);
        setDropLane(null);
      }}
    />
  );

  return (
    <div data-dropwave-asks="">
      <p data-dropwave-asks-caption="">
        <T>
          Every request you send is tracked outside the chat so long dumps and worker failures never
          get forgotten.
        </T>
      </p>

      {maybeAsks.length > 0 ? (
        <section data-dw-ask-maybe="" aria-label={gt("Did you mean this?")}>
          <span data-dw-ask-maybe-label="">
            <T>Did you mean this?</T>
          </span>
          {maybeAsks.map((ask) => (
            <div key={ask.id} data-dw-ask-maybe-row="">
              <span data-dw-ask-maybe-text="">{ask.summary}</span>
              <button
                type="button"
                data-dw-ask-act=""
                disabled={busy}
                onClick={() => void setStatus(ask.id, "heard")}
              >
                <T>Keep</T>
              </button>
              <button
                type="button"
                data-dw-ask-act=""
                data-tone="drop"
                disabled={busy}
                onClick={() => setConfirm({ ask, action: "drop" })}
              >
                <T>Drop</T>
              </button>
            </div>
          ))}
        </section>
      ) : null}

      {error ? (
        <p data-dropwave-form-error="" role="alert">
          {error}
        </p>
      ) : null}

      {boardAsks.length === 0 && maybeAsks.length === 0 ? (
        <div data-dropwave-panel-empty="">
          <ListChecksIcon />
          <p>
            <T>No tracked asks here yet.</T>
          </p>
          {targetBot ? (
            <AddAskForm
              value={newAskText}
              busy={busy}
              onChange={setNewAskText}
              onSubmit={() => void addAsk()}
            />
          ) : null}
        </div>
      ) : (
        <div data-dw-askboard="" aria-label={gt("Asks board")}>
          {ASK_BOARD_LANE_ORDER.map((laneId) => {
            const laneAsks = laneId === "done" ? visibleClosed : lanes[laneId];
            const isDropTarget = dropLane === laneId;
            return (
              <section
                key={laneId}
                data-dw-asklane=""
                data-lane={laneId}
                data-drop={isDropTarget ? "true" : undefined}
                aria-label={laneAriaLabel(laneId, gt)}
                onDragOver={(event) => onLaneDragOver(event, laneId)}
                onDragLeave={() => setDropLane((current) => (current === laneId ? null : current))}
                onDrop={(event) => onLaneDrop(event, laneId)}
              >
                <header data-dw-asklane-head="">
                  <span>
                    <span data-dw-dot={LANE_DOT[laneId]} />
                    <strong>
                      <LaneTitle lane={laneId} />
                    </strong>
                  </span>
                  <span data-dw-mono="dim">{laneAsks.length}</span>
                </header>
                <div data-dw-asklane-cards="">
                  {laneId === "heard" && targetBot ? (
                    <AddAskForm
                      value={newAskText}
                      busy={busy}
                      inline
                      onChange={setNewAskText}
                      onSubmit={() => void addAsk()}
                    />
                  ) : null}
                  {laneAsks.map(renderCard)}
                  {laneAsks.length === 0 ? (
                    <p data-dw-rail-empty="">
                      <T>Empty</T>
                    </p>
                  ) : null}
                  {laneId === "done" && hiddenClosedCount > 0 ? (
                    <button
                      type="button"
                      data-dw-ask-show-all=""
                      onClick={() => setShowAllClosed(true)}
                    >
                      <T>
                        Show all (<Var>{closedSorted.length}</Var>)
                      </T>
                    </button>
                  ) : null}
                  {laneId === "done" && showAllClosed && closedSorted.length > 10 ? (
                    <button
                      type="button"
                      data-dw-ask-show-all=""
                      onClick={() => setShowAllClosed(false)}
                    >
                      <T>Show less</T>
                    </button>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Dialog
        open={confirm !== null}
        onOpenChange={(next) => {
          if (!next) setConfirm(null);
        }}
      >
        <DialogPopup data-dw-ask-confirm="" showCloseButton={false}>
          <h3>{confirm?.action === "done" ? <T>Mark this ask done?</T> : <T>Drop this ask?</T>}</h3>
          <p>{confirm?.ask.summary}</p>
          <div data-dw-ask-confirm-actions="">
            <button type="button" data-dw-btn-ghost="" onClick={() => setConfirm(null)}>
              <T>Cancel</T>
            </button>
            <button
              type="button"
              data-dw-btn-solid=""
              data-tone={confirm?.action === "drop" ? "drop" : undefined}
              disabled={busy}
              onClick={confirmAction}
            >
              {confirm?.action === "done" ? <T>Mark done</T> : <T>Drop ask</T>}
            </button>
          </div>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
