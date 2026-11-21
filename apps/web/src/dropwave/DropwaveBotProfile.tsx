import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  AuthOrchestrationOperateScope,
  DEFAULT_SERVER_SETTINGS,
  type DropwaveMemoryItem,
} from "@t3tools/contracts";
import { T, Var, useGT } from "gt-react";
import { MessageSquareIcon, Trash2Icon, UserRoundXIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { requestConfirmDialog } from "../confirmDialog";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readEnvironmentProviders } from "../state/environments";
import { environmentServerConfigsAtom, serverEnvironment } from "../state/server";
import { useEnvironmentScope } from "../state/session";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { providerInstanceEntriesFor } from "../providerInstances";
import { DropwaveBotAvatar } from "./DropwaveBotAvatar";
import { useDropwaveWorkspace } from "./workspaceContext";

/**
 * Read-mostly bot profile: identity, model, permissions, memory count, and the
 * two ways out — remove from this project (persona kept) or delete from crew.
 */
export function DropwaveBotProfile({
  bot,
  onClose,
}: {
  bot: EnvironmentThreadShell;
  onClose: () => void;
}) {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const environmentId = bot.environmentId;
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const profile = bot.source.dropwaveBot?.kind === "teammate" ? bot.source.dropwaveBot : null;
  const lead = workspace?.lead ?? null;
  const project = workspace?.project ?? null;

  const [memories, setMemories] = useState<ReadonlyArray<DropwaveMemoryItem>>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listMemories = useAtomCommand(serverEnvironment.dropwaveMemoryList, {
    reportFailure: false,
  });
  const deletePersona = useAtomCommand(serverEnvironment.dropwavePersonaDelete, {
    reportFailure: false,
  });
  const archive = useOrchestrationCommand(threadEnvironment.archive, { reportFailure: false });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the bot's memory rows for the count
  useEffect(() => {
    if (!project || !profile) return;
    let cancelled = false;
    void listMemories({
      environmentId,
      input: { projectId: project.id, botThreadId: bot.id },
    }).then((res) => {
      if (cancelled) return;
      if (res._tag === "Success") setMemories(res.value.items);
    });
    return () => {
      cancelled = true;
    };
  }, [bot.id, environmentId, listMemories, profile, project]);

  if (!workspace || !profile || !project) return null;

  const memoryCount = memories.filter(
    (item) =>
      item.botThreadId === bot.id ||
      (profile.personaId !== undefined && item.personaId === profile.personaId),
  ).length;

  const providers = readEnvironmentProviders(environmentId) ?? [];
  const settings =
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.settings ??
    DEFAULT_SERVER_SETTINGS;
  const entries = providerInstanceEntriesFor(providers, settings, project.id);
  const modelSelection = bot.source.modelSelection;
  const modelEntry = modelSelection
    ? entries.find((entry) => entry.instanceId === modelSelection.instanceId)
    : undefined;
  const modelName = modelSelection
    ? (modelEntry?.models.find((model) => model.slug === modelSelection.model)?.name ??
      modelSelection.model)
    : null;
  const riskLevel =
    lead?.source.dropwaveBot?.kind === "lead"
      ? (lead.source.dropwaveBot.riskLevel ?? "yolo")
      : "yolo";
  const roleLine = profile.role?.trim() || profile.brief.trim() || gt("Specialist bot");
  const riskLabel =
    riskLevel === "careful" ? gt("Careful") : riskLevel === "normal" ? gt("Normal") : gt("YOLO");
  const askLeadLabel = lead
    ? gt("Ask {name} to change this bot", { name: lead.title })
    : gt("Ask the lead to change this bot");
  const crewUsage = workspace.bots.filter(
    (candidate) => candidate.source.dropwaveBot?.personaId === profile.personaId,
  ).length;

  const removeFromProject = async () => {
    if (pending || !canOperate) return;
    const confirmed = await requestConfirmDialog(
      gt("Remove {name} from this project? It stays in your crew and can be added again.", {
        name: bot.title,
      }),
    );
    if (!confirmed) return;
    setPending(true);
    const result = await archive({
      environmentId,
      input: { threadId: bot.id },
    }).catch(() => null);
    setPending(false);
    if (result === null) {
      setError(gt("Couldn’t remove the bot. Try again."));
      return;
    }
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : gt("Couldn’t remove the bot. Try again."));
      return;
    }
    onClose();
  };

  const deleteFromCrew = async () => {
    if (pending || !canOperate || profile.personaId === undefined) return;
    const confirmed = await requestConfirmDialog(
      crewUsage > 1
        ? gt(
            "Delete {name} from your crew? {count} bots use this persona and will keep working, but the shared identity is gone.",
            { name: bot.title, count: crewUsage },
          )
        : gt(
            "Delete {name} from your crew? This removes the shared persona everywhere; the bot here is removed too.",
            { name: bot.title },
          ),
    );
    if (!confirmed) return;
    setPending(true);
    const result = await deletePersona({
      environmentId,
      input: { id: profile.personaId },
    }).catch(() => null);
    if (result !== null && result._tag === "Success" && result.value.deleted) {
      await archive({ environmentId, input: { threadId: bot.id } }).catch(() => undefined);
    }
    setPending(false);
    if (result === null || result._tag === "Failure") {
      if (result?._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const cause = squashAtomCommandFailure(result);
        setError(cause instanceof Error ? cause.message : gt("Couldn’t delete the persona."));
      } else if (result === null) {
        setError(gt("Couldn’t delete the persona. Try again."));
      }
      return;
    }
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogPopup data-dropwave-editor="" data-dw-botprofile="">
        <DialogHeader>
          <div data-dw-botprofile-head="">
            <DropwaveBotAvatar
              name={bot.title}
              seed={profile.avatarSeed}
              role="specialist"
              size="lg"
            />
            <div>
              <DialogTitle>{bot.title}</DialogTitle>
              <DialogDescription>{roleLine}</DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogPanel>
          <div data-dw-botprofile-body="">
            <dl data-dw-botprofile-facts="">
              <div>
                <dt>
                  <T>Model</T>
                </dt>
                <dd>
                  {modelName !== null ? (
                    <>
                      {modelEntry?.displayName ? `${modelEntry.displayName} · ` : ""}
                      {modelName}
                    </>
                  ) : (
                    <T>Project default</T>
                  )}
                </dd>
              </div>
              <div>
                <dt>
                  <T>Allowed to do</T>
                </dt>
                <dd>{gt("{risk} risk. Follows this project’s setting.", { risk: riskLabel })}</dd>
              </div>
              <div>
                <dt>
                  <T>Memories</T>
                </dt>
                <dd>
                  <button
                    type="button"
                    data-dw-botprofile-memlink=""
                    onClick={() => {
                      workspace.setMainView("docs", { docsTab: "memory" });
                      onClose();
                    }}
                  >
                    <T>
                      <Var>{memoryCount}</Var> saved. Open Memory
                    </T>
                  </button>
                </dd>
              </div>
            </dl>
            {error ? (
              <p data-dropwave-form-error="" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </DialogPanel>
        <DialogFooter>
          <div data-dw-botprofile-actions="">
            <button
              type="button"
              data-dw-btn-ghost=""
              disabled={pending}
              onClick={() => {
                workspace.openThread(scopeThreadRef(bot.environmentId, bot.id));
                onClose();
              }}
            >
              <MessageSquareIcon className="size-3.5" />
              <T>Open chat</T>
            </button>
            <button
              type="button"
              data-dw-btn-ghost=""
              disabled={pending}
              onClick={() => {
                if (lead) {
                  workspace.prefillComposer(
                    scopeThreadRef(lead.environmentId, lead.id),
                    gt("I’d like to change {name}: ", { name: bot.title }),
                  );
                }
                onClose();
              }}
            >
              <MessageSquareIcon className="size-3.5" />
              {askLeadLabel}
            </button>
            <button
              type="button"
              data-dw-btn-ghost=""
              data-tone="drop"
              disabled={pending || !canOperate}
              onClick={() => void removeFromProject()}
            >
              <UserRoundXIcon className="size-3.5" />
              <T>Remove from project</T>
            </button>
            {profile.personaId !== undefined ? (
              <button
                type="button"
                data-dw-btn-ghost=""
                data-tone="drop"
                disabled={pending || !canOperate}
                onClick={() => void deleteFromCrew()}
              >
                <Trash2Icon className="size-3.5" />
                <T>Delete from crew</T>
              </button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
