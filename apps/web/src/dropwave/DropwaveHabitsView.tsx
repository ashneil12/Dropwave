import { useAtomValue } from "@effect/atom-react";
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
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  type ScheduledTask,
  type ScheduledTaskUpsertSchedule,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { T, Var, useGT } from "gt-react";
import {
  CalendarClockIcon,
  MessageSquareIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  RepeatIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useNowSecond } from "../hooks/useNowSecond";
import { useClientSettings } from "../hooks/useSettings";

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
import { formatUpcomingTimestamp } from "../timestampFormat";
import { resolveProjectDefaultProviderModelSelection } from "../providerInstances";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readEnvironmentProviders } from "../state/environments";
import { environmentServerConfigsAtom, serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { DropwaveBotAvatar } from "./DropwaveBotAvatar";
import {
  cadenceInWords,
  habitPromptFallback,
  whenFromSchedule,
  whenToSchedule,
  type HabitPreset,
} from "./DropwaveHabits.logic";
import { DropwaveSelect, type DropwaveSelectOption } from "./DropwaveSelect";
import { useDropwaveWorkspace } from "./workspaceContext";

function lastRunLabel(status: string, gt: (message: string) => string): string {
  switch (status) {
    case "succeeded":
      return gt("Passed");
    case "failed":
      return gt("Failed");
    case "running":
      return gt("Running");
    default:
      return gt("Never");
  }
}

function lastRunBadge(status: string): "emerald" | "coral" | "violet" | undefined {
  switch (status) {
    case "succeeded":
      return "emerald";
    case "failed":
      return "coral";
    case "running":
      return "violet";
    default:
      return undefined;
  }
}

export function DropwaveHabitsView() {
  const workspace = useDropwaveWorkspace();
  const project = workspace?.project ?? null;
  const envId = project?.environmentId ?? workspace?.projects[0]?.environmentId ?? null;

  if (!workspace || !envId) {
    return (
      <div data-dropwave-panel-empty="">
        <CalendarClockIcon />
        <p>
          <T>Link a project to set up recurring Habits across your agents.</T>
        </p>
      </div>
    );
  }

  return <DropwaveHabitsContent envId={envId} />;
}

interface HabitSheetState {
  readonly task: ScheduledTask | null;
  readonly project: EnvironmentProject;
}

function DropwaveHabitsContent({ envId }: { envId: EnvironmentId }) {
  const workspace = useDropwaveWorkspace()!;
  const gt = useGT();
  const project = workspace.project ?? null;

  const [scopeAll, setScopeAll] = useState(false);
  const [sheet, setSheet] = useState<HabitSheetState | null>(null);
  const [summaries, setSummaries] = useState<ReadonlyMap<string, string>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);

  const tasksResult = useAtomValue(
    serverEnvironment.scheduledTasksLive({ environmentId: envId, input: {} }),
  );
  const nowMs = useNowSecond();
  const timestampFormat = useClientSettings((s) => s.timestampFormat);

  const setEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    reportFailure: false,
  });
  const runNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, {
    reportFailure: false,
  });
  const deleteTask = useAtomCommand(serverEnvironment.deleteScheduledTask, {
    reportFailure: false,
  });
  const listSummaries = useAtomCommand(serverEnvironment.dropwaveHabitSummariesList, {
    reportFailure: false,
  });

  const allTasks: ReadonlyArray<ScheduledTask> = AsyncResult.isSuccess(tasksResult)
    ? tasksResult.value.tasks
    : [];
  const shownTasks =
    scopeAll || !project ? allTasks : allTasks.filter((task) => task.projectId === project.id);

  const summaryProjectsKey = JSON.stringify(
    [...new Set(shownTasks.map((task) => task.projectId))].sort(),
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads stored habit summaries per project
  useEffect(() => {
    const projectIds = JSON.parse(summaryProjectsKey) as ReadonlyArray<string>;
    if (projectIds.length === 0) return;
    let cancelled = false;
    void Promise.all(
      projectIds.map((projectId) =>
        listSummaries({
          environmentId: envId,
          input: { projectId: projectId as EnvironmentProject["id"] },
        }),
      ),
    ).then((results) => {
      if (cancelled) return;
      const next = new Map<string, string>();
      for (const res of results) {
        if (res._tag !== "Success") continue;
        for (const item of res.value.items) next.set(item.taskId, item.summary);
      }
      setSummaries(next);
    });
    return () => {
      cancelled = true;
    };
  }, [envId, listSummaries, summaryProjectsKey]);

  const ownerFor = (task: ScheduledTask): EnvironmentThreadShell | null =>
    workspace.bots.find((bot) => bot.id === task.threadId) ?? null;

  const toggleEnabled = async (task: ScheduledTask) => {
    setBusyId(task.id);
    await setEnabled({
      environmentId: envId,
      input: { id: task.id, enabled: !task.enabled },
    });
    setBusyId(null);
  };

  const removeTask = async (task: ScheduledTask) => {
    const confirmed = await requestConfirmDialog(
      gt("Delete the habit “{title}”? Its schedule stops and past runs stay in chat.", {
        title: task.title,
      }),
    );
    if (!confirmed) return;
    setBusyId(task.id);
    await deleteTask({ environmentId: envId, input: { id: task.id } });
    setBusyId(null);
  };

  const openCreate = () => {
    const target = project ?? workspace.projects[0] ?? null;
    if (target) setSheet({ task: null, project: target });
  };

  return (
    <section data-dw-habits-view="" aria-label={gt("Habits")}>
      <header data-dw-habits-head="">
        <div>
          <h2>
            <RepeatIcon className="size-4" data-dw-icon="indigo" />
            <T>Habits</T>
          </h2>
          <p>
            <T>
              Recurring routines your bots run automatically: QA sweeps, metrics digests, release
              checks, or content updates.
            </T>
          </p>
        </div>
        <div data-dw-habits-head-actions="">
          <div data-dw-canvas-tabs="" role="group" aria-label={gt("Habit scope")}>
            <button type="button" aria-selected={!scopeAll} onClick={() => setScopeAll(false)}>
              {project ? project.title : <T>This project</T>}
            </button>
            <button type="button" aria-selected={scopeAll} onClick={() => setScopeAll(true)}>
              <T>All projects</T>
            </button>
          </div>
          <button
            type="button"
            data-dw-btn-solid=""
            onClick={openCreate}
            disabled={!project && workspace.projects.length === 0}
          >
            <PlusIcon className="size-3.5" />
            <T>New habit</T>
          </button>
        </div>
      </header>

      <div data-dw-habit-list="">
        {shownTasks.map((task) => {
          const ownerProj = workspace.projects.find((p) => p.id === task.projectId);
          const owner = ownerFor(task);
          const ownerName = owner?.title ?? ownerProj?.title ?? gt("A bot");
          const summary = summaries.get(task.id) ?? habitPromptFallback(task.prompt);
          const agentMade = task.createdBy === "agent" || task.creationSource === "mcp";
          return (
            <article
              key={task.id}
              data-dw-habit-card=""
              data-paused={!task.enabled ? "true" : undefined}
            >
              <div data-dw-habit-main="">
                <div data-dw-habit-title-row="">
                  {owner ? (
                    <DropwaveBotAvatar
                      name={owner.title}
                      seed={owner.source.dropwaveBot?.avatarSeed}
                      role={owner.source.dropwaveBot?.kind === "lead" ? "lead" : "specialist"}
                      size="sm"
                    />
                  ) : null}
                  <span data-dw-habit-owner="">{ownerName}</span>
                  <strong>{task.title}</strong>
                  <span data-dw-habit-cadence="">{cadenceInWords(task, gt)}</span>
                  {agentMade ? (
                    <span data-dw-habit-by="">{gt("{name} set this up", { name: ownerName })}</span>
                  ) : null}
                </div>
                <p data-dw-habit-summary="">{summary}</p>
                <small data-dw-habit-meta="">
                  {task.nextRunAt ? (
                    <T>
                      Next{" "}
                      <Var>{formatUpcomingTimestamp(task.nextRunAt, timestampFormat, nowMs)}</Var>
                    </T>
                  ) : (
                    <T>Not scheduled</T>
                  )}
                  {" · "}
                  <T>Last run</T>{" "}
                  <span data-dw-badge={lastRunBadge(task.lastRunStatus)}>
                    {lastRunLabel(task.lastRunStatus, gt)}
                  </span>
                  {scopeAll && ownerProj ? (
                    <>
                      {" · "}
                      <span data-dw-badge="violet">{ownerProj.title}</span>
                    </>
                  ) : null}
                </small>
                <details data-dw-habit-instructions="">
                  <summary>
                    <T>Instructions</T>
                  </summary>
                  <p>{task.prompt}</p>
                </details>
              </div>

              <div data-dw-habit-actions="">
                {task.threadId ? (
                  <button
                    type="button"
                    data-dw-btn-ghost=""
                    onClick={() => workspace.openThread(scopeThreadRef(envId, task.threadId!))}
                  >
                    <MessageSquareIcon className="size-3" />
                    <T>Open in chat</T>
                  </button>
                ) : null}
                <button
                  type="button"
                  data-dw-btn-ghost=""
                  disabled={busyId === task.id}
                  onClick={() => void runNow({ environmentId: envId, input: { id: task.id } })}
                >
                  <PlayIcon className="size-3" />
                  <T>Run now</T>
                </button>
                <button
                  type="button"
                  data-dw-mini-icon=""
                  aria-label={task.enabled ? gt("Pause habit") : gt("Resume habit")}
                  disabled={busyId === task.id}
                  onClick={() => void toggleEnabled(task)}
                >
                  {task.enabled ? (
                    <PauseIcon className="size-3.5" />
                  ) : (
                    <PlayIcon className="size-3.5" />
                  )}
                </button>
                <button
                  type="button"
                  data-dw-mini-icon=""
                  aria-label={gt("Edit habit")}
                  disabled={busyId === task.id}
                  onClick={() => {
                    const ownerProj = workspace.projects.find((p) => p.id === task.projectId);
                    if (ownerProj) setSheet({ task, project: ownerProj });
                  }}
                >
                  <PencilIcon className="size-3.5" />
                </button>
                <button
                  type="button"
                  data-dw-mini-icon=""
                  aria-label={gt("Delete habit")}
                  disabled={busyId === task.id}
                  onClick={() => void removeTask(task)}
                >
                  <Trash2Icon className="size-3.5" />
                </button>
              </div>
            </article>
          );
        })}

        {shownTasks.length === 0 ? (
          <div data-dropwave-panel-empty="">
            <CalendarClockIcon />
            <p>
              <T>
                No habits yet. Add one and your bots sweep tests, docs, or metrics on a cadence.
              </T>
            </p>
            <button type="button" data-dw-btn-solid="" onClick={openCreate}>
              <PlusIcon className="size-3.5" />
              <T>New habit</T>
            </button>
          </div>
        ) : null}
      </div>

      {sheet ? <HabitSheet state={sheet} envId={envId} onClose={() => setSheet(null)} /> : null}
    </section>
  );
}

