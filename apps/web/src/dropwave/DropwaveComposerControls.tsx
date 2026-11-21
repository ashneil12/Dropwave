import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { ProviderInstanceId, RuntimeMode } from "@t3tools/contracts";
import { createModelSelection, normalizeModelSlug } from "@t3tools/shared/model";
import { useNavigate } from "@tanstack/react-router";
import { T, useGT, useMessages } from "gt-react";
import { CheckIcon, ChevronDownIcon, CpuIcon } from "lucide-react";
import { useState } from "react";

import { ComposerFooterModeControls } from "../components/chat/ComposerFooterControls";
import {
  ComposerEffortColumn,
  ComposerPickerFooter,
  describeComposerEffort,
} from "../components/chat/ComposerModelEffort";
import { ProviderModelPicker } from "../components/chat/ProviderModelPicker";
import { readPromptUltrathink } from "../components/chat/TraitsPicker";
import {
  getComposerPromptInjectionState,
  resolveComposerTraitsInput,
} from "../components/chat/composerProviderState";
import {
  resolveCompatibleRuntimeMode,
  resolveRuntimeModeOptions,
} from "../components/chat/runtimeModeConfig";
import { useApplyThreadModelPick } from "../components/chat/useApplyThreadModelPick";
import { useComposerProviderModel } from "../components/chat/useComposerProviderModel";
import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { useComposerDraftStore } from "../composerDraftStore";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { useStableCallback } from "../hooks/useStableCallback";
import { getAppModelOptionsForInstance } from "../modelSelection";
import type { ProviderInstanceEntry } from "../providerInstances";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useEnvironmentProviders } from "../state/environments";
import { environmentServerConfigsAtom } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";

const CHEAP_MODEL_PATTERN = /mini|nano|flash|lite|haiku|small|fast|turbo|spark|instant/i;

/** Cheapest-looking or strongest-looking model on a provider entry, derived live. */
function pickEntryModel(
  entry: ProviderInstanceEntry,
  prefer: "cheap" | "strong",
): { instanceId: ProviderInstanceId; model: string; label: string } | null {
  const models = entry.models.filter(
    (model) => model.supportsTextGeneration !== false && model.isLegacy !== true,
  );
  if (models.length === 0) return null;
  const isCheap = (model: (typeof models)[number]) =>
    CHEAP_MODEL_PATTERN.test(`${model.slug} ${model.name} ${model.shortName ?? ""}`);
  const cheap = models.find(isCheap);
  const strong =
    models.find((model) => model.isDefault === true && !isCheap(model)) ??
    models.find((model) => !isCheap(model));
  const pick =
    prefer === "cheap"
      ? (cheap ?? models.find((model) => model.isDefault === true) ?? models[0])
      : (strong ?? models.find((model) => model.isDefault === true) ?? models[0]);
  return pick === undefined
    ? null
    : { instanceId: entry.instanceId, model: pick.slug, label: pick.name };
}

/**
 * Full T3 multi-provider model picker (all providers, provider icons, custom models,
 * reasoning effort, Fast/Ultracode) + Runtime Permissions Access (Full access / Supervised)
 * + Devin-style Child Capability (Workers model) selector for Lead bots.
 */
