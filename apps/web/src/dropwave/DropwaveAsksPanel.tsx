import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { DropwaveAsk } from "@t3tools/contracts";
import { T, Var, useGT } from "gt-react";
import { CheckIcon, ListChecksIcon, PlusIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { formatShortAge } from "./model";
import { useDropwaveWorkspace } from "./workspaceContext";

export function DropwaveAsksPanel() {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const project = workspace?.project ?? null;
  const targetBot = workspace?.lead ?? workspace?.activeBot ?? null;
  const [asks, setAsks] = useState<ReadonlyArray<DropwaveAsk>>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [newAskText, setNewAskText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listAsksCmd = useAtomCommand(serverEnvironment.dropwaveAsksList, { reportFailure: false });
  const addAskCmd = useAtomCommand(serverEnvironment.dropwaveAskAdd, { reportFailure: false });
  const updateAskCmd = useAtomCommand(serverEnvironment.dropwaveAskUpdate, {
    reportFailure: false,
  });

  const [reloadNonce, setReloadNonce] = useState(0);
  const triggerReload = () => setReloadNonce((n) => n + 1);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads tracked asks from server when project, filter, or mutation nonce changes
  useEffect(() => {
    if (!project || reloadNonce < 0) return;
    let cancelled = false;
    void listAsksCmd({
      environmentId: project.environmentId,
      input: { projectId: project.id, includeClosed: showClosed },
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
  }, [gt, listAsksCmd, project, reloadNonce, showClosed, workspace]);

  if (!workspace || !project) return null;

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
      triggerReload();
    } else if (!isAtomCommandInterrupted(res)) {
      const cause = squashAtomCommandFailure(res);
      setError(cause instanceof Error ? cause.message : gt("Could not add ask."));
    }
  };

  const setStatus = async (askId: string, status: "done" | "dropped" | "heard") => {
    if (busy) return;
    setBusy(true);
    const res = await updateAskCmd({
      environmentId: project.environmentId,
      input: {
        askId,
        status,
        ...(status === "done" ? { proof: "Marked done by owner" } : {}),
      },
    });
    setBusy(false);
    if (res._tag === "Success") triggerReload();
  };

  return (
    <div data-dropwave-asks="">
      <p data-dropwave-asks-caption="">
        <T>
          Every request you send is tracked outside the chat so long dumps and worker failures never
          get forgotten.
        </T>
      </p>

      {targetBot ? (
        <form
          data-dropwave-ask-add=""
          onSubmit={(event) => {
            event.preventDefault();
            void addAsk();
          }}
        >
          <input
            value={newAskText}
            onChange={(event) => setNewAskText(event.currentTarget.value)}
            placeholder={gt("Add an ask that was missed…")}
          />
          <button
            type="submit"
            data-dropwave-small-button=""
            disabled={busy || !newAskText.trim()}
            aria-label={gt("Add ask")}
          >
            <PlusIcon />
          </button>
        </form>
      ) : null}

      <div data-dropwave-asks-filter="">
        <button type="button" aria-pressed={!showClosed} onClick={() => setShowClosed(false)}>
          <T>Open</T>
        </button>
        <button type="button" aria-pressed={showClosed} onClick={() => setShowClosed(true)}>
          <T>All</T>
        </button>
      </div>

      {error ? (
        <p data-dropwave-form-error="" role="alert">
          {error}
        </p>
      ) : null}

      {asks.length === 0 ? (
        <div data-dropwave-panel-empty="">
          <ListChecksIcon />
          <p>
            <T>No tracked asks here yet.</T>
          </p>
        </div>
      ) : (
        <ul data-dropwave-asks-list="">
          {asks.map((ask) => {
            const isClosed = ask.status === "done" || ask.status === "dropped";
            return (
              <li key={ask.id} data-dropwave-ask-row="" data-status={ask.status}>
                <div data-dropwave-ask-head="">
                  <span data-dropwave-ask-num="">
                    #<Var>{ask.n}</Var>
                  </span>
                  <span data-dropwave-ask-badge="" data-status={ask.status}>
                    {ask.status === "heard" ? gt("Queued") : ask.status}
                  </span>
                  <span data-dropwave-ask-age="">{formatShortAge(ask.updatedAt)}</span>
                </div>
                <p data-dropwave-ask-summary="">{ask.summary}</p>
                {ask.note ? <small data-dropwave-ask-note="">{ask.note}</small> : null}
                {ask.proof ? (
                  <small data-dropwave-ask-proof="">
                    <T>
                      Proof: <Var>{ask.proof}</Var>
                    </T>
                  </small>
                ) : null}
                <div data-dropwave-ask-actions="">
                  {!isClosed ? (
                    <>
                      <button
                        type="button"
                        data-dropwave-small-button=""
                        disabled={busy}
                        onClick={() => void setStatus(ask.id, "done")}
                      >
                        <CheckIcon />
                        <T>Done</T>
                      </button>
                      <button
                        type="button"
                        data-dropwave-small-button=""
                        disabled={busy}
                        onClick={() => void setStatus(ask.id, "dropped")}
                      >
                        <XIcon />
                        <T>Drop</T>
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      data-dropwave-small-button=""
                      disabled={busy}
                      onClick={() => void setStatus(ask.id, "heard")}
                    >
                      <RotateCcwIcon />
                      <T>Reopen</T>
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
