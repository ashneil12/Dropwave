import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
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
  PlayIcon,
  PlusIcon,
  RepeatIcon,
  Trash2Icon,
} from "lucide-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useState, type FormEvent } from "react";
import { useNowSecond } from "../hooks/useNowSecond";
import { useClientSettings } from "../hooks/useSettings";

import { formatUpcomingTimestamp } from "../timestampFormat";
import { resolveProjectDefaultProviderModelSelection } from "../providerInstances";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readEnvironmentProviders } from "../state/environments";
import { environmentServerConfigsAtom, serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { DropwaveSelect, type DropwaveSelectOption } from "./DropwaveSelect";
import { useDropwaveWorkspace } from "./workspaceContext";

type HabitCadence = "hourly" | "6h" | "daily" | "weekly";

function cadenceToSchedule(cadence: HabitCadence): ScheduledTaskUpsertSchedule {
  switch (cadence) {
    case "hourly":
      return { type: "interval", everyMs: 60 * 60 * 1000 };
    case "6h":
      return { type: "interval", everyMs: 6 * 60 * 60 * 1000 };
    case "weekly":
      return { type: "interval", everyMs: 7 * 24 * 60 * 60 * 1000 };
    default:
      return { type: "interval", everyMs: 24 * 60 * 60 * 1000 };
  }
}

function formatHabitSchedule(task: ScheduledTask, gt: ReturnType<typeof useGT>): string {
  const s = task.schedule;
  if (s.type === "interval") {
    const hrs = Math.round(s.everyMs / 3_600_000);
    if (hrs < 1) return gt("Every {m}m", { m: Math.max(1, Math.round(s.everyMs / 60_000)) });
    if (hrs === 24) return gt("Daily");
    if (hrs === 168) return gt("Weekly");
    return gt("Every {h}h", { h: hrs });
  }
  if (s.type === "fixed_time") return gt("Scheduled");
  if (s.type === "webhook") return gt("Webhook trigger");
  return gt("One-time");
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

function DropwaveHabitsContent({ envId }: { envId: EnvironmentId }) {
  const workspace = useDropwaveWorkspace()!;
  const gt = useGT();
  const project = workspace.project ?? null;

  const [scopeAll, setScopeAll] = useState(false);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [cadence, setCadence] = useState<HabitCadence>("daily");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tasksResult = useAtomValue(
    serverEnvironment.scheduledTasksLive({ environmentId: envId, input: {} }),
  );
  const nowMs = useNowSecond();
  const timestampFormat = useClientSettings((s) => s.timestampFormat);

  const upsertTask = useAtomCommand(serverEnvironment.upsertScheduledTask, {
    reportFailure: false,
  });
  const setEnabled = useAtomCommand(serverEnvironment.setScheduledTaskEnabled, {
    reportFailure: false,
  });
  const runNow = useAtomCommand(serverEnvironment.runScheduledTaskNow, {
    reportFailure: false,
  });
  const deleteTask = useAtomCommand(serverEnvironment.deleteScheduledTask, {
    reportFailure: false,
  });

  const allTasks: ReadonlyArray<ScheduledTask> = AsyncResult.isSuccess(tasksResult)
    ? tasksResult.value.tasks
    : [];
  const shownTasks =
    scopeAll || !project ? allTasks : allTasks.filter((task) => task.projectId === project.id);

  const cadenceOptions: ReadonlyArray<DropwaveSelectOption<HabitCadence>> = [
    { value: "hourly", label: gt("Every hour") },
    { value: "6h", label: gt("Every 6 hours") },
    { value: "daily", label: gt("Daily") },
    { value: "weekly", label: gt("Weekly") },
  ];

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const targetProject = project ?? workspace.projects[0];
    if (!targetProject || !title.trim() || !prompt.trim() || busy) return;
    // Habits run inside the project's Lead thread so each run lands in the Lead's chat.
    const lead = workspace.lead;
    if (!lead) {
      setError(gt("Create your Lead bot first so habit runs land in its chat."));
      return;
    }

    const providers = readEnvironmentProviders(targetProject.environmentId) ?? [];
    const settings =
      appAtomRegistry.get(environmentServerConfigsAtom).get(targetProject.environmentId)
        ?.settings ?? DEFAULT_SERVER_SETTINGS;
    const modelSelection =
      lead.source.modelSelection ??
      targetProject.defaultModelSelection ??
      resolveProjectDefaultProviderModelSelection(providers, settings, targetProject.id);

    if (!modelSelection) {
      setError(gt("Connect a provider in Settings -> Providers & Models first."));
      return;
    }

    setError(null);
    setBusy(true);
    const res = await upsertTask({
      environmentId: targetProject.environmentId,
      input: {
        title: title.trim(),
        prompt: prompt.trim(),
        enabled: true,
        schedule: cadenceToSchedule(cadence),
        projectId: targetProject.id,
        threadId: lead.id,
        workspaceStrategy: { type: "root" },
        modelSelection,
        runtimeMode: lead.source.runtimeMode ?? "full-access",
        interactionMode: "default",
      },
    });
    setBusy(false);
    if (res._tag === "Success") {
      setTitle("");
      setPrompt("");
    } else if (!isAtomCommandInterrupted(res)) {
      const cause = squashAtomCommandFailure(res);
      setError(cause instanceof Error ? cause.message : gt("Could not save habit."));
    }
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
              Recurring routines your bots run automatically across your projects: QA sweeps,
              metrics digests, release checks, or content updates.
            </T>
          </p>
        </div>
        <div data-dw-canvas-tabs="" role="group" aria-label={gt("Habit scope")}>
          <button type="button" aria-selected={!scopeAll} onClick={() => setScopeAll(false)}>
            {project ? project.title : <T>This project</T>}
          </button>
          <button type="button" aria-selected={scopeAll} onClick={() => setScopeAll(true)}>
            <T>All projects</T>
          </button>
        </div>
      </header>

      <form data-dw-habit-form="" onSubmit={(e) => void handleCreate(e)}>
        <div data-dw-habit-form-top="">
          <input
            data-dw-custom-answer=""
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            placeholder={gt("Habit name (e.g. Daily Canary QA sweep)")}
            required
          />
          <DropwaveSelect
            value={cadence}
            options={cadenceOptions}
            ariaLabel={gt("Habit cadence")}
            onChange={setCadence}
          />
        </div>
        <textarea
          data-dw-soul-input=""
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.currentTarget.value)}
          placeholder={gt("What should your Lead bot check, fix, or report on each run?")}
          required
        />
        {error ? (
          <p data-dropwave-form-error="" role="alert">
            {error}
          </p>
        ) : null}
        <div data-dw-setup-submit="">
          <button
            type="submit"
            data-dw-btn-solid=""
            disabled={busy || !title.trim() || !prompt.trim()}
          >
            <PlusIcon className="size-3.5" />
            <T>Create habit</T>
          </button>
        </div>
      </form>

      <div data-dw-habit-list="">
        {shownTasks.map((task) => {
          const ownerProj = workspace.projects.find((p) => p.id === task.projectId);
          return (
            <div
              key={task.id}
              data-dw-habit-card=""
              data-paused={!task.enabled ? "true" : undefined}
            >
              <div data-dw-habit-info="">
                <div data-dw-habit-title-row="">
                  <span data-dw-dot={task.enabled ? "emerald" : "dim"} />
                  <strong>{task.title}</strong>
                  {ownerProj ? <span data-dw-badge="violet">{ownerProj.title}</span> : null}
                  <span data-dw-mono="muted">{formatHabitSchedule(task, gt)}</span>
                </div>
                <p>{task.prompt}</p>
                <small>
                  {task.nextRunAt ? (
                    <T>
                      Next:{" "}
                      <Var>{formatUpcomingTimestamp(task.nextRunAt, timestampFormat, nowMs)}</Var>
                    </T>
                  ) : (
                    <T>
                      Next: <Var>{gt("Not scheduled")}</Var>
                    </T>
                  )}
                  {task.lastRunStatus !== "never" ? (
                    <>
                      {" · "}
                      <T>
                        Last run: <Var>{task.lastRunStatus}</Var>
                      </T>
                    </>
                  ) : null}
                </small>
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
                  onClick={() => void runNow({ environmentId: envId, input: { id: task.id } })}
                >
                  <PlayIcon className="size-3" />
                  <T>Run now</T>
                </button>
                <button
                  type="button"
                  data-dw-mini-icon=""
                  aria-label={task.enabled ? gt("Pause habit") : gt("Resume habit")}
                  onClick={() =>
                    void setEnabled({
                      environmentId: envId,
                      input: { id: task.id, enabled: !task.enabled },
                    })
                  }
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
                  aria-label={gt("Delete habit")}
                  onClick={() => void deleteTask({ environmentId: envId, input: { id: task.id } })}
                >
                  <Trash2Icon className="size-3.5" />
                </button>
              </div>
            </div>
          );
        })}

        {shownTasks.length === 0 ? (
          <p data-dw-rail-empty="">
            <T>
              No habits scheduled yet. Add one above so your bots proactively sweep tests, docs, or
              metrics on a cadence.
            </T>
          </p>
        ) : null}
      </div>
    </section>
  );
}
