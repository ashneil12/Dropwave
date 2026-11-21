import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  DEFAULT_SERVER_SETTINGS,
  DropwaveBotProfile,
  type DropwaveLoopStep,
  type DropwaveRiskLevel,
  type ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { Link } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { T, Var, msg, useGT, useMessages } from "gt-react";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

import { requestConfirmDialog } from "../confirmDialog";
import { Button } from "../components/ui/button";
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
import { DropwaveSelect, type DropwaveSelectOption } from "./DropwaveSelect";
import { useDropwaveWorkspace, type BotEditorTarget } from "./workspaceContext";

const validProfile = Schema.is(DropwaveBotProfile);

const DEFAULT_LOOP_STEPS: ReadonlyArray<DropwaveLoopStep> = [
  { id: "step-plan", title: msg("Plan and split work") },
  { id: "step-build", title: msg("Build in isolated worktrees") },
  { id: "step-qa", title: msg("Verify and QA end-to-end") },
  { id: "step-ship", title: msg("Ship and report evidence") },
];

function initialLoopSteps(
  profile: DropwaveBotProfile | undefined,
  resolve: (key: string) => string,
): Array<DropwaveLoopStep> {
  if (profile?.kind !== "lead") {
    return DEFAULT_LOOP_STEPS.map((step) => ({ ...step, title: resolve(step.title) }));
  }
  if (profile.loopSteps && profile.loopSteps.length > 0) return [...profile.loopSteps];
  if (profile.workflow.length > 0) {
    return profile.workflow.map((title, index) => ({ id: `step-${index + 1}`, title }));
  }
  return DEFAULT_LOOP_STEPS.map((step) => ({ ...step, title: resolve(step.title) }));
}