export function DropwaveComposerControls({
  thread,
  project,
  prompt,
  onPromptEdit,
  disabled,
}: {
  thread: EnvironmentThreadShell;
  project: EnvironmentProject | null;
  prompt: string;
  onPromptEdit: (edit: (prev: string) => string) => void;
  disabled: boolean;
}) {
  const navigate = useNavigate();
  const gt = useGT();
  const m = useMessages();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [childOpen, setChildOpen] = useState(false);

  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const providersByEnv = useEnvironmentProviders();
  const providerStatuses = providersByEnv.get(thread.environmentId) ?? [];
  const serverConfig = appAtomRegistry.get(environmentServerConfigsAtom).get(thread.environmentId);
  const settings = useEnvironmentSettings(thread.environmentId);
  const keybindings = serverConfig?.keybindings ?? [];

  const setModelCmd = useOrchestrationCommand(threadEnvironment.setModelSelection, {
    reportFailure: false,
  });
  const setRuntimeModeCmd = useOrchestrationCommand(threadEnvironment.setRuntimeMode, {
    reportFailure: false,
  });
  const updateMetadataCmd = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const applyThreadModelPick = useApplyThreadModelPick();
  const applyRouteThreadModelPick = useStableCallback(() => applyThreadModelPick(threadRef));

  const promptInjectionState = getComposerPromptInjectionState(prompt);
  const {
    providerInstanceEntries,
    selectedProviderEntry,
    selectedInstanceId,
    selectedProvider,
    selectedModel,
    selectedProviderModels,
    composerModelOptions,
    composerProviderState,
  } = useComposerProviderModel({
    providerStatuses,
    settings,
    activeProjectId: thread.projectId,
    threadRef,
    threadModelSelection: thread.source.modelSelection,
    projectModelSelection: project?.defaultModelSelection ?? null,
    promptInjectionState,
    candidateInstanceIds: [thread.source.modelSelection.instanceId],
    lockedProvider: null,
    lockedInstanceId: null,
    threadStarted: thread.latestRun !== null,
  });

  const modelOptionsByInstance = new Map(
    providerInstanceEntries.map((entry) => [
      entry.instanceId,
      getAppModelOptionsForInstance(
        settings,
        entry,
        entry.instanceId === selectedInstanceId ? selectedModel : null,
      ),
    ]),
  );
  const currentOptions = modelOptionsByInstance.get(selectedInstanceId) ?? [];
  const selectedModelForPicker = currentOptions.some((o) => o.slug === selectedModel)
    ? selectedModel
    : (normalizeModelSlug(selectedModel, selectedProvider) ?? selectedModel);

  const { modes: compatibleModes, mode: compatibleRuntimeMode } = resolveCompatibleRuntimeMode(
    thread.source.runtimeMode,
    selectedProviderEntry?.snapshot.supportedRuntimeModes,
  );
  const runtimeModeOptions = resolveRuntimeModeOptions(compatibleModes, undefined, m);

  const traitsInput = resolveComposerTraitsInput({
    provider: selectedProvider,
    instanceId: selectedInstanceId,
    threadRef,
    onDraftModelOptionsChange: applyRouteThreadModelPick,
    model: selectedModel,
    models: selectedProviderModels,
    modelOptions: composerModelOptions?.[selectedInstanceId],
    reportedModelSelection: thread.source.modelSelection,
    promptUltrathink: readPromptUltrathink(prompt),
    onPromptEdit,
  });
  const effort = describeComposerEffort(traitsInput, settings.effortDisplay, "sm", m);

  const handleModelChange = (instanceId: ProviderInstanceId, model: string) => {
    useComposerDraftStore
      .getState()
      .setModelSelection(threadRef, createModelSelection(instanceId, model), { explicit: true });
    void setModelCmd({
      environmentId: thread.environmentId,
      input: {
        threadId: thread.id,
        modelSelection: {
          instanceId,
          model,
        },
      },
    });
  };

  const handleRuntimeModeChange = (mode: RuntimeMode) => {
    void setRuntimeModeCmd({
      environmentId: thread.environmentId,
      input: {
        threadId: thread.id,
        runtimeMode: mode,
      },
    });
  };

  // Child Capability (Worker Model) + Fusion reviewer for Lead bots — routes
  // delegated worktree tasks and optionally has a fresh-context reviewer check
  // each worker diff before the lead hears the outcome.
  const leadProfile = thread.source.dropwaveBot?.kind === "lead" ? thread.source.dropwaveBot : null;
  const workerModel = leadProfile?.workerModelSelection ?? null;
  const reviewModel = leadProfile?.workerReviewModelSelection ?? null;
  const reviewRounds = leadProfile?.workerReviewRounds ?? 1;
  const availableWorkerChoices: Array<{
    readonly key: string;
    readonly instanceId: ProviderInstanceId;
    readonly model: string;
    readonly label: string;
    readonly providerName: string;
  }> = [];
  if (leadProfile) {
    for (const entry of providerInstanceEntries) {
      if (!entry.enabled || !entry.isAvailable) continue;
      for (const opt of entry.models.slice(0, 6)) {
        availableWorkerChoices.push({
          key: `${entry.instanceId}::${opt.slug}`,
          instanceId: entry.instanceId,
          model: opt.slug,
          label: opt.name,
          providerName: entry.displayName,
        });
      }
    }
  }
  const choiceLabel = (instanceId: ProviderInstanceId, model: string) =>
    availableWorkerChoices.find((c) => c.instanceId === instanceId && c.model === model)?.label ??
    model;
  const workerLabel = workerModel ? choiceLabel(workerModel.instanceId, workerModel.model) : null;
  const reviewLabel = reviewModel ? choiceLabel(reviewModel.instanceId, reviewModel.model) : null;
  const activeWorkerLabel = reviewModel
    ? workerLabel !== null
      ? gt("Workers: {worker} + {reviewer} review", {
          worker: workerLabel,
          reviewer: reviewLabel,
        })
      : gt("Workers: Auto + {reviewer} review", { reviewer: reviewLabel })
    : gt("Workers: {worker}", { worker: workerLabel ?? gt("Auto") });

  const [workerSetupRow, setWorkerSetupRow] = useState<"work" | "review" | "rounds" | null>(null);

  const applyWorkerSetup = (setup: {
    readonly worker: { instanceId: ProviderInstanceId; model: string } | null;
    readonly review: { instanceId: ProviderInstanceId; model: string } | null;
    readonly rounds: number;
  }) => {
    if (!leadProfile) return;
    const {
      workerModelSelection: _prevWorker,
      workerReviewModelSelection: _prevReview,
      workerReviewRounds: _prevRounds,
      ...rest
    } = leadProfile;
    void updateMetadataCmd({
      environmentId: thread.environmentId,
      input: {
        threadId: thread.id,
        dropwaveBot: {
          ...rest,
          ...(setup.worker ? { workerModelSelection: setup.worker } : {}),
          ...(setup.review
            ? {
                workerReviewModelSelection: setup.review,
                workerReviewRounds: setup.rounds,
              }
            : {}),
        },
      },
    });
    setChildOpen(false);
    setWorkerSetupRow(null);
  };

  const usableEntries = providerInstanceEntries.filter(
    (entry) => entry.enabled && entry.isAvailable,
  );
  const leadEntry =
    usableEntries.find((entry) => entry.instanceId === thread.source.modelSelection.instanceId) ??
    usableEntries[0];

  const applyFusionPreset = () => {
    const executor = leadEntry ? pickEntryModel(leadEntry, "cheap") : null;
    if (executor === null) return;
    const reviewerEntries = usableEntries.filter(
      (entry) => entry.instanceId !== executor.instanceId,
    );
    const reviewerEntry =
      reviewerEntries.find(
        (entry) => entry.driverKind === "codex" || entry.driverKind === "claudeAgent",
      ) ?? reviewerEntries[0];
    const reviewerPick = reviewerEntry ? pickEntryModel(reviewerEntry, "strong") : null;
    applyWorkerSetup({
      worker: { instanceId: executor.instanceId, model: executor.model },
      review: reviewerPick ?? {
        instanceId: thread.source.modelSelection.instanceId,
        model: thread.source.modelSelection.model,
      },
      rounds: 1,
    });
  };

  const applySoloPreset = () => {
    const executor = leadEntry ? pickEntryModel(leadEntry, "cheap") : null;
    applyWorkerSetup({
      worker:
        executor !== null
          ? { instanceId: executor.instanceId, model: executor.model }
          : workerModel,
      review: null,
      rounds: reviewRounds,
    });
  };

  const workerKey = workerModel ? `${workerModel.instanceId}::${workerModel.model}` : "auto";
  const reviewKey = reviewModel ? `${reviewModel.instanceId}::${reviewModel.model}` : "off";
  const workRowOptions: ReadonlyArray<{ value: string; label: string; hint: string }> = [
    {
      value: "auto",
      label: gt("Same as Lead (Auto)"),
      hint: gt("Inherits main agent model"),
    },
    ...availableWorkerChoices.map((choice) => ({
      value: choice.key,
      label: choice.label,
      hint: choice.providerName,
    })),
  ];
  const reviewRowOptions: ReadonlyArray<{ value: string; label: string; hint: string }> = [
    { value: "off", label: gt("Off"), hint: gt("No review before landing") },
    ...availableWorkerChoices.map((choice) => ({
      value: choice.key,
      label: choice.label,
      hint: choice.providerName,
    })),
  ];
  const roundsRowOptions = ([0, 1, 2, 3] as const).map((rounds) => ({
    value: String(rounds),
    label:
      rounds === 0
        ? gt("No fix rounds")
        : rounds === 1
          ? gt("1 fix round")
          : gt("{count} fix rounds", { count: rounds }),
    hint: "",
  }));

  return (
    <div data-dw-t3-controls="">
      <ProviderModelPicker
        environmentId={thread.environmentId}
        workspaceCwd={thread.worktreePath ?? project?.workspaceRoot ?? null}
        compact={false}
        isComposerOwned
        popupAlign="start"
        disabled={disabled}
        activeInstanceId={selectedInstanceId}
        model={selectedModelForPicker}
        lockedProvider={null}
        lockedContinuationGroupKey={null}
        instanceEntries={providerInstanceEntries}
        keybindings={keybindings}
        modelOptionsByInstance={modelOptionsByInstance}
        size="sm"
        triggerClassName="min-w-13"
        triggerSuffix={effort.suffix}
        triggerDetail={effort.detail}
        triggerShortcuts="composer.effort composer.mode"
        effortColumn={<ComposerEffortColumn traits={traitsInput} />}
        footer={
          <ComposerPickerFooter
            traits={traitsInput}
            runtimeMode={compatibleRuntimeMode}
            runtimeModeOptions={runtimeModeOptions}
            onRuntimeModeChange={handleRuntimeModeChange}
          />
        }
        terminalOpen={false}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onInstanceModelChange={handleModelChange}
        onOpenProviderSetup={() => {
          void navigate({ to: "/settings/providers" });
        }}
        {...(composerProviderState.modelPickerIconClassName
          ? { activeProviderIconClassName: composerProviderState.modelPickerIconClassName }
          : {})}
      />

      <ComposerFooterModeControls
        runtimeMode={compatibleRuntimeMode}
        runtimeModeOptions={runtimeModeOptions}
        size="sm"
        accessDisplay="label"
        emphasized={compatibleRuntimeMode !== "full-access"}
        onRuntimeModeChange={handleRuntimeModeChange}
      />

      {leadProfile && availableWorkerChoices.length > 0 ? (
        <Popover
          open={childOpen}
          onOpenChange={(open) => {
            setChildOpen(open);
            if (!open) setWorkerSetupRow(null);
          }}
        >
          <PopoverTrigger
            type="button"
            data-dw-child-cap-btn=""
            aria-label={gt("Child worker capability")}
          >
            <CpuIcon className="size-3 opacity-70" />
            <span>{activeWorkerLabel}</span>
            <ChevronDownIcon className="size-3 opacity-55" />
          </PopoverTrigger>
          <PopoverPopup align="start" width="md" padding="compact" data-dropwave-popover="">
            <div data-dw-worker-setup="">
              <span data-dw-slot-menu-title="">
                <T>Worker setup</T>
              </span>
              <div data-dw-worker-presets="">
                <button type="button" data-dw-worker-preset="" onClick={applyFusionPreset}>
                  <strong>
                    <T>Fusion</T>
                  </strong>
                  <small>
                    <T>Fast worker, careful reviewer</T>
                  </small>
                </button>
                <button type="button" data-dw-worker-preset="" onClick={applySoloPreset}>
                  <strong>
                    <T>Solo</T>
                  </strong>
                  <small>
                    <T>Worker only, no review</T>
                  </small>
                </button>
              </div>
              <WorkerSetupRow
                title={gt("Does the work")}
                current={workerLabel ?? gt("Same as Lead (Auto)")}
                options={workRowOptions}
                selectedValue={workerKey}
                expanded={workerSetupRow === "work"}
                onToggle={() => setWorkerSetupRow((row) => (row === "work" ? null : "work"))}
                onSelect={(value) => {
                  if (value === "auto") {
                    applyWorkerSetup({ worker: null, review: reviewModel, rounds: reviewRounds });
                    return;
                  }
                  const choice = availableWorkerChoices.find((c) => c.key === value);
                  if (choice) {
                    applyWorkerSetup({
                      worker: { instanceId: choice.instanceId, model: choice.model },
                      review: reviewModel,
                      rounds: reviewRounds,
                    });
                  }
                }}
              />
              <WorkerSetupRow
                title={gt("Checks the work")}
                current={reviewLabel ?? gt("Off")}
                options={reviewRowOptions}
                selectedValue={reviewKey}
                expanded={workerSetupRow === "review"}
                onToggle={() => setWorkerSetupRow((row) => (row === "review" ? null : "review"))}
                onSelect={(value) => {
                  if (value === "off") {
                    applyWorkerSetup({ worker: workerModel, review: null, rounds: reviewRounds });
                    return;
                  }
                  const choice = availableWorkerChoices.find((c) => c.key === value);
                  if (choice) {
                    applyWorkerSetup({
                      worker: workerModel,
                      review: { instanceId: choice.instanceId, model: choice.model },
                      rounds: reviewRounds,
                    });
                  }
                }}
              />
              {reviewModel ? (
                <WorkerSetupRow
                  title={gt("Fix rounds")}
                  current={
                    reviewRounds === 0
                      ? gt("No fix rounds")
                      : reviewRounds === 1
                        ? gt("1 fix round")
                        : gt("{count} fix rounds", { count: reviewRounds })
                  }
                  options={roundsRowOptions}
                  selectedValue={String(reviewRounds)}
                  expanded={workerSetupRow === "rounds"}
                  onToggle={() => setWorkerSetupRow((row) => (row === "rounds" ? null : "rounds"))}
                  onSelect={(value) => {
                    const rounds = Number.parseInt(value, 10);
                    if (Number.isInteger(rounds) && rounds >= 0 && rounds <= 3) {
                      applyWorkerSetup({
                        worker: workerModel,
                        review: reviewModel,
                        rounds,
                      });
                    }
                  }}
                />
              ) : null}
            </div>
          </PopoverPopup>
        </Popover>
      ) : null}
    </div>
  );
}

