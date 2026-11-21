import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { wireChiefOfStaff as wireChiefOfStaffShared } from "@t3tools/client-runtime/dropwave-setup";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { DEFAULT_SERVER_SETTINGS, type DropwaveRiskLevel } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Schema from "effect/Schema";
import { T, msg, useGT, useMessages } from "gt-react";
import { ArrowLeftIcon, CheckIcon, FolderOpenIcon, LoaderIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { newProjectId, newMessageId, newThreadId } from "../lib/utils";
import { readLocalApi } from "../localApi";
import {
  providerInstanceEntriesFor,
  resolveProjectDefaultProviderModelSelection,
} from "../providerInstances";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readEnvironmentProviders, usePrimaryEnvironmentId } from "../state/environments";
import { filesystemEnvironment, useFilesystemReadAccess } from "../state/filesystem";
import { projectEnvironment } from "../state/projects";
import { useEnvironmentQuery } from "../state/query";
import { environmentServerConfigsAtom, serverEnvironment } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { useDropwaveWorkspace } from "./workspaceContext";

const DEFAULT_SETUP_STEP_TITLES: ReadonlyArray<ReturnType<typeof msg>> = [
  msg("Plan & split asks"),
  msg("Build in isolated worktrees"),
  msg("Verify & QA end-to-end"),
  msg("Fix issues & re-check"),
  msg("Ship & report proof"),
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
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx > 0 ? trimmed.slice(0, idx) : trimmed;
}

function basenameOf(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/** Listing path one level up from a browsed directory path (always "/"-separated). */
function parentBrowsePath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  if (trimmed === "~") return "~/";
  if (trimmed === "") return path.startsWith("/") ? "/" : "~/";
  if (/^[a-zA-Z]:$/.test(trimmed)) return `${trimmed}/`;
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (idx <= 0) return "/";
  const parent = trimmed.slice(0, idx);
  return parent === "~" ? "~/" : `${parent}/`;
}

