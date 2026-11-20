import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_SERVER_SETTINGS,
  type DropwaveLoopStep,
  type DropwaveRiskLevel,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { T, Var, msg, useGT, useMessages } from "gt-react";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CheckIcon,
  FolderPlusIcon,
  PlusIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import { openCommandPalette } from "../commandPaletteBus";
import { newProjectId, newThreadId } from "../lib/utils";
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
import { DropwaveSelect, type DropwaveSelectOption } from "./DropwaveSelect";
import { useDropwaveWorkspace } from "./workspaceContext";

interface SetupStepDraft {
  readonly id: string;
  readonly title: string;
  readonly owner: string;
}

const DEFAULT_SETUP_STEPS: ReadonlyArray<{
  readonly id: string;
  readonly title: string;
  readonly owner: string;
}> = [
  { id: "s1", title: msg("Plan & split asks"), owner: "Main bot" },
  { id: "s2", title: msg("Build in isolated worktrees"), owner: "Main bot" },
  { id: "s3", title: msg("Verify & QA end-to-end"), owner: "QA bot" },
  { id: "s4", title: msg("Fix issues & re-check"), owner: "Main bot" },
  { id: "s5", title: msg("Ship & report proof"), owner: "Main bot" },
];

const SOUL_PRESETS: ReadonlyArray<{
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly soul: string;
}> = [
  {
    id: "first-mate",
    name: "Atlas",
    label: msg("Sharp First Mate"),
    soul: msg(
      "Direct, calm, loyal first mate. Speaks plain English with zero corporate fluff or sycophancy. Organizes messy founder dumps into airtight tracked asks, owns outcomes end-to-end, pushes back honestly when an approach is flawed, and never declares victory without real proof.",
    ),
  },
  {
    id: "builder",
    name: "Forge",
    label: msg("Relentless Builder"),
    soul: msg(
      "Bias toward shipping working software fast. Cuts scope creep, builds in clean isolated worktrees, fixes failing tests immediately instead of explaining them away, and surfaces concise evidence-first updates.",
    ),
  },
  {
    id: "operator",
    name: "Nova",
    label: msg("Calm Operator"),
    soul: msg(
      "Methodical, structured business operator. Keeps docs, memory, and decisions spotless across parallel tracks, anticipates bottlenecks early, and distills complex trade-offs into 1-sentence recommendations.",
    ),
  },
];

