import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_SERVER_SETTINGS,
  type DropwaveLoopStep,
  type DropwavePersona,
  type DropwaveRiskLevel,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { T, msg, useGT, useMessages } from "gt-react";
import { ArrowLeftIcon, CheckIcon, FolderOpenIcon, LoaderIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { newProjectId, newMessageId, newThreadId } from "../lib/utils";
import { readLocalApi } from "../localApi";
import {
  providerInstanceEntriesFor,
  resolveProjectDefaultProviderModelSelection,
} from "../providerInstances";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readEnvironmentProviders, usePrimaryEnvironmentId } from "../state/environments";
import { projectEnvironment } from "../state/projects";
import { environmentServerConfigsAtom, serverEnvironment } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { useDropwaveWorkspace } from "./workspaceContext";

const DEFAULT_SETUP_STEPS: ReadonlyArray<{
  readonly id: string;
  readonly title: ReturnType<typeof msg>;
}> = [
  { id: "s1", title: msg("Plan & split asks") },
  { id: "s2", title: msg("Build in isolated worktrees") },
  { id: "s3", title: msg("Verify & QA end-to-end") },
  { id: "s4", title: msg("Fix issues & re-check") },
  { id: "s5", title: msg("Ship & report proof") },
];

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "new-project";
}

function dirnameOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx > 0 ? trimmed.slice(0, idx) : trimmed;
}

