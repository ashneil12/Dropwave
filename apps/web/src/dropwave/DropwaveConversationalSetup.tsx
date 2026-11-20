import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
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
  ArrowUpIcon,
  CheckIcon,
  FolderPlusIcon,
  PlusIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";

import { openCommandPalette } from "../commandPaletteBus";
import { newThreadId } from "../lib/utils";
import {
  providerInstanceEntriesFor,
  resolveProjectDefaultProviderModelSelection,
} from "../providerInstances";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readEnvironmentProviders } from "../state/environments";
import { environmentServerConfigsAtom } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { DropwaveSelect, type DropwaveSelectOption } from "./DropwaveSelect";
import type { SampleVenture } from "./sampleData";
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

export function DropwaveConversationalSetup({
  onCancel,
  onCreatedPreviewVenture,
}: {
  onCancel: () => void;
  onCreatedPreviewVenture: (venture: SampleVenture) => void;
}) {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const m = useMessages();

  const preselectedLiveProject =
    workspace?.mode === "live" && workspace.project && !workspace.lead ? workspace.project : null;

  const [projectName, setProjectName] = useState(preselectedLiveProject?.title ?? "");
  const [nameSubmitted, setNameSubmitted] = useState(Boolean(preselectedLiveProject));
  const [doneBar, setDoneBar] = useState("");
  const [doneSubmitted, setDoneSubmitted] = useState(false);
  const [composerText, setComposerText] = useState("");

  const [steps, setSteps] = useState<Array<SetupStepDraft>>(() =>
    DEFAULT_SETUP_STEPS.map((step) => ({ ...step, title: m(step.title) })),
  );
  const [wantQa, setWantQa] = useState(true);
  const [wantSeo, setWantSeo] = useState(false);
  const [riskLevel, setRiskLevel] = useState<DropwaveRiskLevel>("yolo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createThread = useOrchestrationCommand(threadEnvironment.create, { reportFailure: false });

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

  const selectedLiveProject =
    workspace.mode === "live"
      ? (workspace.projects.find(
          (p) => p.title.toLowerCase() === projectName.trim().toLowerCase(),
        ) ??
        preselectedLiveProject ??
        unconfiguredProjects[0] ??
        null)
      : null;

  const handleChatSubmit = (event: FormEvent) => {
    event.preventDefault();
    const cleaned = composerText.trim();
    if (!cleaned) return;
    if (!nameSubmitted) {
      setProjectName(cleaned);
      setNameSubmitted(true);
      setComposerText("");
      return;
    }
    if (!doneSubmitted) {
      setDoneBar(cleaned);
      setDoneSubmitted(true);
      setComposerText("");
    }
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
    if (busy) return;
    setError(null);
    const title = projectName.trim() || gt("New Venture");
    const shippedText =
      doneBar.trim() || gt("Tested end-to-end with verified evidence before reporting done.");
    const cleanedSteps = steps.filter((s) => s.title.trim().length > 0);

    if (workspace.mode === "preview" || !selectedLiveProject) {
      const id = `venture-${Date.now()}`;
      const code = title
        .split(/\s+/)
        .map((w) => w[0] ?? "")
        .join("")
        .slice(0, 2)
        .toUpperCase();
      const helpers: SampleVenture["helpers"] = [
        ...(wantQa
          ? [
              {
                id: `${id}-qa`,
                code: "QA",
                name: `${title} QA`,
                role: "End-to-end verification",
                state: "idle" as const,
                statusLine: "Ready for first build",
                tone: "indigo" as const,
              },
            ]
          : []),
        ...(wantSeo
          ? [
              {
                id: `${id}-seo`,
                code: "SEO",
                name: `${title} Growth`,
                role: "Distribution & SEO",
                state: "idle" as const,
                statusLine: "Ready for launch pages",
                tone: "emerald" as const,
              },
            ]
          : []),
      ];
      onCreatedPreviewVenture({
        id,
        name: title,
        targetLine: gt("{name} Core Loop", { name: title }),
        statusWord: riskLevel === "yolo" ? gt("Autonomous Execution") : gt("Loop Ready"),
        riskLevel,
        sprintTitle: gt("{name}: First Core Loop", { name: title }),
        sprintProgress: 20,
        budgetUsed: 0,
        budgetLimit: 250,
        leadName: gt("Chief of Staff"),
        leadCode: code || "CS",
        leadStatus: gt("{name} · core loop wired and ready", { name: title }),
        liveTicker: {
          bot: gt("Chief of Staff"),
          text: gt("is ready for your first ask"),
          age: gt("now"),
        },
        loopSteps: cleanedSteps.map((s) => ({ title: s.title, owner: s.owner })),
        objectives: [
          {
            id: `${id}-o1`,
            title: gt("Run first task through loop"),
            status: "working",
            badge: gt("Ready"),
          },
        ],
        helpers,
        branches: [],
        reviews: [],
        sessions: [],
        messages: [
          {
            id: `${id}-m1`,
            role: "bot",
            author: gt("Chief of Staff"),
            authorCode: code || "CS",
            time: gt("Now"),
            text: gt(
              "Core loop is live for {name}. Shipped means: {done}. Drop your first idea or dump below and I will organize, delegate, and push it end-to-end.",
              { name: title, done: shippedText },
            ),
          },
        ],
        docs: [
          {
            id: `${id}-doc-loop`,
            path: ".dropwave/docs/core-loop.md",
            title: gt("Core loop & done bar"),
            kind: "loop",
            updated: gt("Now"),
            excerpt: shippedText,
            content: `# ${title} Core Loop\n\nShipped means: ${shippedText}\n\n${cleanedSteps
              .map((s, i) => `${i + 1}. ${s.title} (${s.owner})`)
              .join("\n")}`,
          },
        ],
        memories: [
          {
            id: `${id}-mem-1`,
            kind: "rule",
            text: gt("Done bar: {done}", { done: shippedText }),
            quote: shippedText,
          },
        ],
      });
      return;
    }

    // Live mode: create real Chief of Staff + selected Helper bots via orchestration-v2!
    const envId = selectedLiveProject.environmentId;
    const providers = readEnvironmentProviders(envId) ?? [];
    const settings =
      appAtomRegistry.get(environmentServerConfigsAtom).get(envId)?.settings ??
      DEFAULT_SERVER_SETTINGS;
    const projectSettings = resolveProjectSettings(settings, selectedLiveProject.id).settings;
    const configured = selectedLiveProject.defaultModelSelection;
    const available = providerInstanceEntriesFor(providers, settings, selectedLiveProject.id);
    const modelSelection =
      configured &&
      available.some(
        (entry) => entry.instanceId === configured.instanceId && entry.enabled && entry.isAvailable,
      )
        ? configured
        : resolveProjectDefaultProviderModelSelection(providers, settings, selectedLiveProject.id);
    if (!modelSelection) {
      setError(gt("Connect an agent provider in Settings first, then click launch again."));
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
        projectId: selectedLiveProject.id,
        title: gt("Chief of Staff"),
        dropwaveBot: {
          kind: "lead",
          brief: `${title}: ${shippedText}`,
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
          projectId: selectedLiveProject.id,
          title: `${title} QA`,
          dropwaveBot: {
            kind: "teammate",
            leadThreadId: leadId,
            role: gt("Verification & QA"),
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
          projectId: selectedLiveProject.id,
          title: gt("{name} Growth", { name: title }),
          dropwaveBot: {
            kind: "teammate",
            leadThreadId: leadId,
            role: gt("SEO & Growth"),
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

    setBusy(false);
    workspace.openThread(scopeThreadRef(envId, leadId));
  };

  return (
    <div data-dw-pillar-body="">
      <header data-dw-pillar-head="">
        <button type="button" data-dw-back-pill="" onClick={onCancel}>
          <ArrowLeftIcon className="size-3.5" />
          <T>Back</T>
        </button>
        <div data-dw-head-actions="">
          {workspace.mode === "live" ? (
            <button
              type="button"
              data-dw-header-pill=""
              onClick={() => openCommandPalette({ open: "add-project" })}
            >
              <FolderPlusIcon className="size-3.5" />
              <T>Link folder</T>
            </button>
          ) : null}
        </div>
      </header>

      <div data-dw-stream="">
        <div data-dw-msg="bot">
          <span data-dw-msg-avatar="bot">DW</span>
          <div data-dw-msg-stack="">
            <div data-dw-bubble="bot">
              <T>Hey, I am the main bot for whatever you set up next. What is the project?</T>
            </div>
            {!nameSubmitted && workspace.mode === "live" && unconfiguredProjects.length > 0 ? (
              <div data-dw-quick-chips="">
                {unconfiguredProjects.map((proj) => (
                  <button
                    key={proj.id}
                    type="button"
                    data-dw-quick-chip=""
                    onClick={() => {
                      setProjectName(proj.title);
                      setNameSubmitted(true);
                    }}
                  >
                    {proj.title}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {nameSubmitted ? (
          <>
            <div data-dw-msg="owner">
              <div data-dw-bubble="owner">{projectName}</div>
            </div>

            <div data-dw-msg="bot">
              <span data-dw-msg-avatar="bot">DW</span>
              <div data-dw-msg-stack="">
                <div data-dw-bubble="bot">
                  <T>
                    Got it, <Var>{projectName}</Var>. What does shipped mean here? When can I call
                    work done?
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
          </>
        ) : null}

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
                    Here is the core loop I would run for <Var>{projectName}</Var>. Tweak the steps,
                    pick any helpers, and choose how autonomous I should be.
                  </T>
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
                          onClick={() => setSteps((prev) => prev.filter((_, idx) => idx !== index))}
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
                      <T>Helpers & autonomy</T>
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
                  <p data-dw-risk-note="">
                    {riskLevel === "yolo" ? (
                      <T>
                        Decides 99% end-to-end. Stops only for money, keys, public posts, or
                        irreversible prod.
                      </T>
                    ) : riskLevel === "careful" ? (
                      <T>Checks in before meaningful product or architecture decisions.</T>
                    ) : (
                      <T>Handles routine execution; asks when product direction is ambiguous.</T>
                    )}
                  </p>

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
      </div>

      {!doneSubmitted ? (
        <form data-dw-composer-wrap="" onSubmit={handleChatSubmit}>
          <div data-dw-pill-composer="">
            <input
              value={composerText}
              onChange={(e) => setComposerText(e.currentTarget.value)}
              placeholder={
                !nameSubmitted
                  ? gt("Name your project or describe what you are building…")
                  : gt("Describe what shipped means for this project…")
              }
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