const LAST_PARENT_FOLDER_KEY = "dropwave:new-project-parent";
const ParentFolderSchema = Schema.String;

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
  const [rememberedParent, setRememberedParent] = useLocalStorage(
    LAST_PARENT_FOLDER_KEY,
    "",
    ParentFolderSchema,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState("~/");
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

  // Only an explicitly chosen parent is remembered; otherwise new projects
  // default under ~/Projects (resolved through the server's folder browser).
  const derivedParent = rememberedParent;

  // With no remembered parent, resolve ~/Projects through the server's
  // folder browser (or <home>/Projects when it does not exist yet).
  const browseEnvId = workspace?.project?.environmentId ?? primaryEnvId ?? null;
  const fsAccess = useFilesystemReadAccess(browseEnvId);
  const canBrowse = browseEnvId !== null && fsAccess.canReadFiles;
  const needsParentFallback = derivedParent === "";
  const projectsDirQuery = useEnvironmentQuery(
    canBrowse && needsParentFallback && browseEnvId !== null
      ? filesystemEnvironment.browse({
          environmentId: browseEnvId,
          input: { partialPath: "~/Projects/" },
        })
      : null,
  );
  const homeDirQuery = useEnvironmentQuery(
    canBrowse && needsParentFallback && projectsDirQuery.error !== null && browseEnvId !== null
      ? filesystemEnvironment.browse({
          environmentId: browseEnvId,
          input: { partialPath: "~/" },
        })
      : null,
  );
  const parentDir =
    derivedParent ||
    projectsDirQuery.data?.parentPath ||
    (projectsDirQuery.error !== null && homeDirQuery.data?.parentPath
      ? `${homeDirQuery.data.parentPath}/Projects`
      : "");

  const autoPath = parentDir && projectTitle.trim() ? `${parentDir}/${slugify(projectTitle)}` : "";

  const pickerQuery = useEnvironmentQuery(
    canBrowse && pickerOpen && browseEnvId !== null
      ? filesystemEnvironment.browse({
          environmentId: browseEnvId,
          input: { partialPath: browsePath },
        })
      : null,
  );

  const isDesktopPicker = typeof window !== "undefined" && Boolean(window.desktopBridge);

  const openPicker = (mode: "new" | "existing" = folderMode) => {
    const start =
      mode === "existing" && folderPath
        ? `${dirnameOf(folderPath)}/`
        : parentDir
          ? `${parentDir}/`
          : "~/";
    setBrowsePath(start);
    setPickerOpen(true);
  };

  const pickWithNativeDialog = async (mode: "new" | "existing" = folderMode) => {
    const initial = mode === "existing" ? folderPath || parentDir : parentDir;
    const picked = await readLocalApi()
      ?.dialogs.pickFolder(initial ? { initialPath: initial } : undefined)
      .catch(() => null);
    if (!picked) return;
    if (mode === "new") setRememberedParent(picked);
    else setFolderPath(picked);
  };

  const chooseFolder = (mode: "new" | "existing" = folderMode) => {
    const selected = pickerQuery.data?.parentPath;
    if (!selected) return;
    if (mode === "new") setRememberedParent(selected);
    else setFolderPath(selected);
    setPickerOpen(false);
  };

  // An existing project without a lead skips the sheet entirely and wires the
  // Chief of Staff directly, the same path "Create" takes after project creation.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- fires one-time lead wiring against the server for an unconfigured project
  useEffect(() => {
    if (!preselectedLiveProject || wiringRef.current) return;
    wiringRef.current = true;
    void wireChiefOfStaff(preselectedLiveProject);
  }, [preselectedLiveProject, wireChiefOfStaff]);

  if (!workspace) return null;

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

    const existingLead = workspace?.bots.find((bot) => bot.source.dropwaveBot?.kind === "lead");
    const result = await wireChiefOfStaffShared(
      {
        listPersonas: async () => {
          const res = await listPersonas({ environmentId: envId, input: {} });
          return res._tag === "Success" ? [...res.value.items] : [];
        },
        upsertPersona: async (input) => {
          const res = await upsertPersona({ environmentId: envId, input });
          if (res._tag !== "Success") throw squashAtomCommandFailure(res);
          return res.value.item;
        },
        createThread: async (input) => {
          const res = await createThread({
            environmentId: envId,
            input: { ...input, branch: null, worktreePath: null },
          });
          if (res._tag !== "Success") throw squashAtomCommandFailure(res);
        },
        sendMessage: async (input) => {
          const res = await startTurn({
            environmentId: envId,
            input: {
              threadId: input.threadId,
              message: {
                messageId: input.messageId,
                role: "user",
                text: input.text,
                attachments: [],
              },
              runtimeMode: input.runtimeMode,
              interactionMode: input.interactionMode,
            },
          });
          if (res._tag !== "Success") throw squashAtomCommandFailure(res);
        },
        newThreadId,
        newMessageId,
      },
      {
        project,
        modelSelection,
        runtimeMode: projectSettings.defaultRuntimeMode,
        interactionMode: "default",
        riskLevel: defaultRisk,
        chiefRoleLabel: gt("Chief of Staff"),
        loopStepTitles: DEFAULT_SETUP_STEP_TITLES.map((title) => m(title as string)),
        existingLead: existingLead
          ? {
              title: existingLead.title,
              soul: existingLead.source.dropwaveBot?.soul ?? "",
            }
          : undefined,
        autoMessageText: ({ title, workspaceRoot }) =>
          gt("New project: {title} ({root}).", { title, root: workspaceRoot }),
      },
    ).catch((cause) => ({ error: cause }));
    if ("error" in result) {
      setBusy(false);
      const cause = result.error;
      setError(cause instanceof Error ? cause.message : gt("Could not create Chief of Staff."));
      return;
    }

    setBusy(false);
    if (!workspace) return;
    workspace.refreshOpenAsksCount();
    workspace.openThread(scopeThreadRef(envId, result.leadThreadId));
  }

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    const title = projectTitle.trim();
    const workspaceRoot = (folderMode === "new" ? autoPath : folderPath).trim();
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

  const locationLabel = (() => {
    if (folderMode === "existing" && folderPath.trim()) {
      const parent = basenameOf(dirnameOf(folderPath));
      const leaf = basenameOf(folderPath);
      return parent && parent !== leaf ? `${parent} › ${leaf}` : leaf;
    }
    const leaf = slugify(projectTitle) || "untitled";
    const parent = basenameOf(parentDir) || "~";
    return `${parent} › ${leaf}`;
  })();
  const locationPath = folderMode === "new" ? autoPath : folderPath.trim();

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
                  <T>Location</T>
                </span>
                <div data-dw-location-row="">
                  <TooltipProvider delay={150}>
                    <Tooltip>
                      <TooltipTrigger render={<span data-dw-location-text="" />}>
                        <FolderOpenIcon className="size-3.5" />
                        {locationLabel}
                      </TooltipTrigger>
                      {locationPath ? <TooltipPopup>{locationPath}</TooltipPopup> : null}
                    </Tooltip>
                  </TooltipProvider>
                  <span data-dw-location-actions="">
                    <button
                      type="button"
                      data-dw-header-pill=""
                      onClick={() => {
                        if (isDesktopPicker) void pickWithNativeDialog();
                        else openPicker();
                      }}
                    >
                      <T>Change</T>
                    </button>
                    {folderMode === "new" ? (
                      <button
                        type="button"
                        data-dw-header-pill=""
                        onClick={() => {
                          setFolderMode("existing");
                          if (!isDesktopPicker) openPicker("existing");
                          else void pickWithNativeDialog("existing");
                        }}
                      >
                        <T>Use an existing folder</T>
                      </button>
                    ) : (
                      <button
                        type="button"
                        data-dw-header-pill=""
                        onClick={() => setFolderMode("new")}
                      >
                        <T>New folder instead</T>
                      </button>
                    )}
                  </span>
                </div>
                {pickerOpen ? (
                  <div data-dw-folder-picker="">
                    <div data-dw-folder-picker-bar="">
                      <button
                        type="button"
                        data-dw-mini-icon=""
                        aria-label={gt("Up one folder")}
                        disabled={parentBrowsePath(browsePath) === browsePath}
                        onClick={() => setBrowsePath(parentBrowsePath(browsePath))}
                      >
                        <ArrowLeftIcon className="size-3.5" />
                      </button>
                      <span data-dw-folder-picker-path="">
                        {browsePath.replace(/[\\/]+$/, "") || browsePath}
                      </span>
                    </div>
                    <div data-dw-folder-picker-list="">
                      {(pickerQuery.data?.entries ?? []).map((entry) => (
                        <button
                          key={entry.fullPath}
                          type="button"
                          data-dw-folder-entry=""
                          onClick={() => setBrowsePath(`${entry.fullPath}/`)}
                        >
                          <FolderOpenIcon className="size-3.5" />
                          <span>{entry.name}</span>
                        </button>
                      ))}
                      {pickerQuery.isPending ? (
                        <p data-dw-rail-empty="">
                          <LoaderIcon className="size-3.5 animate-spin" />
                        </p>
                      ) : pickerQuery.error ? (
                        <p data-dw-rail-empty="">
                          <T>Could not read this folder.</T>
                        </p>
                      ) : (pickerQuery.data?.entries.length ?? 0) === 0 ? (
                        <p data-dw-rail-empty="">
                          <T>No folders here.</T>
                        </p>
                      ) : null}
                    </div>
                    <div data-dw-folder-picker-foot="">
                      <button
                        type="button"
                        data-dw-btn-ghost=""
                        onClick={() => setPickerOpen(false)}
                      >
                        <T>Cancel</T>
                      </button>
                      <button
                        type="button"
                        data-dw-btn-solid=""
                        disabled={!pickerQuery.data?.parentPath}
                        onClick={() => chooseFolder()}
                      >
                        {folderMode === "new" ? <T>Use this folder</T> : <T>Select folder</T>}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

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