export function DropwaveConversationalSetup({
  startAtNewProject = false,
  defaultRisk = "normal",
  onCancel,
}: {
  startAtNewProject?: boolean;
  defaultRisk?: DropwaveRiskLevel;
  onCancel: () => void;
}) {
  const workspace = useDropwaveWorkspace();
  const primaryEnvId = usePrimaryEnvironmentId();
  const gt = useGT();
  const m = useMessages();

  const preselectedLiveProject =
    !startAtNewProject && workspace && workspace.project && !workspace.lead
      ? workspace.project
      : null;

  const [projectTitle, setProjectTitle] = useState("");
  const [folderMode, setFolderMode] = useState<"new" | "existing">("new");
  const [folderPath, setFolderPath] = useState("");
  const [pathTouched, setPathTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wiringRef = useRef(false);

  const createProject = useOrchestrationCommand(projectEnvironment.create, {
    reportFailure: false,
  });
  const createThread = useOrchestrationCommand(threadEnvironment.create, { reportFailure: false });
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const listPersonas = useAtomCommand(serverEnvironment.dropwavePersonaList, {
    reportFailure: false,
  });
  const upsertPersona = useAtomCommand(serverEnvironment.dropwavePersonaUpsert, {
    reportFailure: false,
  });

  const parentDir = (() => {
    const recent =
      workspace?.project?.workspaceRoot ?? workspace?.projects.at(-1)?.workspaceRoot ?? "";
    return recent ? dirnameOf(recent) : "";
  })();

  const autoPath = parentDir && projectTitle.trim() ? `${parentDir}/${slugify(projectTitle)}` : "";

  // An existing project without a lead skips the sheet entirely and wires the
  // Chief of Staff directly, the same path "Create" takes after project creation.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- fires one-time lead wiring against the server for an unconfigured project
  useEffect(() => {
    if (!preselectedLiveProject || wiringRef.current) return;
    wiringRef.current = true;
    void wireChiefOfStaff(preselectedLiveProject);
  }, [preselectedLiveProject, wireChiefOfStaff]);

  if (!workspace) return null;

  const resolveChiefOfStaffPersona = async (): Promise<{
    persona?: DropwavePersona;
    firstRun?: boolean;
    error?: string;
  }> => {
    const envId = workspace.project?.environmentId ?? primaryEnvId;
    if (!envId) return { error: gt("No connected environment available yet.") };
    const listed = await listPersonas({ environmentId: envId, input: {} });
    if (listed._tag === "Success") {
      const chief = listed.value.items.find((persona) => persona.role === "chief_of_staff");
      if (chief) return { persona: chief, firstRun: false };
    }
    const existingLead = workspace.bots.find((bot) => bot.source.dropwaveBot?.kind === "lead");
    if (existingLead) {
      const created = await upsertPersona({
        environmentId: envId,
        input: {
          name: existingLead.title,
          role: "chief_of_staff",
          roleLabel: gt("Chief of Staff"),
          soul: existingLead.source.dropwaveBot?.soul ?? "",
        },
      });
      if (created._tag === "Success") return { persona: created.value.item, firstRun: false };
    }
    const created = await upsertPersona({
      environmentId: envId,
      // No soul or identity: the store seeds identity with the IDENTITY.md template.
      input: {
        name: "Atlas",
        role: "chief_of_staff",
        roleLabel: gt("Chief of Staff"),
      },
    });
    if (created._tag !== "Success") {
      const cause = squashAtomCommandFailure(created);
      return {
        error: cause instanceof Error ? cause.message : gt("Could not create your Chief of Staff."),
      };
    }
    return { persona: created.value.item, firstRun: true };
  };

  async function wireChiefOfStaff(project: EnvironmentProject) {
    if (busy) return;
    setError(null);
    setBusy(true);
    const envId = project.environmentId;
    const providers = readEnvironmentProviders(envId) ?? [];
    const settings =
      appAtomRegistry.get(environmentServerConfigsAtom).get(envId)?.settings ??
      DEFAULT_SERVER_SETTINGS;
    const projectSettings = resolveProjectSettings(settings, project.id).settings;
    const configured = project.defaultModelSelection;
    const available = providerInstanceEntriesFor(providers, settings, project.id);
    const modelSelection =
      configured &&
      available.some(
        (entry) => entry.instanceId === configured.instanceId && entry.enabled && entry.isAvailable,
      )
        ? configured
        : resolveProjectDefaultProviderModelSelection(providers, settings, project.id);
    if (!modelSelection) {
      setBusy(false);
      setError(
        gt("Connect a provider in Settings -> Providers & Models first, then launch again."),
      );
      return;
    }

    const resolved = await resolveChiefOfStaffPersona();
    if (!resolved.persona) {
      setBusy(false);
      setError(resolved.error ?? gt("Could not prepare your Chief of Staff."));
      return;
    }
    const persona = resolved.persona;
    const firstRun = resolved.firstRun === true;

    const loopSteps: Array<DropwaveLoopStep> = DEFAULT_SETUP_STEPS.map((step) => ({
      id: step.id,
      title: m(step.title as string),
      ownerBotId: null,
    }));
    const leadId = newThreadId();
    const leadRes = await createThread({
      environmentId: envId,
      input: {
        threadId: leadId,
        projectId: project.id,
        title: persona.name,
        dropwaveBot: {
          kind: "lead",
          brief: "",
          workflow: loopSteps.map((step) => step.title),
          rules: [],
          riskLevel: defaultRisk,
          fixRoundCap: 3,
          loopSteps,
          personaId: persona.id,
          onboardingPhase: firstRun ? "first_run" : "project",
        },
        modelSelection,
        runtimeMode: projectSettings.defaultRuntimeMode,
        interactionMode: "default",
        branch: null,
        worktreePath: null,
      },
    });
    if (leadRes._tag === "Failure") {
      setBusy(false);
      if (!isAtomCommandInterrupted(leadRes)) {
        const cause = squashAtomCommandFailure(leadRes);
        setError(cause instanceof Error ? cause.message : gt("Could not create Chief of Staff."));
      }
      return;
    }

    setBusy(false);
    if (!workspace) return;
    workspace.refreshOpenAsksCount();
    workspace.openThread(scopeThreadRef(envId, leadId));

    if (!firstRun) {
      // Project onboarding starts with the owner's first message so the lead can
      // inspect the folder and greet by name.
      await startTurn({
        environmentId: envId,
        input: {
          threadId: leadId,
          message: {
            messageId: newMessageId(),
            role: "user",
            text: gt("New project: {title} ({root}).", {
              title: project.title,
              root: project.workspaceRoot,
            }),
            attachments: [],
          },
          runtimeMode: projectSettings.defaultRuntimeMode,
          interactionMode: "default",
        },
      });
    }
  }

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const title = projectTitle.trim();
    const workspaceRoot = (
      folderMode === "new" ? (pathTouched ? folderPath : autoPath) : folderPath
    ).trim();
    if (!title || !workspaceRoot || busy) return;
    const envId = workspace.project?.environmentId ?? primaryEnvId;
    if (!envId) {
      setError(gt("No connected environment available yet."));
      return;
    }
    setError(null);
    setBusy(true);
    const projectId = newProjectId();
    const res = await createProject({
      environmentId: envId,
      input: {
        projectId,
        title,
        workspaceRoot,
        createWorkspaceRootIfMissing: folderMode === "new",
      },
    });
    if (res._tag === "Failure") {
      setBusy(false);
      if (!isAtomCommandInterrupted(res)) {
        const cause = squashAtomCommandFailure(res);
        setError(cause instanceof Error ? cause.message : gt("Could not create project folder."));
      }
      return;
    }
    const project = {
      environmentId: envId,
      id: projectId,
      title,
      workspaceRoot,
      isScratch: false,
      defaultModelSelection: null,
      scripts: [],
      archivedAt: null,
      deletedAt: null,
    } as unknown as EnvironmentProject;
    await wireChiefOfStaff(project);
  };

  const browseFolder = async () => {
    const picked = await readLocalApi()
      ?.dialogs.pickFolder(parentDir ? { initialPath: parentDir } : undefined)
      .catch(() => null);
    if (picked) {
      setFolderPath(picked);
      setPathTouched(true);
    }
  };

  return (
    <div data-dw-pillar-body="">
      <header data-dw-pillar-head="">
        <button type="button" data-dw-back-pill="" onClick={onCancel}>
          <ArrowLeftIcon className="size-3.5" />
          <T>Back</T>
        </button>
        <div data-dw-step-indicator="">
          <span data-active="true">
            <T>New project</T>
          </span>
        </div>
        <div data-dw-head-actions="" />
      </header>

      <div data-dw-stream="">
        {preselectedLiveProject ? (
          <div data-dw-onboard-basics="">
            <h2>
              <T>Wiring up your Chief of Staff…</T>
            </h2>
            <p>
              <LoaderIcon className="size-4 animate-spin" />
            </p>
            {error ? (
              <p data-dropwave-form-error="" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : (
          <div data-dw-onboard-basics="">
            <h2>
              <T>Set up your project</T>
            </h2>
            <p>
              <T>
                Name the project and pick a folder. Your Chief of Staff takes it from there and
                onboards the project with you in chat.
              </T>
            </p>

            <form data-dw-setup-card="" onSubmit={(e) => void handleCreate(e)}>
              <label data-dw-field-label="">
                <span>
                  <T>Project name</T>
                </span>
                <input
                  data-dw-custom-answer=""
                  value={projectTitle}
                  onChange={(e) => setProjectTitle(e.currentTarget.value)}
                  placeholder={gt("e.g. Hivra, Nibbii, Pocket CRM")}
                  required
                  autoFocus
                />
              </label>

              <div data-dw-field-label="">
                <span>
                  <T>Folder</T>
                </span>
                <div data-dw-risk-pills="">
                  <button
                    type="button"
                    data-dw-risk-btn=""
                    aria-pressed={folderMode === "new"}
                    onClick={() => setFolderMode("new")}
                  >
                    <T>New folder</T>
                  </button>
                  <button
                    type="button"
                    data-dw-risk-btn=""
                    aria-pressed={folderMode === "existing"}
                    onClick={() => setFolderMode("existing")}
                  >
                    <T>Existing folder</T>
                  </button>
                </div>
              </div>

              {folderMode === "new" ? (
                <label data-dw-field-label="">
                  <span>
                    <T>Path</T>
                  </span>
                  <input
                    data-dw-custom-answer=""
                    value={pathTouched ? folderPath : autoPath}
                    onChange={(e) => {
                      setPathTouched(true);
                      setFolderPath(e.currentTarget.value);
                    }}
                    placeholder={gt("/Users/you/Projects/my-app")}
                    required
                  />
                </label>
              ) : (
                <label data-dw-field-label="">
                  <span>
                    <T>Path</T>
                  </span>
                  <div data-dw-path-row="">
                    <input
                      data-dw-custom-answer=""
                      value={folderPath}
                      onChange={(e) => setFolderPath(e.currentTarget.value)}
                      placeholder={gt("/Users/you/Projects/my-app")}
                      required
                    />
                    <button
                      type="button"
                      data-dw-header-pill=""
                      onClick={() => void browseFolder()}
                    >
                      <FolderOpenIcon className="size-3.5" />
                      <T>Browse</T>
                    </button>
                  </div>
                </label>
              )}

              {error ? (
                <p data-dropwave-form-error="" role="alert">
                  {error}
                </p>
              ) : null}

              <div data-dw-setup-submit="">
                <button
                  type="submit"
                  data-dw-white-pill=""
                  disabled={
                    busy ||
                    !projectTitle.trim() ||
                    !(folderMode === "new" ? autoPath : folderPath).trim()
                  }
                >
                  <CheckIcon className="size-3.5" />
                  {busy ? <T>Creating…</T> : <T>Create</T>}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
