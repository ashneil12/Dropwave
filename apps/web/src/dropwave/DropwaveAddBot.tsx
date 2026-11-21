import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  AuthOrchestrationOperateScope,
  DEFAULT_SERVER_SETTINGS,
  type DropwaveBotProfile,
  type DropwavePersona,
  type ModelSelection,
  type ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { T, Var, useGT } from "gt-react";
import { BotIcon, ChevronDownIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";

import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { newThreadId } from "../lib/utils";
import {
  providerInstanceEntriesFor,
  resolveProjectDefaultProviderModelSelection,
} from "../providerInstances";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readEnvironmentProviders } from "../state/environments";
import { environmentServerConfigsAtom, serverEnvironment } from "../state/server";
import { useEnvironmentScope } from "../state/session";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { DropwaveBotAvatar } from "./DropwaveBotAvatar";
import { DropwaveSelect } from "./DropwaveSelect";
import { useDropwaveWorkspace } from "./workspaceContext";

const SETUP_SHIMMER_MS = 1100;

/**
 * One-step "Add a bot" sheet: reuse a crew persona in one click, or describe a
 * new bot in two fields. The Lead writes its soul and role afterwards.
 */
export function DropwaveAddBot({
  project,
  lead,
  onClose,
}: {
  project: EnvironmentProject;
  lead: EnvironmentThreadShell;
  onClose: () => void;
}) {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const environmentId = project.environmentId;
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);

  const [personas, setPersonas] = useState<ReadonlyArray<DropwavePersona> | null>(null);
  const [name, setName] = useState("");
  const [what, setWhat] = useState("");
  const [modelKey, setModelKey] = useState("default");
  const [moreOpen, setMoreOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [setup, setSetup] = useState<{ name: string; threadId: ThreadId } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const listPersonas = useAtomCommand(serverEnvironment.dropwavePersonaList, {
    reportFailure: false,
  });
  const botAdded = useAtomCommand(serverEnvironment.dropwaveBotAdded, { reportFailure: false });
  const create = useOrchestrationCommand(threadEnvironment.create, { reportFailure: false });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads global crew personas
  useEffect(() => {
    let cancelled = false;
    void listPersonas({ environmentId, input: {} }).then((res) => {
      if (cancelled) return;
      if (res._tag === "Success") setPersonas(res.value.items);
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, listPersonas]);

  if (!workspace) return null;

  const usedPersonaIds = new Set(
    workspace.bots
      .filter((bot) => bot.projectId === project.id)
      .map((bot) => bot.source.dropwaveBot?.personaId)
      .filter((id): id is string => typeof id === "string"),
  );
  const crew = (personas ?? []).filter((persona) => !usedPersonaIds.has(persona.id));

  const providers = readEnvironmentProviders(environmentId) ?? [];
  const settings =
    appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.settings ??
    DEFAULT_SERVER_SETTINGS;
  const projectSettings = resolveProjectSettings(settings, project.id).settings;
  const available = providerInstanceEntriesFor(providers, settings, project.id).filter(
    (entry) => entry.enabled && entry.isAvailable,
  );
  const defaultSelection =
    project.defaultModelSelection &&
    available.some(
      (entry) =>
        entry.instanceId === project.defaultModelSelection?.instanceId &&
        entry.enabled &&
        entry.isAvailable,
    )
      ? project.defaultModelSelection
      : resolveProjectDefaultProviderModelSelection(providers, settings, project.id);

  const modelOptions = [
    { value: "default", label: gt("Project default") },
    ...available.flatMap((entry) =>
      entry.models.map((model) => ({
        value: `${entry.instanceId}::${model.slug}`,
        label: `${entry.displayName} · ${model.name}`,
      })),
    ),
  ];
  const pickedSelection: ModelSelection | null =
    modelKey === "default"
      ? null
      : (() => {
          const [instanceId, model] = modelKey.split("::");
          return instanceId && model ? ({ instanceId, model } as ModelSelection) : null;
        })();

  const saveError = (cause: unknown) =>
    cause instanceof Error ? cause.message : gt("The bot couldn’t be added. Try again.");

  const finishSetup = (botName: string, threadId: ThreadId) => {
    setSetup({ name: botName, threadId });
    window.setTimeout(() => {
      onClose();
      workspace.openThread(scopeThreadRef(environmentId, threadId));
    }, SETUP_SHIMMER_MS);
  };

  const notifyLead = (botName: string, brief: string, threadId: ThreadId) => {
    void botAdded({
      environmentId,
      input: {
        projectId: project.id,
        leadThreadId: lead.id,
        teammateThreadId: threadId,
        name: botName,
        brief,
      },
    }).catch(() => undefined);
  };

  const createBot = async (input: {
    title: string;
    brief: string;
    profile: DropwaveBotProfile;
  }) => {
    if (pending || !canOperate) return;
    setError(null);
    const modelSelection = pickedSelection ?? defaultSelection;
    if (!modelSelection) {
      setError(gt("Connect an agent provider in Settings, then try again."));
      return;
    }
    const threadId = newThreadId();
    setPending(true);
    const result = await create({
      environmentId,
      input: {
        threadId,
        projectId: project.id,
        title: input.title,
        dropwaveBot: input.profile,
        modelSelection,
        runtimeMode: projectSettings.defaultRuntimeMode,
        interactionMode: "default",
        branch: null,
        worktreePath: null,
      },
    }).catch((cause: unknown) => {
      setError(saveError(cause));
      return null;
    });
    setPending(false);
    if (result === null) return;
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setError(saveError(squashAtomCommandFailure(result)));
      return;
    }
    notifyLead(input.title, input.brief, threadId);
    finishSetup(input.title, threadId);
  };

  const addFromCrew = (persona: DropwavePersona) => {
    void createBot({
      title: persona.name,
      brief: persona.roleLabel || persona.name,
      profile: {
        kind: "teammate",
        brief: persona.roleLabel || persona.name,
        leadThreadId: lead.id,
        role: persona.roleLabel,
        personaId: persona.id,
        avatarSeed: persona.avatarSeed,
        ...(persona.soul ? { soul: persona.soul } : {}),
      },
    });
  };

  const addNew = () => {
    const title = name.trim();
    const brief = what.trim();
    if (title === "") {
      setError(gt("Enter a name."));
      return;
    }
    void createBot({
      title,
      brief,
      profile: { kind: "teammate", brief, leadThreadId: lead.id },
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending && setup === null) onClose();
      }}
    >
      <DialogPopup data-dropwave-editor="" data-dw-addbot="">
        {setup !== null ? (
          <DialogPanel>
            <div data-dw-addbot-setup="">
              <DropwaveBotAvatar name={setup.name} role="specialist" size="lg" />
              <strong>{gt("Setting up {name}…", { name: setup.name })}</strong>
              <p>
                <T>
                  <Var>{lead.title}</Var> is writing its role and wiring it into the team. You’ll
                  land in its chat in a moment.
                </T>
              </p>
            </div>
          </DialogPanel>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              addNew();
            }}
            aria-busy={pending}
          >
            <DialogHeader>
              <DialogTitle>
                <T>Add a bot</T>
              </DialogTitle>
              <DialogDescription>
                <T>
                  Bots are specialists <Var>{lead.title}</Var> can hand work to. Pick someone from
                  your crew, or describe a new one. <Var>{lead.title}</Var> sets it up.
                </T>
              </DialogDescription>
            </DialogHeader>

            <DialogPanel>
              <div data-dw-addbot-body="">
                {crew.length > 0 ? (
                  <section data-dw-addbot-crew="">
                    <h3>
                      <T>From your crew</T>
                    </h3>
                    <div data-dw-addbot-crew-grid="">
                      {crew.map((persona) => (
                        <button
                          key={persona.id}
                          type="button"
                          data-dw-addbot-crew-card=""
                          disabled={pending || !canOperate}
                          onClick={() => addFromCrew(persona)}
                        >
                          <DropwaveBotAvatar
                            name={persona.name}
                            seed={persona.avatarSeed}
                            role="specialist"
                            size="md"
                          />
                          <span data-dw-addbot-crew-meta="">
                            <strong>{persona.name}</strong>
                            <small>{persona.roleLabel || persona.role}</small>
                          </span>
                          <PlusIcon className="size-3.5 opacity-60" />
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                <section data-dw-addbot-new="">
                  <h3>
                    <T>New bot</T>
                  </h3>
                  <label data-dw-field-label="">
                    <span>
                      <T>Name</T>
                    </span>
                    <input
                      data-dw-custom-answer=""
                      value={name}
                      onChange={(event) => setName(event.currentTarget.value)}
                      placeholder={gt("e.g. Quill, Scout, Nova")}
                      maxLength={80}
                    />
                  </label>
                  <label data-dw-field-label="">
                    <span>
                      <T>What should it do?</T>
                    </span>
                    <textarea
                      data-dw-custom-answer=""
                      data-dw-addbot-what=""
                      value={what}
                      onChange={(event) => setWhat(event.currentTarget.value)}
                      placeholder={gt(
                        "One or two sentences, e.g. keeps docs and release notes tidy.",
                      )}
                      rows={2}
                      maxLength={500}
                    />
                  </label>
                  <button
                    type="button"
                    data-dw-addbot-more=""
                    aria-expanded={moreOpen}
                    onClick={() => setMoreOpen((open) => !open)}
                  >
                    <ChevronDownIcon
                      className="size-3.5"
                      style={moreOpen ? { transform: "rotate(180deg)" } : undefined}
                    />
                    <T>More</T>
                  </button>
                  {moreOpen ? (
                    <label data-dw-field-label="">
                      <span>
                        <T>Model</T>
                      </span>
                      <DropwaveSelect
                        value={modelKey}
                        options={modelOptions}
                        onChange={setModelKey}
                        ariaLabel={gt("Model")}
                      />
                    </label>
                  ) : null}
                </section>

                {error ? (
                  <p data-dropwave-form-error="" role="alert">
                    {error}
                  </p>
                ) : null}
              </div>
            </DialogPanel>

            <DialogFooter>
              <button type="button" data-dw-btn-ghost="" onClick={onClose} disabled={pending}>
                <T>Cancel</T>
              </button>
              <button type="submit" data-dw-btn-solid="" disabled={pending || !canOperate}>
                <BotIcon className="size-3.5" />
                {pending ? <T>Adding…</T> : <T>Add bot</T>}
              </button>
            </DialogFooter>
          </form>
        )}
      </DialogPopup>
    </Dialog>
  );
}
