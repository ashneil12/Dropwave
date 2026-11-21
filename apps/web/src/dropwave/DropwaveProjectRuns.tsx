import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { type DropwaveBotProfile, type DropwaveRiskLevel } from "@t3tools/contracts";
import { T, Var, useGT } from "gt-react";
import { useState } from "react";

import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { DropwaveBotAvatar } from "./DropwaveBotAvatar";
import { useModelSelectionLabel } from "./useWorkerReviews";
import { useDropwaveWorkspace } from "./workspaceContext";

function AskToChange({
  leadName,
  message,
  disabled,
}: {
  leadName: string;
  message: string;
  disabled?: boolean;
}) {
  const workspace = useDropwaveWorkspace();
  const lead = workspace?.lead ?? null;
  if (!workspace || !lead) return null;
  return (
    <button
      type="button"
      data-dw-ask-change=""
      disabled={disabled}
      onClick={() =>
        workspace.prefillComposer(scopeThreadRef(lead.environmentId, lead.id), message)
      }
    >
      <T>
        Ask <Var>{leadName}</Var> to change
      </T>
    </button>
  );
}

/** Read-mostly "How this project runs" card; the agent stays the source of truth. */
export function DropwaveProjectRuns({
  bot,
  onClose,
}: {
  bot: EnvironmentThreadShell;
  onClose: () => void;
}) {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const profile = bot.source.dropwaveBot;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const leadProfile = profile?.kind === "lead" ? profile : null;
  const workerModelName = useModelSelectionLabel(
    bot.environmentId,
    leadProfile?.workerModelSelection ?? null,
  );
  const reviewModelName = useModelSelectionLabel(
    bot.environmentId,
    leadProfile?.workerReviewModelSelection ?? null,
  );
  const leadModelName = useModelSelectionLabel(bot.environmentId, bot.source.modelSelection);

  if (!workspace || !profile || profile.kind !== "lead") return null;

  const lead = bot;
  const teammates = workspace.bots.filter(
    (candidate) =>
      candidate.id !== lead.id &&
      candidate.source.dropwaveBot?.kind === "teammate" &&
      candidate.source.dropwaveBot.leadThreadId === lead.id,
  );
  const steps =
    profile.loopSteps && profile.loopSteps.length > 0
      ? profile.loopSteps.map((step) => ({ key: step.id, title: step.title }))
      : profile.workflow.map((title) => ({ key: title, title }));
  const roleLine = profile.brief.trim().split(/\n|\.\s/)[0] ?? "";
  const riskLevel = profile.riskLevel ?? "yolo";

  const setRisk = async (next: DropwaveRiskLevel) => {
    if (pending || next === riskLevel) return;
    setPending(true);
    setError(null);
    const nextProfile: DropwaveBotProfile = { ...profile, riskLevel: next };
    const result = await update({
      environmentId: bot.environmentId,
      input: { threadId: bot.id, title: bot.title, dropwaveBot: nextProfile },
    }).catch((cause: unknown) => {
      setError(
        cause instanceof Error ? cause.message : gt("The risk level couldn’t be saved. Try again."),
      );
      return null;
    });
    setPending(false);
    if (result === null) return;
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const cause = squashAtomCommandFailure(result);
      setError(
        cause instanceof Error ? cause.message : gt("The risk level couldn’t be saved. Try again."),
      );
    }
  };

  const riskOptions: ReadonlyArray<{
    readonly value: DropwaveRiskLevel;
    readonly label: string;
  }> = [
    { value: "careful", label: gt("Careful") },
    { value: "normal", label: gt("Normal") },
    { value: "yolo", label: gt("YOLO") },
  ];

  const workerSetup = (() => {
    if (leadProfile === null) return null;
    const workerSelection = leadProfile.workerModelSelection;
    const workerPhrase = workerSelection
      ? gt("{name} does the work", { name: workerModelName ?? workerSelection.model })
      : gt("Workers inherit the {name} model", {
          name: leadModelName ?? bot.source.modelSelection.model,
        });
    const reviewSelection = leadProfile.workerReviewModelSelection;
    const reviewPhrase = reviewSelection
      ? gt("{name} checks it", { name: reviewModelName ?? reviewSelection.model })
      : gt("no review step");
    const rounds = leadProfile.workerReviewRounds ?? 1;
    const roundsPhrase =
      reviewSelection !== undefined && rounds > 0
        ? rounds === 1
          ? gt("1 fix round before it reaches you")
          : gt("{count} fix rounds before it reaches you", { count: rounds })
        : null;
    return { workerPhrase, reviewPhrase, roundsPhrase };
  })();

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogPopup data-dropwave-runs-card="">
        <DialogHeader>
          <DialogTitle>
            <T>How this project runs</T>
          </DialogTitle>
          <DialogDescription>
            <T>
              Your lead bot owns the work and asks only when it truly needs you. Everything here is
              set by chatting with the team. This card just shows the current setup.
            </T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div data-dw-runs-body="">
            <section data-dw-runs-lead="">
              <DropwaveBotAvatar
                name={lead.title}
                seed={profile.avatarSeed}
                role="lead"
                size="lg"
              />
              <div data-dw-runs-lead-text="">
                <strong>{lead.title}</strong>
                {roleLine ? <span>{roleLine}</span> : null}
              </div>
              <AskToChange
                leadName={lead.title}
                message={gt(
                  "I'd like to update my role or the project brief. Let's talk it through.",
                )}
              />
            </section>

            {steps.length > 0 ? (
              <section data-dw-runs-section="">
                <header data-dw-runs-section-head="">
                  <span data-dw-section-micro="">
                    <T>Core loop</T>
                  </span>
                  <AskToChange
                    leadName={lead.title}
                    message={gt("I'd like to change the core loop steps for this project.")}
                  />
                </header>
                <ol data-dw-runs-steps="">
                  {steps.map((step, index) => (
                    <li key={step.key}>
                      <span data-dw-runs-step-num="">{index + 1}</span>
                      <span>{step.title}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {profile.doneDefinition ? (
              <section data-dw-runs-section="">
                <header data-dw-runs-section-head="">
                  <span data-dw-section-micro="">
                    <T>Done means</T>
                  </span>
                  <AskToChange
                    leadName={lead.title}
                    message={gt("I'd like to change what counts as done for this project.")}
                  />
                </header>
                <p data-dw-runs-done="">{profile.doneDefinition}</p>
              </section>
            ) : null}

            {workerSetup ? (
              <section data-dw-runs-section="">
                <header data-dw-runs-section-head="">
                  <span data-dw-section-micro="">
                    <T>Workers</T>
                  </span>
                  <AskToChange
                    leadName={lead.title}
                    message={gt("I'd like to change how workers and review are set up.")}
                  />
                </header>
                <p data-dw-runs-worker-line="">
                  {workerSetup.workerPhrase} · {workerSetup.reviewPhrase}
                  {workerSetup.roundsPhrase ? ` · ${workerSetup.roundsPhrase}` : ""}
                </p>
              </section>
            ) : null}

            <section data-dw-runs-section="">
              <header data-dw-runs-section-head="">
                <span data-dw-section-micro="">
                  <T>Risk level</T>
                </span>
              </header>
              <div data-dw-risk-pills="" role="radiogroup" aria-label={gt("Risk level")}>
                {riskOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={riskLevel === option.value}
                    data-dw-risk-btn=""
                    disabled={pending}
                    onClick={() => void setRisk(option.value)}
                  >
                    <strong>{option.label}</strong>
                  </button>
                ))}
              </div>
              {error ? (
                <p data-dropwave-form-error="" role="alert">
                  {error}
                </p>
              ) : null}
            </section>

            <section data-dw-runs-section="">
              <header data-dw-runs-section-head="">
                <span data-dw-section-micro="">
                  <T>Teammates</T>
                </span>
                <AskToChange
                  leadName={lead.title}
                  message={gt("I'd like to change the team: add, remove, or reshape a bot.")}
                />
              </header>
              {teammates.length > 0 ? (
                <div data-dw-runs-faces="">
                  {teammates.map((teammate) => (
                    <button
                      key={teammate.id}
                      type="button"
                      data-dw-runs-face=""
                      onClick={() =>
                        workspace.openThread(scopeThreadRef(teammate.environmentId, teammate.id))
                      }
                    >
                      <DropwaveBotAvatar
                        name={teammate.title}
                        seed={teammate.source.dropwaveBot?.avatarSeed}
                        role="specialist"
                        size="md"
                      />
                      <span>{teammate.title}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p data-dw-runs-empty="">
                  <T>No other bots yet. Your lead handles everything itself.</T>
                </p>
              )}
            </section>

            <section data-dw-runs-section="">
              <header data-dw-runs-section-head="">
                <span data-dw-section-micro="">
                  <T>Memory</T>
                </span>
                <button
                  type="button"
                  data-dw-ask-change=""
                  onClick={() => {
                    onClose();
                    workspace.setMainView("docs", { docsTab: "memory" });
                  }}
                >
                  <T>Open memory</T>
                </button>
              </header>
              <p data-dw-runs-empty="">
                <T>Preferences, rules and facts the crew carries across projects.</T>
              </p>
            </section>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
