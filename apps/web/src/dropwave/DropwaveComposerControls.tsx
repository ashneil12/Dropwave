import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { ProviderInstanceId, RuntimeMode } from "@t3tools/contracts";
import { createModelSelection, normalizeModelSlug } from "@t3tools/shared/model";
import { useNavigate } from "@tanstack/react-router";
import { useMessages } from "gt-react";
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
import { useComposerDraftStore } from "../composerDraftStore";
import { useEnvironmentSettings } from "../hooks/useSettings";
import { useStableCallback } from "../hooks/useStableCallback";
import { getAppModelOptionsForInstance } from "../modelSelection";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useEnvironmentProviders } from "../state/environments";
import { environmentServerConfigsAtom } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";

/**
 * Full T3 multi-provider model picker (all providers, provider icons, custom models,
 * reasoning effort, Fast/Ultracode) + Runtime Permissions Access (Full access / Supervised)
 * rendered cleanly inside Dropwave's frosted glass composer.
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
  const m = useMessages();
  const [pickerOpen, setPickerOpen] = useState(false);

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
    </div>
  );
}
