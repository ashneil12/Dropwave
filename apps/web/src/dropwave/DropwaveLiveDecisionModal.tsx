import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type {
  ThreadPendingApproval,
  ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import type { ProviderApprovalDecision, ScopedThreadRef } from "@t3tools/contracts";
import { T, Var, useGT } from "gt-react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookmarkCheckIcon,
  CheckCircle2Icon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { Dialog, DialogPopup } from "../components/ui/dialog";
import { serverEnvironment } from "../state/server";
import { environmentThreadDetails, threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { keyOfThread } from "./model";

function LiveThreadDecisionBody({
  thread,
  project,
  lead,
  onOpenInChat,
  onSavedRule,
}: {
  thread: EnvironmentThreadShell;
  project: EnvironmentProject | null;
  lead: EnvironmentThreadShell | null;
  onOpenInChat: (ref: ScopedThreadRef) => void;
  onSavedRule: () => void;
}) {
  const gt = useGT();
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const pending = useAtomValue(environmentThreadDetails.pendingRequestsAtom(threadRef));
  const [busy, setBusy] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const [customText, setCustomText] = useState("");

  const respondApproval = useOrchestrationCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const respondInput = useOrchestrationCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });
  const updateMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const saveMemory = useAtomCommand(serverEnvironment.dropwaveMemorySave, { reportFailure: false });

  const firstApproval: ThreadPendingApproval | undefined = pending?.approvals[0];
  const firstInput: ThreadPendingUserInput | undefined = pending?.userInputs[0];

  const handleApproval = async (decision: ProviderApprovalDecision) => {
    if (!firstApproval || busy) return;
    setBusy(true);
    await respondApproval({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        requestId: firstApproval.requestId,
        decision,
      },
    });
    setBusy(false);
  };

  if (firstApproval) {
    return (
      <div data-dw-decision-body="">
        <div data-dw-decision-meta="">
          <span data-dw-badge="violet">{project?.title ?? gt("Project")}</span>
          <span data-dw-mono="muted">{firstApproval.requestKind}</span>
          <button type="button" data-dw-inline-link="" onClick={() => onOpenInChat(threadRef)}>
            <T>View in chat</T>
          </button>
        </div>

        <h2 data-dw-decision-title="">{thread.title}</h2>

        <div data-dw-decision-context-box="">
          <span data-dw-section-micro="">
            <T>Action requested</T>
          </span>
          <p>{firstApproval.detail || gt("Your agent is waiting for approval to proceed.")}</p>
          <em>
            <T>If you do nothing: this session stays paused.</T>
          </em>
        </div>

        <footer data-dw-decision-foot="">
          <button
            type="button"
            data-dw-ghost-xs=""
            disabled={busy}
            onClick={() => void handleApproval("decline")}
          >
            <T>Decline</T>
          </button>
          <div data-dw-needs-actions="">
            <button
              type="button"
              data-dw-white-pill=""
              disabled={busy}
              onClick={() => void handleApproval("accept")}
            >
              <T>Approve action</T>
            </button>
          </div>
        </footer>
      </div>
    );
  }

  const question = firstInput?.questions[0];
  if (firstInput && question) {
    const defaultLabel = question.options[0]?.label ?? "";
    const chosen = customText.trim() || selectedLabel || defaultLabel;

    const submit = async (alwaysDoThis: boolean) => {
      if (busy || !chosen) return;
      setBusy(true);
      const answers: Record<string, string> = {};
      for (const q of firstInput.questions) {
        answers[q.id] = q.id === question.id ? chosen : (q.options[0]?.label ?? chosen);
      }
      const res = await respondInput({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          requestId: firstInput.requestId,
          answers,
        },
      });
      if (res._tag === "Success" && alwaysDoThis && project) {
        const ruleText = `When asked "${question.question}": ${chosen}`;
        await saveMemory({
          environmentId: project.environmentId,
          input: {
            projectId: project.id,
            botThreadId: lead?.id ?? thread.id,
            kind: "rule",
            text: ruleText,
            quote: question.question,
            confidence: "confirmed",
          },
        }).catch(() => undefined);
        if (lead && lead.source.dropwaveBot?.kind === "lead") {
          const existing = lead.source.dropwaveBot.rules;
          if (!existing.includes(ruleText)) {
            await updateMetadata({
              environmentId: lead.environmentId,
              input: {
                threadId: lead.id,
                dropwaveBot: {
                  ...lead.source.dropwaveBot,
                  rules: [...existing, ruleText].slice(-50),
                },
              },
            }).catch(() => undefined);
          }
        }
        onSavedRule();
      }
      setBusy(false);
    };

    return (
      <div data-dw-decision-body="">
        <div data-dw-decision-meta="">
          <span data-dw-badge="violet">{project?.title ?? gt("Project")}</span>
          <span data-dw-mono="muted">{question.header}</span>
          <button type="button" data-dw-inline-link="" onClick={() => onOpenInChat(threadRef)}>
            <T>View in chat</T>
          </button>
        </div>

        <h2 data-dw-decision-title="">{thread.title}</h2>

        <div data-dw-decision-question="">
          <span data-dw-section-micro="">
            <T>Decision needed</T>
          </span>
          <strong>{question.question}</strong>
        </div>

        {question.options.length > 0 ? (
          <div data-dw-needs-options="">
            {question.options.map((opt, idx) => {
              const isSelected =
                !customText.trim() && (selectedLabel ?? defaultLabel) === opt.label;
              return (
                <button
                  key={opt.label}
                  type="button"
                  data-dw-option-row=""
                  aria-pressed={isSelected}
                  onClick={() => {
                    setSelectedLabel(opt.label);
                    setCustomText("");
                  }}
                >
                  <span data-dw-option-left="">
                    <span data-dw-radio={isSelected ? "on" : "off"} />
                    <span>{opt.label}</span>
                  </span>
                  {idx === 0 ? (
                    <span data-dw-badge="emerald">
                      <T>Recommended</T>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}

        <input
          data-dw-custom-answer=""
          value={customText}
          onChange={(e) => setCustomText(e.currentTarget.value)}
          placeholder={gt("Or explain your own call in plain English…")}
        />

        <footer data-dw-decision-foot="">
          <button type="button" data-dw-ghost-xs="" onClick={() => onOpenInChat(threadRef)}>
            <T>Open thread</T>
          </button>
          <div data-dw-needs-actions="">
            <button
              type="button"
              data-dw-ghost-sm=""
              disabled={busy || !chosen}
              onClick={() => void submit(false)}
            >
              <T>Just this once</T>
            </button>
            <button
              type="button"
              data-dw-white-pill=""
              disabled={busy || !chosen}
              onClick={() => void submit(true)}
            >
              <BookmarkCheckIcon className="size-3.5" />
              <T>Always do this</T>
            </button>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div data-dw-decision-body="">
      <div data-dw-decision-meta="">
        <span data-dw-badge="violet">{project?.title ?? gt("Project")}</span>
        <span data-dw-mono="muted">{thread.title}</span>
      </div>
      <div data-dw-decision-context-box="">
        <p>
          <T>Loading pending request details from this thread…</T>
        </p>
      </div>
      <footer data-dw-decision-foot="">
        <span />
        <button type="button" data-dw-white-pill="" onClick={() => onOpenInChat(threadRef)}>
          <T>Open in chat</T>
        </button>
      </footer>
    </div>
  );
}

export function DropwaveLiveDecisionModal({
  open,
  needs,
  projects,
  leadsByProjectKey,
  onClose,
  onOpenThread,
  onSavedRule,
}: {
  open: boolean;
  needs: ReadonlyArray<EnvironmentThreadShell>;
  projects: ReadonlyArray<EnvironmentProject>;
  leadsByProjectKey: ReadonlyMap<string, EnvironmentThreadShell>;
  onClose: () => void;
  onOpenThread: (ref: ScopedThreadRef) => void;
  onSavedRule: () => void;
}) {
  const gt = useGT();
  const [cursor, setCursor] = useState(0);

  if (!open) return null;

  const safeIndex = needs.length > 0 ? Math.min(cursor, needs.length - 1) : 0;
  const active = needs[safeIndex] ?? null;
  const project = active
    ? (projects.find(
        (p) => p.id === active.projectId && p.environmentId === active.environmentId,
      ) ?? null)
    : null;
  const lead = active
    ? (leadsByProjectKey.get(`${active.environmentId}:${active.projectId}`) ?? null)
    : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogPopup data-dw-decision-modal="" showCloseButton={false}>
        <header data-dw-decision-head="">
          <div data-dw-decision-head-left="">
            <span data-dw-needs-tag="">
              <span data-dw-dot="coral" data-pulse="" />
              <T>Decision Queue</T>
            </span>
            {needs.length > 0 ? (
              <span data-dw-mono="muted">
                <T>
                  <Var>{safeIndex + 1}</Var> of <Var>{needs.length}</Var>
                </T>
              </span>
            ) : null}
          </div>

          <div data-dw-decision-head-right="">
            {needs.length > 1 ? (
              <div data-dw-decision-nav="">
                <button
                  type="button"
                  data-dw-mini-icon=""
                  aria-label={gt("Previous decision")}
                  disabled={safeIndex <= 0}
                  onClick={() => setCursor((c) => Math.max(0, c - 1))}
                >
                  <ArrowLeftIcon className="size-3.5" />
                </button>
                <button
                  type="button"
                  data-dw-mini-icon=""
                  aria-label={gt("Next decision")}
                  disabled={safeIndex >= needs.length - 1}
                  onClick={() => setCursor((c) => Math.min(needs.length - 1, c + 1))}
                >
                  <ArrowRightIcon className="size-3.5" />
                </button>
              </div>
            ) : null}
            <button
              type="button"
              data-dw-mini-icon=""
              aria-label={gt("Close decisions")}
              onClick={onClose}
            >
              <XIcon className="size-4" />
            </button>
          </div>
        </header>

        {active ? (
          <LiveThreadDecisionBody
            key={keyOfThread(active)}
            thread={active}
            project={project}
            lead={lead}
            onSavedRule={onSavedRule}
            onOpenInChat={(ref) => {
              onClose();
              onOpenThread(ref);
            }}
          />
        ) : (
          <div data-dw-decision-clear="">
            <CheckCircle2Icon className="size-9" data-dw-icon="emerald" />
            <h3>
              <T>All decisions resolved</T>
            </h3>
            <p>
              <T>Nothing across your projects needs you right now.</T>
            </p>
            <button type="button" data-dw-white-pill="" onClick={onClose}>
              <T>Back to workspace</T>
            </button>
          </div>
        )}
      </DialogPopup>
    </Dialog>
  );
}