const CUSTOM_HOURS = [1, 2, 4, 6, 8, 12, 24] as const;

function HabitSheet({
  state,
  envId,
  onClose,
}: {
  state: HabitSheetState;
  envId: EnvironmentId;
  onClose: () => void;
}) {
  const workspace = useDropwaveWorkspace()!;
  const gt = useGT();
  const { task, project } = state;

  const botsForProject = (() => {
    const members = workspace.bots.filter(
      (bot) => bot.projectId === project.id && bot.environmentId === project.environmentId,
    );
    const lead = workspace.lead;
    const ordered = [
      ...(lead && lead.projectId === project.id ? [lead] : []),
      ...members.filter((bot) => bot.id !== lead?.id),
    ];
    return ordered.length > 0 ? ordered : members;
  })();

  const initialWhen = task ? whenFromSchedule(task.schedule) : null;
  const [title, setTitle] = useState(task?.title ?? "");
  const [prompt, setPrompt] = useState(task?.prompt ?? "");
  const [ownerThreadId, setOwnerThreadId] = useState<string>(
    task?.threadId ?? workspace.lead?.id ?? botsForProject[0]?.id ?? "",
  );
  const [preset, setPreset] = useState<HabitPreset>(initialWhen?.preset ?? "morning");
  const [time, setTime] = useState(initialWhen?.time ?? "09:00");
  const [hours, setHours] = useState(initialWhen?.hours ?? 24);
  const [paused, setPaused] = useState(task ? !task.enabled : false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upsertTask = useAtomCommand(serverEnvironment.upsertScheduledTask, {
    reportFailure: false,
  });
  const deleteTask = useAtomCommand(serverEnvironment.deleteScheduledTask, {
    reportFailure: false,
  });

  const presetOptions: ReadonlyArray<DropwaveSelectOption<HabitPreset>> = [
    { value: "morning", label: gt("Every morning") },
    { value: "weekday", label: gt("Every weekday") },
    { value: "monday", label: gt("Every Monday") },
    { value: "hourly", label: gt("Every hour") },
    { value: "custom", label: gt("Custom") },
  ];
  const hourOptions: ReadonlyArray<DropwaveSelectOption<string>> = CUSTOM_HOURS.map((h) => ({
    value: String(h),
    label: h === 24 ? gt("Every day") : gt("Every {h} hours", { h }),
  }));

  const owner = botsForProject.find((bot) => bot.id === ownerThreadId) ?? botsForProject[0];

  const schedule: ScheduledTaskUpsertSchedule = whenToSchedule({ preset, time, hours });
  const needsTime = preset === "morning" || preset === "weekday" || preset === "monday";
  const needsHours = preset === "custom";

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !owner) return;
    const trimmedTitle = title.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedTitle || !trimmedPrompt) return;

    const providers = readEnvironmentProviders(project.environmentId) ?? [];
    const settings =
      appAtomRegistry.get(environmentServerConfigsAtom).get(project.environmentId)?.settings ??
      DEFAULT_SERVER_SETTINGS;
    const modelSelection =
      owner.source.modelSelection ??
      project.defaultModelSelection ??
      resolveProjectDefaultProviderModelSelection(providers, settings, project.id);
    if (!modelSelection) {
      setError(gt("Connect a provider in Settings -> Providers & Models first."));
      return;
    }

    setBusy(true);
    setError(null);
    const res = await upsertTask({
      environmentId: project.environmentId,
      input: {
        ...(task ? { id: task.id } : {}),
        title: trimmedTitle,
        prompt: trimmedPrompt,
        enabled: !paused,
        schedule,
        projectId: project.id,
        threadId: owner.id,
        workspaceStrategy: { type: "root" },
        modelSelection,
        runtimeMode: owner.source.runtimeMode ?? "full-access",
        interactionMode: "default",
      },
    });
    setBusy(false);
    if (res._tag === "Success") {
      onClose();
    } else if (!isAtomCommandInterrupted(res)) {
      const cause = squashAtomCommandFailure(res);
      setError(cause instanceof Error ? cause.message : gt("Could not save habit."));
    }
  };

  const remove = async () => {
    if (!task || busy) return;
    const confirmed = await requestConfirmDialog(
      gt("Delete the habit “{title}”? Its schedule stops and past runs stay in chat.", {
        title: task.title,
      }),
    );
    if (!confirmed) return;
    setBusy(true);
    await deleteTask({ environmentId: envId, input: { id: task.id } });
    setBusy(false);
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup data-dropwave-editor="" data-dw-habit-sheet="">
        <form onSubmit={(event) => void save(event)} aria-busy={busy}>
          <DialogHeader>
            <DialogTitle>{task ? <T>Edit habit</T> : <T>New habit</T>}</DialogTitle>
            <DialogDescription>
              <T>A recurring routine a bot runs on its own. Runs land in the owning bot’s chat.</T>
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div data-dw-habit-sheet-body="">
              <label data-dw-field-label="">
                <span>
                  <T>Name</T>
                </span>
                <input
                  data-dw-custom-answer=""
                  value={title}
                  onChange={(event) => setTitle(event.currentTarget.value)}
                  placeholder={gt("e.g. Daily QA sweep")}
                  required
                  autoFocus
                />
              </label>

              <div data-dw-field-label="">
                <span>
                  <T>Who does it</T>
                </span>
                <div data-dw-habit-owners="" role="radiogroup" aria-label={gt("Who does it")}>
                  {botsForProject.map((bot) => (
                    <button
                      key={bot.id}
                      type="button"
                      role="radio"
                      aria-checked={ownerThreadId === bot.id}
                      data-dw-habit-owner=""
                      onClick={() => setOwnerThreadId(bot.id)}
                    >
                      <DropwaveBotAvatar
                        name={bot.title}
                        seed={bot.source.dropwaveBot?.avatarSeed}
                        role={bot.source.dropwaveBot?.kind === "lead" ? "lead" : "specialist"}
                        size="sm"
                      />
                      <span>{bot.title}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div data-dw-habit-when="">
                <label data-dw-field-label="">
                  <span>
                    <T>When</T>
                  </span>
                  <DropwaveSelect
                    value={preset}
                    options={presetOptions}
                    ariaLabel={gt("When")}
                    onChange={setPreset}
                  />
                </label>
                {needsTime ? (
                  <label data-dw-field-label="">
                    <span>
                      <T>At</T>
                    </span>
                    <input
                      data-dw-custom-answer=""
                      type="time"
                      value={time}
                      onChange={(event) => setTime(event.currentTarget.value)}
                    />
                  </label>
                ) : null}
                {needsHours ? (
                  <label data-dw-field-label="">
                    <span>
                      <T>Every</T>
                    </span>
                    <DropwaveSelect
                      value={String(hours)}
                      options={hourOptions}
                      ariaLabel={gt("Every")}
                      onChange={(value) => setHours(Number(value))}
                    />
                  </label>
                ) : null}
              </div>

              <label data-dw-field-label="">
                <span>
                  <T>What should it do?</T>
                </span>
                <textarea
                  data-dw-soul-input=""
                  rows={3}
                  value={prompt}
                  onChange={(event) => setPrompt(event.currentTarget.value)}
                  placeholder={gt("Instructions the bot follows on every run.")}
                  required
                />
              </label>

              <label data-dw-habit-paused="">
                <input
                  type="checkbox"
                  checked={paused}
                  onChange={(event) => setPaused(event.currentTarget.checked)}
                />
                <span>
                  <T>Paused</T>
                </span>
              </label>

              {error ? (
                <p data-dropwave-form-error="" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            {task ? (
              <button
                type="button"
                data-dw-btn-ghost=""
                data-tone="drop"
                disabled={busy}
                onClick={() => void remove()}
              >
                <Trash2Icon className="size-3.5" />
                <T>Delete</T>
              </button>
            ) : null}
            <span data-dw-habit-sheet-spacer="" />
            <button type="button" data-dw-btn-ghost="" onClick={onClose} disabled={busy}>
              <T>Cancel</T>
            </button>
            <button
              type="submit"
              data-dw-btn-solid=""
              disabled={busy || !title.trim() || !prompt.trim() || !owner}
            >
              {busy ? <T>Saving…</T> : task ? <T>Save changes</T> : <T>Create habit</T>}
            </button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
