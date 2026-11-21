import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { T, useGT } from "gt-react";
import { BrainIcon, ExternalLinkIcon, Undo2Icon } from "lucide-react";
import { useEffect, useState } from "react";

import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { formatShortAge } from "./model";
import { useDropwaveWorkspace } from "./workspaceContext";

interface EmbeddingStatus {
  readonly state: "disabled" | "loading" | "ready" | "error";
  readonly modelId: string;
  readonly dim: number;
  readonly enabled: boolean;
  readonly lastError?: string | undefined;
  readonly progress?: number | undefined;
}

interface LastTidy {
  readonly at: string;
  readonly summary: string;
  readonly merged: number;
  readonly enriched: number;
  readonly relationsPruned: number;
}

export function DropwaveMemorySettings({ onOpenMemory }: { onOpenMemory: () => void }) {
  const gt = useGT();
  const workspace = useDropwaveWorkspace();
  const environmentId =
    workspace?.project?.environmentId ?? workspace?.projects[0]?.environmentId ?? null;

  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  const [lastTidy, setLastTidy] = useState<LastTidy | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const statusCmd = useAtomCommand(serverEnvironment.dropwaveMemoryEmbeddingStatus, {
    reportFailure: false,
  });
  const setEnabledCmd = useAtomCommand(serverEnvironment.dropwaveMemorySetEmbeddingEnabled, {
    reportFailure: false,
  });
  const undoTidyCmd = useAtomCommand(serverEnvironment.dropwaveMemoryUndoTidy, {
    reportFailure: false,
  });

  const reload = () => {
    if (environmentId === null) return;
    void statusCmd({ environmentId, input: {} }).then((res) => {
      if (res._tag !== "Success") return;
      setStatus(res.value.status);
      setLastTidy(res.value.lastTidy ?? null);
    });
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads live embedding status
  useEffect(() => {
    reload();
  }, [reload]);

  if (environmentId === null) return null;

  const statusLabel =
    status === null
      ? gt("Checking…")
      : !status.enabled || status.state === "disabled"
        ? gt("Off")
        : status.state === "loading"
          ? status.progress !== undefined
            ? gt("Downloading {percent}%", {
                percent: Math.round(status.progress * 100),
              })
            : gt("Downloading…")
          : status.state === "ready"
            ? gt("Ready")
            : gt("Unavailable");

  const toggleEmbeddings = async () => {
    if (busy || status === null) return;
    setBusy(true);
    const res = await setEnabledCmd({
      environmentId,
      input: { enabled: !status.enabled },
    });
    setBusy(false);
    if (res._tag === "Success") {
      setStatus(res.value.status);
      setNote(
        res.value.status.enabled
          ? gt("Local memory embeddings are on.")
          : gt("Local memory embeddings are off."),
      );
    }
  };

  const undoTidy = async () => {
    if (busy) return;
    setBusy(true);
    const res = await undoTidyCmd({ environmentId, input: {} });
    setBusy(false);
    if (res._tag === "Success") {
      setNote(gt("Undid {count} tidy changes.", { count: res.value.undone }));
      reload();
    } else if (!isAtomCommandInterrupted(res)) {
      const cause = squashAtomCommandFailure(res);
      setNote(cause instanceof Error ? cause.message : gt("Could not undo the last tidy."));
    }
  };

  return (
    <section data-dw-settings-group="">
      <h3>
        <BrainIcon className="size-3.5" data-dw-icon="indigo" />
        <T>Memory</T>
      </h3>
      <p data-dw-settings-desc="">
        <T>
          Bots remember preferences, rules and facts across projects. A small local model runs on
          this machine to understand what memories mean; it never leaves your computer.
        </T>
      </p>

      <div data-dw-settings-row="">
        <div>
          <strong>
            <T>Local embeddings</T>
          </strong>
          <p data-dw-settings-desc="">{statusLabel}</p>
        </div>
        <button
          type="button"
          data-dw-risk-btn=""
          aria-pressed={status?.enabled === true}
          disabled={busy || status === null}
          onClick={() => void toggleEmbeddings()}
        >
          {status?.enabled === true ? gt("On") : gt("Off")}
        </button>
      </div>

      {lastTidy !== null ? (
        <div data-dw-settings-row="">
          <div>
            <strong>
              <T>Last memory tidy</T>
            </strong>
            <p data-dw-settings-desc="">
              {lastTidy.summary} · {formatShortAge(lastTidy.at)}
            </p>
          </div>
          <button
            type="button"
            data-dw-mini-icon=""
            aria-label={gt("Undo the last tidy")}
            disabled={busy}
            onClick={() => void undoTidy()}
          >
            <Undo2Icon className="size-4" />
          </button>
        </div>
      ) : null}

      {note !== null ? <p data-dw-settings-desc="">{note}</p> : null}

      <div data-dw-settings-row="">
        <button type="button" data-dropwave-header-button="" onClick={onOpenMemory}>
          <ExternalLinkIcon />
          <T>Open memory</T>
        </button>
      </div>
    </section>
  );
}