export function DropwaveConversationalSetup({
  defaultRisk = "yolo",
  startAtNewProject = false,
  onCancel,
}: {
  defaultRisk?: DropwaveRiskLevel;
  startAtNewProject?: boolean;
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

  // Step 1: Project Basics (pick unconfigured project OR create new project + folder in place)
  const [boundProject, setBoundProject] = useState<EnvironmentProject | null>(
    preselectedLiveProject,
  );
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [newFolderPath, setNewFolderPath] = useState("");
  const [createIfMissing, setCreateIfMissing] = useState(true);
  const [creatingProject, setCreatingProject] = useState(false);

  // Step 2: AI Chief of Staff Onboarding
  const [doneBar, setDoneBar] = useState("");
  const [doneSubmitted, setDoneSubmitted] = useState(false);
  const [composerText, setComposerText] = useState("");
  const [leadName, setLeadName] = useState("Atlas");
  const [soulPresetId, setSoulPresetId] = useState(SOUL_PRESETS[0]!.id);
  const [soulText, setSoulText] = useState(() => m(SOUL_PRESETS[0]!.soul));
  const [steps, setSteps] = useState<Array<SetupStepDraft>>(() =>
    DEFAULT_SETUP_STEPS.map((step) => ({ ...step, title: m(step.title) })),
  );
  const [wantQa, setWantQa] = useState(true);
  const [wantSeo, setWantSeo] = useState(false);
  const [riskLevel, setRiskLevel] = useState<DropwaveRiskLevel>(defaultRisk);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createProject = useOrchestrationCommand(projectEnvironment.create, {
    reportFailure: false,
  });
  const createThread = useOrchestrationCommand(threadEnvironment.create, { reportFailure: false });
  const writeDoc = useAtomCommand(serverEnvironment.dropwaveDocWrite, { reportFailure: false });
  const saveMemory = useAtomCommand(serverEnvironment.dropwaveMemorySave, { reportFailure: false });

  if (!workspace) return null;

  const unconfiguredProjects = workspace.projects.filter(
    (proj) =>
      !workspace.bots.some(
        (bot) =>
          bot.projectId === proj.id &&
          bot.environmentId === proj.environmentId &&
          bot.source.dropwaveBot?.kind === "lead",
      ),
  );

  // Resolve freshly created project from live entity store if available
  const activeProject =
    (boundProject
      ? (workspace.projects.find(
          (p) => p.id === boundProject.id && p.environmentId === boundProject.environmentId,
        ) ?? boundProject)
      : null) ?? null;

  const handleCreateProject = async (event: FormEvent) => {
    event.preventDefault();
    const title = newProjectTitle.trim();
    const workspaceRoot = newFolderPath.trim();
    if (!title || !workspaceRoot || creatingProject) return;
    const envId = workspace.project?.environmentId ?? primaryEnvId;
    if (!envId) {
      setError(gt("No connected environment available yet."));
      return;
    }
    setError(null);
    setCreatingProject(true);
    const projectId = newProjectId();
    const res = await createProject({
      environmentId: envId,
      input: {
        projectId,
        title,
        workspaceRoot,
        createWorkspaceRootIfMissing: createIfMissing,
      },
    });
    setCreatingProject(false);
    if (res._tag === "Failure") {
      if (!isAtomCommandInterrupted(res)) {
        const cause = squashAtomCommandFailure(res);
        setError(cause instanceof Error ? cause.message : gt("Could not create project folder."));
      }
      return;
    }
    setBoundProject({
      environmentId: envId,
      id: projectId,
      title,
      workspaceRoot,
      isScratch: false,
      defaultModelSelection: null,
      scripts: [],
      archivedAt: null,
      deletedAt: null,
    } as unknown as EnvironmentProject);
  };

  const handleChatSubmit = (event: FormEvent) => {
    event.preventDefault();
    const cleaned = composerText.trim();
    if (!cleaned || doneSubmitted) return;
    setDoneBar(cleaned);
    setDoneSubmitted(true);
    setComposerText("");
  };

  const moveStep = (index: number, delta: -1 | 1) => {
    const next = index + delta;
    if (next < 0 || next >= steps.length) return;
    setSteps((prev) => {
      const copy = [...prev];
      const item = copy[index]!;
      copy[index] = copy[next]!;
      copy[next] = item;
      return copy;
    });
  };

  const launchLoop = async () => {
    if (busy || !activeProject) return;
    setError(null);

    const title = activeProject.title;
    const shippedText =
      doneBar.trim() || gt("Tested end-to-end with verified evidence before reporting done.");
    const cleanedSteps = steps.filter((s) => s.title.trim().length > 0);
    const botTitle = leadName.trim() || gt("Chief of Staff");
    const finalSoul = soulText.trim();

    const envId = activeProject.environmentId;
    const providers = readEnvironmentProviders(envId) ?? [];
    const settings =
      appAtomRegistry.get(environmentServerConfigsAtom).get(envId)?.settings ??
      DEFAULT_SERVER_SETTINGS;
    const projectSettings = resolveProjectSettings(settings, activeProject.id).settings;
    const configured = activeProject.defaultModelSelection;
    const available = providerInstanceEntriesFor(providers, settings, activeProject.id);
    const modelSelection =
      configured &&
      available.some(
        (entry) => entry.instanceId === configured.instanceId && entry.enabled && entry.isAvailable,
      )
        ? configured
        : resolveProjectDefaultProviderModelSelection(providers, settings, activeProject.id);
    if (!modelSelection) {
      setError(
        gt("Connect a provider in Settings -> Providers & Models first, then launch again."),
      );
      return;
    }

    setBusy(true);
    const leadId = newThreadId();
    const qaId = wantQa ? newThreadId() : null;
    const seoId = wantSeo ? newThreadId() : null;

    const loopSteps: Array<DropwaveLoopStep> = cleanedSteps.map((step) => ({
      id: step.id,
      title: step.title.trim(),
      ownerBotId:
        step.owner === "QA bot" && qaId ? qaId : step.owner === "SEO bot" && seoId ? seoId : null,
    }));

    const leadRes = await createThread({
      environmentId: envId,
      input: {
        threadId: leadId,
        projectId: activeProject.id,
        title: botTitle,
        dropwaveBot: {
          kind: "lead",
          brief: `${title}: ${shippedText}`,
          ...(finalSoul ? { soul: finalSoul } : {}),
          workflow: loopSteps.map((s) => s.title),
          rules: [],
          riskLevel,
          doneDefinition: shippedText,
          fixRoundCap: 3,
          loopSteps,
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

    if (qaId) {
      await createThread({
        environmentId: envId,
        input: {
          threadId: qaId,
          projectId: activeProject.id,
          title: gt("{name} QA", { name: title }),
          dropwaveBot: {
            kind: "teammate",
            leadThreadId: leadId,
            role: gt("Verification & QA"),
            soul: gt(
              "Skeptical, thorough QA engineer. Never trusts claims without running real checks and inspecting real output. Reports exact pass/fail evidence concisely.",
            ),
            brief: gt("Verify work end-to-end against: {done}", { done: shippedText }),
          },
          modelSelection,
          runtimeMode: projectSettings.defaultRuntimeMode,
          interactionMode: "default",
          branch: null,
          worktreePath: null,
        },
      });
    }
    if (seoId) {
      await createThread({
        environmentId: envId,
        input: {
          threadId: seoId,
          projectId: activeProject.id,
          title: gt("{name} Growth", { name: title }),
          dropwaveBot: {
            kind: "teammate",
            leadThreadId: leadId,
            role: gt("SEO & Growth"),
            soul: gt(
              "Sharp growth writer grounded strictly in real product truth. Zero AI fluff, zero invented metrics, crisp positioning.",
            ),
            brief: gt("Own SEO, content, and launch assets for {name}.", { name: title }),
          },
          modelSelection,
          runtimeMode: projectSettings.defaultRuntimeMode,
          interactionMode: "default",
          branch: null,
          worktreePath: null,
        },
      });
    }

    await writeDoc({
      environmentId: envId,
      input: {
        projectId: activeProject.id,
        path: ".dropwave/docs/core-loop.md",
        title: gt("Core loop & done bar"),
        kind: "loop",
        content: `# ${title} Core Loop\n\nLead agent: ${botTitle}\nShipped means: ${shippedText}\n\n## Steps\n${cleanedSteps
          .map((s, idx) => `${idx + 1}. ${s.title} (${s.owner})`)
          .join("\n")}\n\n## Autonomy\nRisk level: ${riskLevel.toUpperCase()}\n`,
      },
    }).catch(() => undefined);

    if (finalSoul) {
      await writeDoc({
        environmentId: envId,
        input: {
          projectId: activeProject.id,
          path: ".dropwave/docs/soul.md",
          title: gt("{name} Soul", { name: botTitle }),
          kind: "brief",
          content: `# ${botTitle} Soul\n\n${finalSoul}\n`,
        },
      }).catch(() => undefined);
    }

    await saveMemory({
      environmentId: envId,
      input: {
        projectId: activeProject.id,
        botThreadId: leadId,
        kind: "rule",
        text: gt("Done bar: {done}", { done: shippedText }),
        quote: shippedText,
        confidence: "confirmed",
      },
    }).catch(() => undefined);

    setBusy(false);
    workspace.refreshOpenAsksCount();
    workspace.openThread(scopeThreadRef(envId, leadId));
  };

  return (
    <div data-dw-pillar-body="">
      <header data-dw-pillar-head="">
        <button type="button" data-dw-back-pill="" onClick={onCancel}>
          <ArrowLeftIcon className="size-3.5" />
          <T>Back</T>
        </button>

        <div data-dw-step-indicator="">
          <span data-active={!activeProject ? "true" : undefined}>
            <T>1. Project & folder</T>
          </span>
          <span aria-hidden="true">→</span>
          <span data-active={activeProject ? "true" : undefined}>
            <T>2. AI Chief of Staff</T>
          </span>
        </div>

        <div data-dw-head-actions="">
          <button
            type="button"
            data-dw-header-pill=""
            onClick={() => openCommandPalette({ open: "add-project" })}
          >
            <FolderPlusIcon className="size-3.5" />
            <T>Browse folder</T>
          </button>
        </div>
      </header>

      <div data-dw-stream="">
        {/* STEP 1: Fast Project Basics — name + connect or create folder cleanly in glass */}
        {!activeProject ? (
          <div data-dw-onboard-basics="">
            <h2>
              <T>Set up your project</T>
            </h2>
            <p>
              <T>
                Name the project and connect an existing folder or create a fresh one. Next, your
                Chief of Staff will walk you through soul, core loop, and helpers.
              </T>
            </p>

            {unconfiguredProjects.length > 0 ? (
              <div data-dw-setup-card="">
                <div data-dw-setup-card-head="">
                  <span>
                    <T>Existing projects ready for a Chief of Staff</T>
                  </span>
                </div>
                <div data-dw-quick-chips="">
                  {unconfiguredProjects.map((proj) => (
                    <button
                      key={proj.id}
                      type="button"
                      data-dw-quick-chip=""
                      onClick={() => setBoundProject(proj)}
                    >
                      <strong>{proj.title}</strong>
                      <small style={{ opacity: 0.55, marginLeft: 6 }}>{proj.workspaceRoot}</small>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <form data-dw-setup-card="" onSubmit={(e) => void handleCreateProject(e)}>
              <div data-dw-setup-card-head="">
                <span>
                  <T>Or create / link a new project</T>
                </span>
              </div>
              <label data-dw-field-label="">
                <span>
                  <T>Project name</T>
                </span>
                <input
                  data-dw-custom-answer=""
                  value={newProjectTitle}
                  onChange={(e) => setNewProjectTitle(e.currentTarget.value)}
                  placeholder={gt("e.g. Hivra, Nibbii, Pocket CRM")}
                  required
                />
              </label>
              <label data-dw-field-label="">
                <span>
                  <T>Folder path</T>
                </span>
                <input
                  data-dw-custom-answer=""
                  value={newFolderPath}
                  onChange={(e) => setNewFolderPath(e.currentTarget.value)}
                  placeholder={gt("/Users/you/Projects/my-app")}
                  required
                />
              </label>
              <label data-dw-check-row="">
                <input
                  type="checkbox"
                  checked={createIfMissing}
                  onChange={(e) => setCreateIfMissing(e.currentTarget.checked)}
                />
                <span>
                  <T>Create this folder automatically if it does not exist yet</T>
                </span>
              </label>

              {error ? (
                <p data-dropwave-form-error="" role="alert">
                  {error}
                </p>
              ) : null}

              <div data-dw-setup-submit="">
                <button
                  type="submit"
                  data-dw-white-pill=""
                  disabled={creatingProject || !newProjectTitle.trim() || !newFolderPath.trim()}
                >
                  {creatingProject ? <T>Creating…</T> : <T>Continue to AI onboarding</T>}
                  <ArrowRightIcon className="size-3.5" />
                </button>
              </div>
            </form>
          </div>
        ) : (
          /* STEP 2: Conversational AI Chief of Staff Onboarding */
          <>
            <div data-dw-msg="bot">
              <span data-dw-msg-avatar="bot">DW</span>
              <div data-dw-msg-stack="">
                <div data-dw-bubble="bot">
                  <T>
                    Connected to{" "}
                    <strong>
                      <Var>{activeProject.title}</Var>
                    </strong>
                    . What does shipped mean here? When can I call work done?
                  </T>
                </div>
                {!doneSubmitted ? (
                  <div data-dw-quick-chips="">
                    <button
                      type="button"
                      data-dw-quick-chip=""
                      onClick={() => {
                        setDoneBar(gt("Tested live with screenshots and checks green"));
                        setDoneSubmitted(true);
                      }}
                    >
                      <T>Tested live with screenshots and checks green</T>
                    </button>
                    <button
                      type="button"
                      data-dw-quick-chip=""
                      onClick={() => {
                        setDoneBar(gt("PR reviewed, CI green, and merged cleanly"));
                        setDoneSubmitted(true);
                      }}
                    >
                      <T>PR reviewed, CI green, and merged cleanly</T>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {doneSubmitted ? (
              <>
                <div data-dw-msg="owner">
                  <div data-dw-bubble="owner">{doneBar}</div>
                </div>

                <div data-dw-msg="bot">
                  <span data-dw-msg-avatar="bot">DW</span>
                  <div data-dw-msg-stack="">
                    <div data-dw-bubble="bot">
                      <T>
                        Pick my name and soul, tweak the core loop for{" "}
                        <Var>{activeProject.title}</Var>, and choose your specialist bots.
                      </T>
                    </div>

                    <div data-dw-setup-card="">
                      <div data-dw-setup-card-head="">
                        <span>
                          <T>Bot identity & soul</T>
                        </span>
                      </div>
                      <div data-dw-soul-presets="">
                        {SOUL_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            data-dw-risk-btn=""
                            aria-pressed={soulPresetId === preset.id}
                            onClick={() => {
                              setSoulPresetId(preset.id);
                              setLeadName(preset.name);
                              setSoulText(m(preset.soul));
                            }}
                          >
                            {preset.name} · {m(preset.label)}
                          </button>
                        ))}
                      </div>
                      <input
                        data-dw-custom-answer=""
                        value={leadName}
                        onChange={(e) => setLeadName(e.currentTarget.value)}
                        placeholder={gt("Bot name (e.g. Atlas, Chief of Staff)")}
                        aria-label={gt("Bot name")}
                      />
                      <textarea
                        data-dw-soul-input=""
                        rows={3}
                        value={soulText}
                        onChange={(e) => setSoulText(e.currentTarget.value)}
                        placeholder={gt("How should this bot think, speak, and push back?")}
                        aria-label={gt("Bot soul")}
                      />
                    </div>

                    <div data-dw-setup-card="">
                      <div data-dw-setup-card-head="">
                        <span>
                          <T>Core loop</T>
                        </span>
                        <button
                          type="button"
                          data-dw-inline-link=""
                          onClick={() =>
                            setSteps((prev) => [
                              ...prev,
                              { id: `s-${Date.now()}`, title: "", owner: "Main bot" },
                            ])
                          }
                        >
                          <PlusIcon className="size-3" />
                          <T>Add step</T>
                        </button>
                      </div>
                      <ol data-dw-setup-steps="">
                        {steps.map((step, index) => (
                          <li key={step.id}>
                            <span data-dw-mono="dim">{index + 1}</span>
                            <input
                              value={step.title}
                              onChange={(e) => {
                                const val = e.currentTarget.value;
                                setSteps((prev) =>
                                  prev.map((item, idx) =>
                                    idx === index ? { ...item, title: val } : item,
                                  ),
                                );
                              }}
                              placeholder={gt("Step name")}
                            />
                            <DropwaveSelect
                              value={step.owner}
                              options={
                                [
                                  { value: "Main bot", label: gt("Main bot") },
                                  { value: "QA bot", label: gt("QA bot") },
                                  { value: "SEO bot", label: gt("SEO bot") },
                                ] satisfies ReadonlyArray<DropwaveSelectOption>
                              }
                              ariaLabel={gt("Step owner")}
                              compact
                              onChange={(val) => {
                                setSteps((prev) =>
                                  prev.map((item, idx) =>
                                    idx === index ? { ...item, owner: val } : item,
                                  ),
                                );
                              }}
                            />
                            <button
                              type="button"
                              data-dw-mini-icon=""
                              aria-label={gt("Move up")}
                              onClick={() => moveStep(index, -1)}
                            >
                              <ArrowUpIcon className="size-3" />
                            </button>
                            <button
                              type="button"
                              data-dw-mini-icon=""
                              aria-label={gt("Move down")}
                              onClick={() => moveStep(index, 1)}
                            >
                              <ArrowDownIcon className="size-3" />
                            </button>
                            <button
                              type="button"
                              data-dw-mini-icon=""
                              aria-label={gt("Remove step")}
                              onClick={() =>
                                setSteps((prev) => prev.filter((_, idx) => idx !== index))
                              }
                            >
                              <XIcon className="size-3" />
                            </button>
                          </li>
                        ))}
                      </ol>
                    </div>

                    <div data-dw-setup-card="">
                      <div data-dw-setup-card-head="">
                        <span>
                          <T>Specialists & autonomy</T>
                        </span>
                      </div>
                      <div data-dw-helper-checks="">
                        <label data-dw-check-row="">
                          <input
                            type="checkbox"
                            checked={wantQa}
                            onChange={(e) => setWantQa(e.currentTarget.checked)}
                          />
                          <span data-dw-monogram="indigo">QA</span>
                          <span>
                            <T>QA bot (verifies builds & catches regressions)</T>
                          </span>
                        </label>
                        <label data-dw-check-row="">
                          <input
                            type="checkbox"
                            checked={wantSeo}
                            onChange={(e) => setWantSeo(e.currentTarget.checked)}
                          />
                          <span data-dw-monogram="emerald">GR</span>
                          <span>
                            <T>Growth / SEO bot (pages, audits, launch assets)</T>
                          </span>
                        </label>
                      </div>

                      <div data-dw-risk-pills="">
                        {(["careful", "normal", "yolo"] as const).map((level) => (
                          <button
                            key={level}
                            type="button"
                            data-dw-risk-btn=""
                            aria-pressed={riskLevel === level}
                            onClick={() => setRiskLevel(level)}
                          >
                            {level === "yolo"
                              ? "YOLO"
                              : level === "careful"
                                ? gt("Careful")
                                : gt("Normal")}
                          </button>
                        ))}
                      </div>

                      {error ? (
                        <p data-dropwave-form-error="" role="alert">
                          {error}
                        </p>
                      ) : null}

                      <div data-dw-setup-submit="">
                        <button
                          type="button"
                          data-dw-white-pill=""
                          disabled={busy}
                          onClick={() => void launchLoop()}
                        >
                          <CheckIcon className="size-3.5" />
                          {busy ? <T>Launching…</T> : <T>Launch Chief of Staff</T>}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </>
        )}
      </div>

      {activeProject && !doneSubmitted ? (
        <form data-dw-composer-wrap="" onSubmit={handleChatSubmit}>
          <div data-dw-pill-composer="">
            <input
              value={composerText}
              onChange={(e) => setComposerText(e.currentTarget.value)}
              placeholder={gt("Describe what shipped means for {name}…", {
                name: activeProject.title,
              })}
            />
            <button
              type="submit"
              data-dw-send-btn=""
              aria-label={gt("Send")}
              disabled={!composerText.trim()}
            >
              <SendIcon className="size-3.5" />
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