function WorkerSetupRow({
  title,
  current,
  options,
  selectedValue,
  expanded,
  onToggle,
  onSelect,
}: {
  title: string;
  current: string;
  options: ReadonlyArray<{ value: string; label: string; hint: string }>;
  selectedValue: string;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (value: string) => void;
}) {
  return (
    <div data-dw-worker-row="">
      <button type="button" data-dw-worker-row-head="" aria-expanded={expanded} onClick={onToggle}>
        <span data-dw-worker-row-title="">{title}</span>
        <span data-dw-worker-row-value="">{current}</span>
        <ChevronDownIcon
          className="size-3.5 shrink-0 opacity-55"
          data-expanded={expanded ? "true" : undefined}
        />
      </button>
      {expanded ? (
        <div data-dw-select-list="" role="listbox" aria-label={title}>
          {options.map((opt) => {
            const selected = opt.value === selectedValue;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={selected}
                data-dw-select-opt=""
                onClick={() => {
                  onSelect(opt.value);
                }}
              >
                <span data-dw-select-opt-text="">
                  <strong>{opt.label}</strong>
                  {opt.hint ? <small>{opt.hint}</small> : null}
                </span>
                {selected ? (
                  <CheckIcon className="size-3.5 shrink-0" data-dw-icon="indigo" />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