export function DropwaveBotEditor({
  target,
  onClose,
}: {
  target: BotEditorTarget;
  onClose: () => void;
}) {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const m = useMessages();
  const existing = target.kind === "edit" ? target.bot : null;
  const profile = existing?.source.dropwaveBot;
  const decision = target.kind === "edit" ? target.decision : undefined;
  const environmentId =
    target.kind === "edit" ? target.bot.environmentId : target.project.environmentId;
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const isLead = target.kind === "new-lead" || profile?.kind === "lead";

  const [name, setName] = useState(existing?.title ?? (isLead ? "Chief of Staff" : ""));
  const [role, setRole] = useState(profile?.kind === "teammate" ? (profile.role ?? "") : "");
  const [brief, setBrief] = useState(profile?.brief ?? "");
  const [soul, setSoul] = useState(profile?.soul ?? "");
  const [riskLevel, setRiskLevel] = useState<DropwaveRiskLevel>(
    profile?.kind === "lead" ? (profile.riskLevel ?? "yolo") : "yolo",
  );
  const [doneDefinition, setDoneDefinition] = useState(
    profile?.kind === "lead" ? (profile.doneDefinition ?? "") : "",
  );
  const [fixRoundCap, setFixRoundCap] = useState(
    profile?.kind === "lead" ? (profile.fixRoundCap ?? 3) : 3,
  );
  const [steps, setSteps] = useState<Array<DropwaveLoopStep>>(() => initialLoopSteps(profile, m));
  const [rules, setRules] = useState<Array<string>>(
    profile?.kind === "lead" ? [...profile.rules] : [],
  );
  const [newRule, setNewRule] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useOrchestrationCommand(threadEnvironment.create, { reportFailure: false });
  const update = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const archive = useOrchestrationCommand(threadEnvironment.archive, { reportFailure: false });
  const saveMemory = useAtomCommand(serverEnvironment.dropwaveMemorySave, { reportFailure: false });

  if (!workspace) return null;

  const projectTeammates = workspace.bots.filter(
    (bot) =>
      bot.environmentId === environmentId &&
      bot.source.dropwaveBot?.kind === "teammate" &&
      bot.source.dropwaveBot.leadThreadId === (existing?.id ?? workspace.lead?.id),
  );

  const saveError = (cause: unknown) =>
    cause instanceof Error ? cause.message : gt("The bot couldn’t be saved. Try again.");

  const addRuleLine = () => {
    const cleaned = newRule.trim();
    if (!cleaned || rules.includes(cleaned)) return;
    setRules((prev) => [...prev, cleaned].slice(-50));
    setNewRule("");
  };

  const addStep = () => {
    setSteps((prev) => [...prev, { id: `step-${Date.now()}`, title: "" }]);
  };

  const moveStep = (index: number, delta: -1 | 1) => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= steps.length) return;
    setSteps((prev) => {
      const copy = [...prev];
      const item = copy[index]!;
      copy[index] = copy[nextIndex]!;
      copy[nextIndex] = item;
      return copy;
    });
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !canOperate) return;
    setError(null);
    const title = name.trim();
    if (title === "") {
      setError(gt("Enter a name."));
      return;
    }

    const pendingRule = newRule.trim();
    const finalRules =
      pendingRule && !rules.includes(pendingRule) ? [...rules, pendingRule] : rules;
    const cleanedSteps = steps
      .map((step) => ({
        ...step,
        title: step.title.trim(),
      }))
      .filter((step) => step.title.length > 0)
      .slice(0, 12);

    const leadThreadId =
      target.kind === "new-teammate"
        ? target.lead.id
        : profile?.kind === "teammate"
          ? profile.leadThreadId
          : null;

    const preserved = {
      ...(profile?.personaId ? { personaId: profile.personaId } : {}),
      ...(profile?.avatarSeed !== undefined ? { avatarSeed: profile.avatarSeed } : {}),
    };
    const next: DropwaveBotProfile | null = isLead
      ? {
          kind: "lead",
          brief: brief.trim(),
          ...(soul.trim() ? { soul: soul.trim() } : {}),
          workflow: cleanedSteps.map((step) => step.title),
          rules: finalRules.slice(-50),
          riskLevel,
          ...(doneDefinition.trim() ? { doneDefinition: doneDefinition.trim() } : {}),
          fixRoundCap: Math.min(10, Math.max(1, Math.round(fixRoundCap))),
          loopSteps: cleanedSteps,
          ...preserved,
          ...(profile?.kind === "lead" && profile.onboardingPhase !== undefined
            ? { onboardingPhase: profile.onboardingPhase }
            : {}),
          ...(profile?.kind === "lead" && profile.workerModelSelection !== undefined
            ? { workerModelSelection: profile.workerModelSelection }
            : {}),
          ...(profile?.kind === "lead" && profile.workerReviewModelSelection !== undefined
            ? { workerReviewModelSelection: profile.workerReviewModelSelection }
            : {}),
          ...(profile?.kind === "lead" && profile.workerReviewRounds !== undefined
            ? { workerReviewRounds: profile.workerReviewRounds }
            : {}),
        }
      : leadThreadId
        ? {
            kind: "teammate",
            brief: brief.trim(),
            ...(soul.trim() ? { soul: soul.trim() } : {}),
            leadThreadId,
            ...(role.trim() ? { role: role.trim() } : {}),
            ...preserved,
          }
        : null;

    if (next === null || !validProfile(next)) {
      setError(gt("Keep to 12 loop steps and 50 rules, with at most 400 characters per line."));
      return;
    }
    const threadId = existing?.id ?? newThreadId();
    let commit;
    if (target.kind === "edit") {
      commit = () => update({ environmentId, input: { threadId, title, dropwaveBot: next } });
    } else {
      const providers = readEnvironmentProviders(environmentId) ?? [];
      const settings =
        appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.settings ??
        DEFAULT_SERVER_SETTINGS;
      const projectSettings = resolveProjectSettings(settings, target.project.id).settings;
      const configured = target.project.defaultModelSelection;
      const available = providerInstanceEntriesFor(providers, settings, target.project.id);
      const modelSelection =
        configured &&
        available.some(
          (entry) =>
            entry.instanceId === configured.instanceId && entry.enabled && entry.isAvailable,
        )
          ? configured
          : resolveProjectDefaultProviderModelSelection(providers, settings, target.project.id);
      if (!modelSelection) {
        setError(gt("Connect an agent provider in Settings, then try again."));
        return;
      }
      commit = () =>
        create({
          environmentId,
          input: {
            threadId,
            projectId: target.project.id,
            title,
            dropwaveBot: next,
            modelSelection,
            runtimeMode: projectSettings.defaultRuntimeMode,
            interactionMode: "default",
            branch: null,
            worktreePath: null,
          },
        });
    }

    setPending(true);
    const result = await commit().catch((cause: unknown) => {
      setError(saveError(cause));
      return null;
    });
    if (result && result._tag === "Success" && decision && pendingRule && workspace.project) {
      await saveMemory({
        environmentId,
        input: {
          projectId: workspace.project.id,
          botThreadId: threadId,
          kind: "rule",
          text: pendingRule,
          quote: decision.slice(0, 480),
          confidence: "confirmed",
        },
      }).catch(() => undefined);
    }
    setPending(false);
    if (result === null) return;
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setError(saveError(squashAtomCommandFailure(result)));
      return;
    }
    if (target.kind === "edit") onClose();
    else workspace.openThread(scopeThreadRef(environmentId, threadId));
  };

  const archiveBot = async () => {
    if (!existing || !canOperate || pending) return;
    setPending(true);
    const message = isLead
      ? gt("Archive this lead bot? You can set up a new lead for this project afterwards.")
      : gt("Archive this bot?");
    if (!(await requestConfirmDialog(message))) {
      setPending(false);
      return;
    }
    const result = await archive({ environmentId, input: { threadId: existing.id } }).catch(
      (cause: unknown) => {
        setError(
          cause instanceof Error ? cause.message : gt("The bot couldn’t be archived. Try again."),
        );
        return null;
      },
    );
    setPending(false);
    if (result === null) return;
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const cause = squashAtomCommandFailure(result);
        setError(
          cause instanceof Error ? cause.message : gt("The bot couldn’t be archived. Try again."),
        );
      }
      return;
    }
    onClose();
  };

  const riskOptions: ReadonlyArray<{
    readonly value: DropwaveRiskLevel;
    readonly label: string;
    readonly hint: string;
  }> = [
    {
      value: "careful",
      label: gt("Careful"),
      hint: gt("Asks before meaningful product or architecture choices."),
    },
    {
      value: "normal",
      label: gt("Normal"),
      hint: gt("Handles routine work; asks on ambiguous product calls."),
    },
    {
      value: "yolo",
      label: gt("YOLO"),
      hint: gt(
        "Decides 99% end-to-end. Stops only for money, keys, public posts, or irreversible prod.",
      ),
    },
  ];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogPopup data-dropwave-editor="">
        <form onSubmit={(event) => void save(event)} aria-busy={pending}>
          <DialogHeader>
            <DialogTitle>
              {decision ? (
                <T>Save standing rule</T>
              ) : target.kind === "edit" ? (
                <T>Bot & core loop</T>
              ) : isLead ? (
                <T>Set up Chief of Staff</T>
              ) : (
                <T>Add a bot</T>
              )}
            </DialogTitle>
            <DialogDescription>
              {decision ? (
                <T>
                  Confirm the rule so your bots remember your preference next time without asking.
                </T>
              ) : isLead ? (
                <T>
                  Your main bot owns the core loop, manages workers, and only escalates what truly
                  needs you.
                </T>
              ) : (
                <T>
                  Give this specialist a clear job (like QA or SEO) so your main bot knows when to
                  bring it in.
                </T>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div data-dropwave-form="">
              {decision ? <p data-dropwave-rule-question="">{decision}</p> : null}

              <label hidden={Boolean(decision)}>
                <T>Name</T>
                <input
                  required
                  maxLength={100}
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                />
              </label>

              {!isLead && !decision ? (
                <label>
                  <T>Short role</T>
                  <input
                    maxLength={160}
                    value={role}
                    onChange={(event) => setRole(event.currentTarget.value)}
                    placeholder={gt("e.g. Acceptance QA on Canary, SEO & growth")}
                  />
                </label>
              ) : null}

              <label hidden={Boolean(decision)}>
                {isLead ? <T>Project brief</T> : <T>Responsibility</T>}
                <textarea
                  rows={2}
                  maxLength={4000}
                  value={brief}
                  onChange={(event) => setBrief(event.currentTarget.value)}
                  placeholder={
                    isLead
                      ? gt("What is this project and what should your main bot own?")
                      : gt("What work should this specialist handle end-to-end?")
                  }
                />
              </label>

              <label hidden={Boolean(decision)}>
                <T>Soul & voice</T>
                <textarea
                  rows={2}
                  maxLength={4000}
                  value={soul}
                  onChange={(event) => setSoul(event.currentTarget.value)}
                  placeholder={gt(
                    "Personality, tone, and principles (e.g. sharp, plain English, skeptical of untested claims)",
                  )}
                />
              </label>

              {isLead && !decision ? (
                <>
                  <div data-dropwave-field="">
                    <span data-dropwave-field-label="">
                      <T>Autonomy & risk level</T>
                    </span>
                    <div data-dropwave-risk-grid="" role="radiogroup" aria-label={gt("Risk level")}>
                      {riskOptions.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          role="radio"
                          aria-checked={riskLevel === opt.value}
                          data-dropwave-risk-pill=""
                          onClick={() => setRiskLevel(opt.value)}
                        >
                          <strong>{opt.label}</strong>
                          <small>{opt.hint}</small>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div data-dropwave-field="">
                    <div data-dropwave-field-head="">
                      <span data-dropwave-field-label="">
                        <T>Core loop</T>
                      </span>
                      <button
                        type="button"
                        data-dropwave-small-button=""
                        onClick={addStep}
                        disabled={steps.length >= 12}
                      >
                        <PlusIcon />
                        <T>Add step</T>
                      </button>
                    </div>
                    <ol data-dropwave-loop-steps="">
                      {steps.map((step, index) => (
                        <li key={step.id}>
                          <span data-dropwave-step-num="">{index + 1}</span>
                          <input
                            value={step.title}
                            maxLength={200}
                            placeholder={gt("Step name")}
                            onChange={(event) => {
                              const value = event.currentTarget.value;
                              setSteps((prev) =>
                                prev.map((item, idx) =>
                                  idx === index ? { ...item, title: value } : item,
                                ),
                              );
                            }}
                          />
                          <DropwaveSelect
                            value={step.ownerBotId ?? ""}
                            options={
                              [
                                { value: "", label: name || gt("Main bot") },
                                ...projectTeammates.map((helper) => ({
                                  value: helper.id,
                                  label: helper.title,
                                })),
                              ] satisfies ReadonlyArray<DropwaveSelectOption>
                            }
                            ariaLabel={gt("Step owner")}
                            compact
                            onChange={(value) => {
                              setSteps((prev) =>
                                prev.map((item, idx) =>
                                  idx === index
                                    ? {
                                        ...item,
                                        ownerBotId: value ? (value as ThreadId) : null,
                                      }
                                    : item,
                                ),
                              );
                            }}
                          />
                          <button
                            type="button"
                            data-dropwave-icon-button=""
                            aria-label={gt("Move step up")}
                            disabled={index === 0}
                            onClick={() => moveStep(index, -1)}
                          >
                            <ArrowUpIcon />
                          </button>
                          <button
                            type="button"
                            data-dropwave-icon-button=""
                            aria-label={gt("Move step down")}
                            disabled={index === steps.length - 1}
                            onClick={() => moveStep(index, 1)}
                          >
                            <ArrowDownIcon />
                          </button>
                          <button
                            type="button"
                            data-dropwave-icon-button=""
                            aria-label={gt("Remove step")}
                            onClick={() =>
                              setSteps((prev) => prev.filter((_, idx) => idx !== index))
                            }
                          >
                            <XIcon />
                          </button>
                        </li>
                      ))}
                    </ol>
                  </div>

                  <div data-dropwave-split-row="">
                    <label>
                      <T>What does “shipped” mean?</T>
                      <input
                        maxLength={1000}
                        value={doneDefinition}
                        onChange={(event) => setDoneDefinition(event.currentTarget.value)}
                        placeholder={gt("e.g. Verified live on Canary with tests green")}
                      />
                    </label>
                    <label data-dropwave-cap-field="">
                      <T>Fix rounds</T>
                      <input
                        type="number"
                        min={1}
                        max={10}
                        value={fixRoundCap}
                        onChange={(event) => setFixRoundCap(Number(event.currentTarget.value) || 3)}
                      />
                    </label>
                  </div>
                </>
              ) : null}

              {isLead ? (
                <div data-dropwave-field="">
                  <span data-dropwave-field-label="">
                    <T>
                      Standing rules (<Var>{rules.length}</Var>)
                    </T>
                  </span>
                  {rules.length > 0 ? (
                    <ul data-dropwave-rules-list="">
                      {rules.map((rule, index) => (
                        <li key={rule}>
                          <span>{rule}</span>
                          <button
                            type="button"
                            data-dropwave-icon-button=""
                            aria-label={gt("Remove rule")}
                            onClick={() =>
                              setRules((prev) => prev.filter((_, idx) => idx !== index))
                            }
                          >
                            <XIcon />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div data-dropwave-rule-add="">
                    <input
                      maxLength={400}
                      value={newRule}
                      onChange={(event) => setNewRule(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !decision) {
                          event.preventDefault();
                          addRuleLine();
                        }
                      }}
                      placeholder={
                        decision
                          ? gt("Write the standing rule for future decisions…")
                          : gt("Add a rule (e.g. Always match live experiment pricing)")
                      }
                    />
                    {!decision ? (
                      <button
                        type="button"
                        data-dropwave-small-button=""
                        disabled={!newRule.trim()}
                        onClick={addRuleLine}
                      >
                        <PlusIcon />
                        <T>Add</T>
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {!canOperate ? (
                <p role="status">
                  <T>This connection doesn’t have permission to edit the team.</T>
                </p>
              ) : null}
              {error ? (
                <p data-dropwave-form-error="" role="alert">
                  {error}{" "}
                  {error.includes("provider") ? (
                    <Link to="/settings/providers" onClick={onClose}>
                      <T>Provider settings</T>
                    </Link>
                  ) : null}
                </p>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            {existing && !decision ? (
              <button
                data-dropwave-archive=""
                type="button"
                onClick={() => void archiveBot()}
                disabled={!canOperate || pending}
              >
                <T>Archive</T>
              </button>
            ) : null}
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              <T>Cancel</T>
            </Button>
            <Button type="submit" disabled={!canOperate || pending}>
              {pending ? (
                <T>Saving…</T>
              ) : decision ? (
                <T>Save rule</T>
              ) : existing ? (
                <T>Save changes</T>
              ) : isLead ? (
                <T>Create Chief of Staff</T>
              ) : (
                <T>Add bot</T>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
