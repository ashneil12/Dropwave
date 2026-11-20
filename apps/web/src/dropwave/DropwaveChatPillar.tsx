import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  ThreadPendingApproval,
  ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import {
  DEFAULT_SERVER_SETTINGS,
  type DropwaveRiskLevel,
  type ProviderApprovalDecision,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { T, Var, msg, useGT, useMessages } from "gt-react";
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ExpandIcon,
  FileTextIcon,
  MicIcon,
  PlusIcon,
  SquareIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { newMessageId } from "../lib/utils";
import { providerInstanceEntriesFor } from "../providerInstances";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useThreadProjection, useThreadVisibleTurnItems } from "../state/entities";
import { useEnvironmentProviders } from "../state/environments";
import { environmentServerConfigsAtom, serverEnvironment } from "../state/server";
import { environmentThreadDetails, threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { DropwaveSelect, type DropwaveSelectOption } from "./DropwaveSelect";
import { workState } from "./model";
import type { SamplePendingReview, SampleVenture } from "./sampleData";
import { useDropwaveWorkspace } from "./workspaceContext";

const EMPTY_PENDING_REQUESTS_ATOM = Atom.make(null);

/* oxlint-disable t3code/no-untranslated-copy -- model brand names */
const PREVIEW_MODEL_OPTIONS: ReadonlyArray<DropwaveSelectOption> = [
  { value: "claude:opus-4-6", label: "Claude Opus 4.6", hint: msg("Deep orchestration") },
  { value: "claude:sonnet-4-6", label: "Claude Sonnet 4.6", hint: msg("Fast default") },
  { value: "codex:gpt-5-4", label: "GPT-5.4 Codex", hint: msg("Heavy coding") },
];
/* oxlint-enable t3code/no-untranslated-copy */

function formatClock(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function renderRichInline(text: string) {
  const parts = text.split(/(#\d+)/g);
  return parts.map((part, idx) =>
    /^#\d+$/.test(part) ? (
      <span key={`${part}-${idx === 0 ? "a" : "b"}`} data-dw-mono="emerald">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function ReviewDecisionCard({
  review,
  highlighted,
  resolvedLabel,
  onResolve,
  onExpand,
}: {
  review: SamplePendingReview;
  highlighted: boolean;
  resolvedLabel?: string | undefined;
  onResolve: (choiceLabel: string, alwaysDoThis: boolean) => void;
  onExpand: () => void;
}) {
  const gt = useGT();
  const defaultOpt = review.options.find((o) => o.recommended) ?? review.options[0];
  const [selectedId, setSelectedId] = useState(defaultOpt?.id ?? "");
  const [customText, setCustomText] = useState("");

  if (resolvedLabel) {
    return (
      <div data-dw-resolved-pill="">
        <CheckIcon className="size-3.5" data-dw-icon="emerald" />
        <span>{resolvedLabel}</span>
      </div>
    );
  }

  const chosenLabel =
    customText.trim() ||
    review.options.find((opt) => opt.id === selectedId)?.label ||
    defaultOpt?.label ||
    "";

  return (
    <div
      data-dw-needs-card=""
      data-highlighted={highlighted ? "true" : undefined}
      id={`review-${review.id}`}
    >
      <div data-dw-needs-card-head="">
        <span data-dw-needs-tag="">
          <span data-dw-dot="coral" data-pulse="" />
          <T>Needs You</T>
        </span>
        <div data-dw-needs-head-right="">
          <span data-dw-mono="muted">{review.sessionTag}</span>
          <button
            type="button"
            data-dw-mini-icon=""
            aria-label={gt("Expand full context")}
            onClick={onExpand}
          >
            <ExpandIcon className="size-3.5" />
          </button>
        </div>
      </div>
      <div data-dw-needs-copy="">
        <p>{renderRichInline(review.context)}</p>
        <strong>{review.question}</strong>
        <em>{review.ifDoNothing}</em>
      </div>
      <div data-dw-needs-options="">
        {review.options.map((opt) => {
          const isSelected = !customText.trim() && selectedId === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              data-dw-option-row=""
              aria-pressed={isSelected}
              onClick={() => {
                setSelectedId(opt.id);
                setCustomText("");
              }}
            >
              <span data-dw-option-left="">
                <span data-dw-radio={isSelected ? "on" : "off"} />
                <span>{opt.label}</span>
              </span>
              {opt.recommended ? (
                <span data-dw-badge="emerald">
                  <T>Recommended</T>
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <input
        data-dw-custom-answer=""
        value={customText}
        onChange={(e) => setCustomText(e.currentTarget.value)}
        placeholder={gt("Or type your own answer…")}
      />
      <div data-dw-needs-actions="">
        <button
          type="button"
          data-dw-ghost-sm=""
          disabled={!chosenLabel}
          onClick={() => onResolve(chosenLabel, false)}
        >
          <T>Just this once</T>
        </button>
        <button
          type="button"
          data-dw-white-pill=""
          disabled={!chosenLabel}
          onClick={() => onResolve(chosenLabel, true)}
        >
          <T>Always do this</T>
        </button>
      </div>
    </div>
  );
}

function LiveApprovalCard({
  approval,
  threadRef,
}: {
  approval: ThreadPendingApproval;
  threadRef: ScopedThreadRef;
}) {
  const gt = useGT();
  const [busy, setBusy] = useState(false);
  const respondApproval = useOrchestrationCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });

  const decide = async (decision: ProviderApprovalDecision) => {
    if (busy) return;
    setBusy(true);
    await respondApproval({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        requestId: approval.requestId,
        decision,
      },
    });
    setBusy(false);
  };

  return (
    <div data-dw-needs-card="">
      <div data-dw-needs-card-head="">
        <span data-dw-needs-tag="">
          <span data-dw-dot="coral" data-pulse="" />
          <T>Approval needed</T>
        </span>
        <span data-dw-mono="muted">{approval.requestKind}</span>
      </div>
      <div data-dw-needs-copy="">
        <strong>{approval.detail || gt("Your bot wants to run an action.")}</strong>
      </div>
      <div data-dw-needs-actions="">
        <button
          type="button"
          data-dw-ghost-sm=""
          disabled={busy}
          onClick={() => void decide("decline")}
        >
          <T>Decline</T>
        </button>
        <button
          type="button"
          data-dw-white-pill=""
          disabled={busy}
          onClick={() => void decide("accept")}
        >
          <T>Approve</T>
        </button>
      </div>
    </div>
  );
}

function LiveUserInputCard({
  input,
  threadRef,
  onSaveRule,
}: {
  input: ThreadPendingUserInput;
  threadRef: ScopedThreadRef;
  onSaveRule: (ruleText: string, quote: string) => void;
}) {
  const gt = useGT();
  const [busy, setBusy] = useState(false);
  const [customText, setCustomText] = useState("");
  const [selectedByQuestion, setSelectedByQuestion] = useState<Record<string, string>>({});

  const respondInput = useOrchestrationCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });

  const questions = input.questions;
  const firstQuestion = questions[0];
  if (!firstQuestion) return null;

  const chosen =
    customText.trim() ||
    selectedByQuestion[firstQuestion.id] ||
    firstQuestion.options[0]?.label ||
    "";

  const submitAnswer = async (alwaysDoThis: boolean) => {
    if (busy || !chosen) return;
    setBusy(true);
    const answers: Record<string, string> = {};
    for (const q of questions) {
      answers[q.id] =
        q.id === firstQuestion.id
          ? chosen
          : selectedByQuestion[q.id] || q.options[0]?.label || chosen;
    }
    const res = await respondInput({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        requestId: input.requestId,
        answers,
      },
    });
    if (res._tag === "Success" && alwaysDoThis) {
      onSaveRule(`When asked "${firstQuestion.question}": ${chosen}`, firstQuestion.question);
    }
    setBusy(false);
  };

  return (
    <div data-dw-needs-card="">
      <div data-dw-needs-card-head="">
        <span data-dw-needs-tag="">
          <span data-dw-dot="coral" data-pulse="" />
          <T>Needs You</T>
        </span>
        <span data-dw-mono="muted">{firstQuestion.header}</span>
      </div>
      <div data-dw-needs-copy="">
        <strong>{firstQuestion.question}</strong>
      </div>
      {firstQuestion.options.length > 0 ? (
        <div data-dw-needs-options="">
          {firstQuestion.options.map((opt, idx) => {
            const isSelected =
              !customText.trim() &&
              (selectedByQuestion[firstQuestion.id] ?? firstQuestion.options[0]?.label) ===
                opt.label;
            return (
              <button
                key={opt.label}
                type="button"
                data-dw-option-row=""
                aria-pressed={isSelected}
                onClick={() => {
                  setSelectedByQuestion((prev) => ({ ...prev, [firstQuestion.id]: opt.label }));
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
        placeholder={gt("Or type your own answer…")}
      />
      <div data-dw-needs-actions="">
        <button
          type="button"
          data-dw-ghost-sm=""
          disabled={busy || !chosen}
          onClick={() => void submitAnswer(false)}
        >
          <T>Just this once</T>
        </button>
        <button
          type="button"
          data-dw-white-pill=""
          disabled={busy || !chosen}
          onClick={() => void submitAnswer(true)}
        >
          <T>Always do this</T>
        </button>
      </div>
    </div>
  );
}

export function DropwaveChatPillar({
  venture,
  activePreviewAgentId,
  resolvedReviews,
  onResolvePreviewReview,
  onSendPreviewMessage,
  onOpenDoc,
  onChangePreviewRisk,
}: {
  venture: SampleVenture | null;
  activePreviewAgentId: string | null;
  resolvedReviews: Readonly<Record<string, string>>;
  onResolvePreviewReview: (reviewId: string, choiceLabel: string, alwaysDoThis: boolean) => void;
  onSendPreviewMessage: (text: string) => void;
  onOpenDoc: (docId: string) => void;
  onChangePreviewRisk?: (risk: DropwaveRiskLevel) => void;
}) {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const m = useMessages();
  const [draft, setDraft] = useState("");
  const [expandedFolds, setExpandedFolds] = useState<Record<string, boolean>>({});
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [previewModel, setPreviewModel] = useState(PREVIEW_MODEL_OPTIONS[0]!.value);
  const streamEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isPreview = workspace?.mode === "preview" && venture !== null;
  const activeThread = !isPreview ? (workspace?.activeThread ?? workspace?.lead ?? null) : null;
  const activeThreadRef = activeThread
    ? scopeThreadRef(activeThread.environmentId, activeThread.id)
    : null;

  const projection = useThreadProjection(activeThreadRef);
  const visibleItems = useThreadVisibleTurnItems(activeThreadRef);
  const pendingRequests = useAtomValue(
    activeThreadRef
      ? environmentThreadDetails.pendingRequestsAtom(activeThreadRef)
      : EMPTY_PENDING_REQUESTS_ATOM,
  );
  const providersByEnv = useEnvironmentProviders();
  const liveProviders = activeThread ? (providersByEnv.get(activeThread.environmentId) ?? []) : [];

  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const interruptTurn = useOrchestrationCommand(threadEnvironment.interruptTurn, {
    reportFailure: false,
  });
  const setModelCmd = useOrchestrationCommand(threadEnvironment.setModelSelection, {
    reportFailure: false,
  });
  const updateMetadataCmd = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const saveMemory = useAtomCommand(serverEnvironment.dropwaveMemorySave, { reportFailure: false });

  const messageCount = isPreview
    ? (venture?.messages.length ?? 0)
    : (projection?.projection.messages.length ?? 0);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps chat scrolled to latest message
  useEffect(() => {
    if (messageCount < 0) return;
    streamEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messageCount]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- auto-grows multiline composer textarea smoothly
  useEffect(() => {
    const el = textareaRef.current;
    if (!el || draft.length < 0) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(180, Math.max(24, el.scrollHeight))}px`;
  }, [draft]);

  if (!workspace) return null;

  const activePreviewAgent =
    isPreview && activePreviewAgentId
      ? (venture!.helpers.find((h) => h.id === activePreviewAgentId) ?? null)
      : null;

  const liveBot = !isPreview ? (workspace.activeBot ?? workspace.lead) : null;
  const headerName = isPreview
    ? (activePreviewAgent?.name ?? venture!.leadName)
    : (activeThread?.title ?? liveBot?.title ?? gt("Chief of Staff"));
  const headerCode = isPreview
    ? (activePreviewAgent?.code ?? venture!.leadCode)
    : headerName
        .split(/\s+/)
        .map((w) => w[0] ?? "")
        .join("")
        .slice(0, 2)
        .toUpperCase() || "CS";

  const currentRisk: DropwaveRiskLevel = isPreview
    ? venture!.riskLevel
    : workspace.lead?.source.dropwaveBot?.kind === "lead"
      ? (workspace.lead.source.dropwaveBot.riskLevel ?? "yolo")
      : "yolo";

  const headerBadge = isPreview
    ? activePreviewAgent
      ? activePreviewAgent.role
      : currentRisk === "yolo"
        ? gt("Autonomous")
        : gt("Guided")
    : liveBot?.source.dropwaveBot?.kind === "lead"
      ? currentRisk === "yolo"
        ? gt("Autonomous")
        : gt("Guided")
      : gt("Agent");
  const headerSub = isPreview
    ? activePreviewAgent
      ? `${venture!.name} · ${activePreviewAgent.statusLine}`
      : venture!.leadStatus
    : `${workspace.project?.title ?? gt("Workspace")} · ${
        activeThread ? workState(activeThread) : gt("Ready")
      }`;

  const isLiveRunning = !isPreview && activeThread ? workState(activeThread) === "working" : false;
  const openAsksBadge = isPreview ? venture!.objectives.length : workspace.openAsksCount;

  // Build real model options from live providers
  const liveModelEntries: Array<{
    readonly key: string;
    readonly label: string;
    readonly hint: string;
    readonly instanceId: NonNullable<typeof activeThread>["source"]["modelSelection"]["instanceId"];
    readonly model: string;
  }> = [];
  if (!isPreview && activeThread) {
    const settings =
      appAtomRegistry.get(environmentServerConfigsAtom).get(activeThread.environmentId)?.settings ??
      DEFAULT_SERVER_SETTINGS;
    const instances = providerInstanceEntriesFor(
      liveProviders,
      settings,
      activeThread.projectId,
    ).filter((entry) => entry.enabled && entry.isAvailable);
    for (const inst of instances) {
      for (const model of inst.models.slice(0, 6)) {
        liveModelEntries.push({
          key: `${inst.instanceId}::${model.slug}`,
          label: model.name,
          hint: inst.displayName,
          instanceId: inst.instanceId,
          model: model.slug,
        });
      }
    }
  }
  const activeLiveModelKey = activeThread
    ? `${activeThread.source.modelSelection.instanceId}::${activeThread.source.modelSelection.model}`
    : "";
  const resolvedPreviewModels: ReadonlyArray<DropwaveSelectOption> = PREVIEW_MODEL_OPTIONS.map(
    (opt) => ({
      ...opt,
      ...(opt.hint ? { hint: m(opt.hint) } : {}),
    }),
  );
  const modelOptions: ReadonlyArray<DropwaveSelectOption> = isPreview
    ? resolvedPreviewModels
    : liveModelEntries.length > 0
      ? liveModelEntries.map((entry) => ({
          value: entry.key,
          label: entry.label,
          hint: entry.hint,
        }))
      : activeThread
        ? [
            {
              value: activeLiveModelKey,
              label: activeThread.source.modelSelection.model,
            },
          ]
        : resolvedPreviewModels;

  const currentModelValue = isPreview ? previewModel : activeLiveModelKey;

  const handleModelChange = (nextKey: string) => {
    if (isPreview) {
      setPreviewModel(nextKey);
      return;
    }
    if (!activeThread) return;
    const found = liveModelEntries.find((e) => e.key === nextKey);
    if (!found) return;
    void setModelCmd({
      environmentId: activeThread.environmentId,
      input: {
        threadId: activeThread.id,
        modelSelection: {
          instanceId: found.instanceId,
          model: found.model,
        },
      },
    });
  };

  const riskOptions: ReadonlyArray<DropwaveSelectOption<DropwaveRiskLevel>> = [
    { value: "yolo", label: "YOLO", hint: gt("Decides 99% end-to-end") },
    { value: "normal", label: gt("Normal"), hint: gt("Asks on ambiguous calls") },
    { value: "careful", label: gt("Careful"), hint: gt("Checks in early") },
  ];

  const handleRiskChange = (nextRisk: DropwaveRiskLevel) => {
    if (isPreview) {
      onChangePreviewRisk?.(nextRisk);
      return;
    }
    const lead = workspace.lead;
    if (!lead || lead.source.dropwaveBot?.kind !== "lead") return;
    void updateMetadataCmd({
      environmentId: lead.environmentId,
      input: {
        threadId: lead.id,
        dropwaveBot: {
          ...lead.source.dropwaveBot,
          riskLevel: nextRisk,
        },
      },
    });
  };

  const submitMessage = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSendError(null);

    if (isPreview) {
      onSendPreviewMessage(text);
      setDraft("");
      return;
    }

    if (!activeThread || !activeThreadRef) {
      workspace.setMainView("setup");
      return;
    }

    setSending(true);
    const res = await startTurn({
      environmentId: activeThreadRef.environmentId,
      input: {
        threadId: activeThreadRef.threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text,
          attachments: [],
        },
        runtimeMode: activeThread.source.runtimeMode,
        interactionMode: activeThread.source.interactionMode,
      },
    });
    setSending(false);
    if (res._tag === "Success") {
      setDraft("");
      workspace.refreshOpenAsksCount();
    } else if (!isAtomCommandInterrupted(res)) {
      const cause = squashAtomCommandFailure(res);
      setSendError(cause instanceof Error ? cause.message : gt("Could not send message."));
    }
  };

  const handleSend = (event: FormEvent) => {
    event.preventDefault();
    void submitMessage();
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submitMessage();
    }
  };

  const handleStop = async () => {
    if (!activeThreadRef) return;
    await interruptTurn({
      environmentId: activeThreadRef.environmentId,
      input: { threadId: activeThreadRef.threadId },
    });
  };

  const handleSaveRule = (ruleText: string, quote: string) => {
    if (!workspace.project) return;
    void saveMemory({
      environmentId: workspace.project.environmentId,
      input: {
        projectId: workspace.project.id,
        botThreadId: workspace.lead?.id ?? null,
        kind: "rule",
        text: ruleText,
        quote,
        confidence: "confirmed",
      },
    });
  };

  const liveMessages = projection?.projection.messages ?? [];
  const liveApprovals = pendingRequests?.approvals ?? [];
  const liveUserInputs = pendingRequests?.userInputs ?? [];
  const streamingAssistant = visibleItems
    .filter((entry) => entry.item.type === "assistant_message" && entry.item.status === "running")
    .at(-1);

  return (
    <div data-dw-pillar-body="">
      <header data-dw-pillar-head="">
        <div data-dw-head-identity="">
          <button
            type="button"
            data-dw-avatar-ring=""
            aria-label={gt("Bot and core loop settings")}
            onClick={() => {
              if (!isPreview && liveBot) {
                workspace.openPanel({ kind: "profile", target: { kind: "edit", bot: liveBot } });
              }
            }}
          >
            {headerCode}
          </button>
          <div data-dw-head-meta="">
            <div data-dw-head-title-row="">
              <h2>{headerName}</h2>
              <span data-dw-badge="violet">{headerBadge}</span>
            </div>
            <p>{renderRichInline(headerSub)}</p>
          </div>
        </div>

        <div data-dw-head-actions="">
          <button
            type="button"
            data-dw-header-pill=""
            onClick={() => workspace.openPanel({ kind: "asks" })}
          >
            <T>Asks</T>
            <strong>{openAsksBadge}</strong>
          </button>
          <button
            type="button"
            data-dw-header-pill=""
            onClick={() => workspace.setMainView("docs")}
          >
            <FileTextIcon className="size-3.5" />
            <T>Docs</T>
          </button>
        </div>
      </header>

      <div data-dw-stream="">
        {isPreview ? (
          <>
            {venture!.messages.map((msg) => {
              if (msg.role === "owner") {
                return (
                  <div key={msg.id} data-dw-msg="owner">
                    <div data-dw-bubble="owner">
                      <p>{msg.text}</p>
                      <span data-dw-msg-time="">{msg.time}</span>
                    </div>
                  </div>
                );
              }
              const review = msg.reviewId
                ? venture!.reviews.find((r) => r.id === msg.reviewId)
                : undefined;
              const isFoldOpen = Boolean(expandedFolds[msg.id]);

              return (
                <div key={msg.id} data-dw-msg="bot">
                  <span data-dw-msg-avatar="bot">{msg.authorCode}</span>
                  <div data-dw-msg-stack="">
                    <div data-dw-bubble="bot">{renderRichInline(msg.text)}</div>

                    {msg.folded ? (
                      <div data-dw-fold-wrap="">
                        <button
                          type="button"
                          data-dw-fold-pill=""
                          onClick={() =>
                            setExpandedFolds((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))
                          }
                        >
                          <span data-dw-dot="emerald" />
                          <strong>{msg.folded.title}</strong>
                          <span data-dw-muted-sep="">· {msg.folded.summary}</span>
                          {isFoldOpen ? (
                            <ChevronUpIcon className="size-3" />
                          ) : (
                            <ChevronDownIcon className="size-3" />
                          )}
                        </button>
                        {isFoldOpen ? (
                          <div data-dw-fold-body="">
                            {msg.folded.messages.map((fm) => (
                              <div
                                key={`${fm.sender}-${fm.text.slice(0, 18)}`}
                                data-dw-fold-line=""
                              >
                                <strong>{fm.sender}</strong>
                                <p>{fm.text}</p>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {msg.briefCard ? (
                      <button
                        type="button"
                        data-dw-brief-card=""
                        onClick={() => {
                          onOpenDoc(msg.briefCard!.docId);
                          workspace.setMainView("docs");
                        }}
                      >
                        <div data-dw-brief-head="">
                          <span>
                            <FileTextIcon className="size-3.5" data-dw-icon="indigo" />
                            <strong>{msg.briefCard.title}</strong>
                          </span>
                          <small>{msg.briefCard.byline}</small>
                        </div>
                        {msg.briefCard.rows.map((row) => (
                          <div key={row.tier} data-dw-brief-row={row.highlight ? "hi" : ""}>
                            <strong>{row.tier}</strong>
                            <span>{row.cadence}</span>
                            <span data-dw-mono={row.highlight ? "emerald" : "bright"}>
                              {row.price}
                            </span>
                          </div>
                        ))}
                      </button>
                    ) : null}

                    {msg.reviewId && resolvedReviews[msg.reviewId] ? (
                      <div data-dw-resolved-pill="">
                        <CheckIcon className="size-3.5" data-dw-icon="emerald" />
                        <span>{resolvedReviews[msg.reviewId]}</span>
                      </div>
                    ) : review ? (
                      <ReviewDecisionCard
                        review={review}
                        highlighted={workspace.highlightReviewId === review.id}
                        resolvedLabel={resolvedReviews[review.id]}
                        onExpand={() => workspace.openDecisionQueue(review.id)}
                        onResolve={(choice, always) =>
                          onResolvePreviewReview(review.id, choice, always)
                        }
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </>
        ) : !activeThread ? (
          <div data-dw-empty-chat="">
            <div data-dw-avatar-ring="lg">DW</div>
            <h3>
              <T>Ready to wire your Chief of Staff</T>
            </h3>
            <p>
              <T>
                Set up your project and core loop through a quick conversation instead of a config
                form.
              </T>
            </p>
            <button
              type="button"
              data-dw-white-pill=""
              onClick={() => workspace.setMainView("setup")}
            >
              <T>Start conversational setup</T>
            </button>
          </div>
        ) : (
          <>
            {liveMessages.length === 0 ? (
              <div data-dw-empty-chat="">
                <div data-dw-avatar-ring="lg">{headerCode}</div>
                <h3>{headerName}</h3>
                <p>
                  {liveBot?.source.dropwaveBot?.brief || (
                    <T>
                      Dump ideas, decisions, or tasks. Everything is tracked through your core loop.
                    </T>
                  )}
                </p>
                <div data-dw-quick-chips="">
                  <button
                    type="button"
                    data-dw-quick-chip=""
                    onClick={() =>
                      setDraft(
                        gt(
                          "Let us design our core loop together. Ask me what shipped means and wire the steps with dropwave_team.",
                        ),
                      )
                    }
                  >
                    <T>Design core loop</T>
                  </button>
                  <button
                    type="button"
                    data-dw-quick-chip=""
                    onClick={() =>
                      setDraft(
                        gt("Summarize where this project stands and what we should ship next."),
                      )
                    }
                  >
                    <T>Plan next work</T>
                  </button>
                </div>
              </div>
            ) : (
              liveMessages.map((msg) =>
                msg.role === "user" ? (
                  <div key={msg.id} data-dw-msg="owner">
                    <div data-dw-bubble="owner">
                      <p>{msg.text}</p>
                      <span data-dw-msg-time="">{formatClock(msg.createdAt.toString())}</span>
                    </div>
                  </div>
                ) : (
                  <div key={msg.id} data-dw-msg="bot">
                    <span data-dw-msg-avatar="bot">{headerCode}</span>
                    <div data-dw-msg-stack="">
                      <div data-dw-bubble="bot" data-multiline="">
                        {msg.text}
                      </div>
                    </div>
                  </div>
                ),
              )
            )}

            {streamingAssistant && streamingAssistant.item.type === "assistant_message" ? (
              <div data-dw-msg="bot">
                <span data-dw-msg-avatar="bot">{headerCode}</span>
                <div data-dw-msg-stack="">
                  <div data-dw-bubble="bot" data-multiline="">
                    {streamingAssistant.item.text || gt("Thinking…")}
                  </div>
                </div>
              </div>
            ) : null}

            {activeThreadRef
              ? liveApprovals.map((approval) => (
                  <div key={approval.requestId} data-dw-msg="bot">
                    <span data-dw-msg-avatar="bot">{headerCode}</span>
                    <div data-dw-msg-stack="">
                      <LiveApprovalCard approval={approval} threadRef={activeThreadRef} />
                    </div>
                  </div>
                ))
              : null}

            {activeThreadRef
              ? liveUserInputs.map((userInput) => (
                  <div key={userInput.requestId} data-dw-msg="bot">
                    <span data-dw-msg-avatar="bot">{headerCode}</span>
                    <div data-dw-msg-stack="">
                      <LiveUserInputCard
                        input={userInput}
                        threadRef={activeThreadRef}
                        onSaveRule={handleSaveRule}
                      />
                    </div>
                  </div>
                ))
              : null}
          </>
        )}
        <div ref={streamEndRef} />
      </div>

      <div data-dw-composer-wrap="">
        <div data-dw-ticker="">
          <div data-dw-ticker-left="">
            <span data-dw-dot="emerald" data-pulse="" />
            {isPreview ? (
              <>
                <strong>{venture!.liveTicker.bot}</strong>
                <span>{venture!.liveTicker.text}</span>
              </>
            ) : isLiveRunning ? (
              <>
                <strong>{headerName}</strong>
                <span>
                  <T>is working through the core loop…</T>
                </span>
              </>
            ) : (
              <span>
                <T>
                  <Var>{headerName}</Var> is standing by
                </T>
              </span>
            )}
          </div>
          {isPreview ? <span data-dw-mono="dim">{venture!.liveTicker.age}</span> : null}
        </div>

        {sendError ? (
          <p data-dropwave-form-error="" role="alert">
            {sendError}
          </p>
        ) : null}

        <form data-dw-composer-box="" onSubmit={handleSend}>
          <textarea
            ref={textareaRef}
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={handleTextareaKeyDown}
            placeholder={gt("Dump ideas, asks, or reply to {name}…", { name: headerName })}
            aria-label={gt("Message {name}", { name: headerName })}
          />
          <div data-dw-composer-bar="">
            <div data-dw-composer-left="">
              <button
                type="button"
                data-dw-composer-icon=""
                aria-label={gt("Add tracked ask")}
                onClick={() => workspace.openPanel({ kind: "asks" })}
              >
                <PlusIcon className="size-4" />
              </button>
              <DropwaveSelect
                value={currentModelValue}
                options={modelOptions}
                ariaLabel={gt("Select model")}
                compact
                onChange={handleModelChange}
              />
              <DropwaveSelect
                value={currentRisk}
                options={riskOptions}
                ariaLabel={gt("Autonomy level")}
                compact
                onChange={handleRiskChange}
              />
            </div>

            <div data-dw-composer-right="">
              <button
                type="button"
                data-dw-composer-icon=""
                aria-label={gt("Voice input")}
                onClick={() => workspace.openPanel({ kind: "asks" })}
              >
                <MicIcon className="size-4" />
              </button>
              {isLiveRunning ? (
                <button
                  type="button"
                  data-dw-send-btn="stop"
                  aria-label={gt("Stop run")}
                  onClick={() => void handleStop()}
                >
                  <SquareIcon className="size-3" />
                </button>
              ) : (
                <button
                  type="submit"
                  data-dw-send-btn=""
                  aria-label={gt("Send message")}
                  disabled={!draft.trim() || sending}
                >
                  <ArrowUpIcon className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
