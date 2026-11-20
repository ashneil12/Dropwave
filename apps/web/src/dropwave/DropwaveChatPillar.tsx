import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  ChildThreadApproval,
  ThreadPendingApproval,
  ThreadPendingUserInput,
} from "@t3tools/client-runtime/state/thread-requests";
import {
  DEFAULT_SERVER_SETTINGS,
  type DropwaveRiskLevel,
  type ProviderApprovalDecision,
  type ScopedThreadRef,
  type UploadChatAttachment,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { T, Var, useGT } from "gt-react";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FileTextIcon,
  MicIcon,
  MicOffIcon,
  PaperclipIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { newMessageId } from "../lib/utils";
import { providerInstanceEntriesFor } from "../providerInstances";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { useThreadProjection, useThreadVisibleTurnItems } from "../state/entities";
import { useEnvironmentProviders } from "../state/environments";
import { environmentServerConfigsAtom, serverEnvironment } from "../state/server";
import {
  childThreadApprovalsAtom,
  environmentThreadDetails,
  threadEnvironment,
} from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { DropwaveMarkdown } from "./DropwaveMarkdown";
import { DropwaveSelect, type DropwaveSelectOption } from "./DropwaveSelect";
import { workState } from "./model";
import { useDropwaveWorkspace } from "./workspaceContext";

const EMPTY_PENDING_REQUESTS_ATOM = Atom.make(null);
const EMPTY_CHILD_APPROVALS_ATOM = Atom.make<ReadonlyArray<ChildThreadApproval>>([]);

interface PendingImageAttachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly dataUrl: string;
}

interface BrowserSpeechRecognitionEvent {
  readonly results: {
    readonly length: number;
    readonly [index: number]: {
      readonly isFinal: boolean;
      readonly [index: number]: { readonly transcript: string } | undefined;
    };
  };
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => BrowserSpeechRecognition;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  const win = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

function formatClock(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function LiveApprovalCard({
  approval,
  threadRef,
  sourceTitle,
}: {
  approval: ThreadPendingApproval;
  threadRef: ScopedThreadRef;
  sourceTitle?: string | undefined;
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
        <span data-dw-mono="muted">
          {sourceTitle ? `${sourceTitle} · ${approval.requestKind}` : approval.requestKind}
        </span>
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

function HelperChildApprovals({
  ownerRef,
  headerCode,
}: {
  ownerRef: ScopedThreadRef;
  headerCode: string;
}) {
  const childApprovals = useAtomValue(childThreadApprovalsAtom(ownerRef));
  if (childApprovals.length === 0) return null;
  return (
    <>
      {childApprovals.map((entry) => (
        <div key={`${entry.thread.threadId}:${entry.approval.requestId}`} data-dw-msg="bot">
          <span data-dw-msg-avatar="bot">{headerCode}</span>
          <div data-dw-msg-stack="">
            <LiveApprovalCard
              approval={entry.approval}
              threadRef={entry.thread}
              sourceTitle={entry.title}
            />
          </div>
        </div>
      ))}
    </>
  );
}

export function DropwaveChatPillar() {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Array<PendingImageAttachment>>([]);
  const [workersFoldOpen, setWorkersFoldOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const streamEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const speechRef = useRef<BrowserSpeechRecognition | null>(null);

  const activeThread = workspace?.activeThread ?? workspace?.lead ?? null;
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
  const directChildApprovals = useAtomValue(
    activeThreadRef ? childThreadApprovalsAtom(activeThreadRef) : EMPTY_CHILD_APPROVALS_ATOM,
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

  const messageCount = projection?.projection.messages.length ?? 0;

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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clean up browser speech recognizer on unmount
  useEffect(
    () => () => {
      speechRef.current?.stop();
      speechRef.current = null;
    },
    [],
  );

  if (!workspace) return null;

  const liveBot = workspace.activeBot ?? workspace.lead;
  const headerName = activeThread?.title ?? liveBot?.title ?? gt("Chief of Staff");
  const headerCode =
    headerName
      .split(/\s+/)
      .map((w) => w[0] ?? "")
      .join("")
      .slice(0, 2)
      .toUpperCase() || "CS";

  const currentRisk: DropwaveRiskLevel =
    workspace.lead?.source.dropwaveBot?.kind === "lead"
      ? (workspace.lead.source.dropwaveBot.riskLevel ?? "yolo")
      : "yolo";

  const headerBadge =
    liveBot?.source.dropwaveBot?.kind === "lead"
      ? currentRisk === "yolo"
        ? gt("Autonomous")
        : gt("Guided")
      : gt("Agent");
  const headerSub = `${workspace.project?.title ?? gt("Workspace")} · ${
    activeThread ? workState(activeThread) : gt("Ready")
  }`;

  const isLiveRunning = activeThread ? workState(activeThread) === "working" : false;

  const liveModelEntries: Array<{
    readonly key: string;
    readonly label: string;
    readonly hint: string;
    readonly instanceId: NonNullable<typeof activeThread>["source"]["modelSelection"]["instanceId"];
    readonly model: string;
  }> = [];
  if (activeThread) {
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
  const modelOptions: ReadonlyArray<DropwaveSelectOption> =
    liveModelEntries.length > 0
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
        : [{ value: "none", label: gt("Connect a provider") }];

  const handleModelChange = (nextKey: string) => {
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

  const handleAttachFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    for (const file of files.slice(0, 4)) {
      if (!file.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result);
        setAttachments((prev) => [
          ...prev.slice(0, 3),
          {
            id: `att-${Date.now()}-${file.name}`,
            name: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            dataUrl,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
  };

  const toggleVoice = () => {
    if (recording) {
      speechRef.current?.stop();
      speechRef.current = null;
      setRecording(false);
      return;
    }
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setSendError(gt("Voice dictation is not supported in this browser."));
      return;
    }
    setSendError(null);
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (ev) => {
      let chunk = "";
      for (let i = 0; i < ev.results.length; i += 1) {
        const entry = ev.results[i];
        if (entry?.isFinal && entry[0]?.transcript) {
          chunk += `${entry[0].transcript} `;
        }
      }
      const cleaned = chunk.trim();
      if (cleaned) {
        setDraft((prev) => (prev.trim() ? `${prev.trim()} ${cleaned}` : cleaned));
      }
    };
    recognition.onerror = () => {
      setRecording(false);
      speechRef.current = null;
    };
    recognition.onend = () => {
      setRecording(false);
      speechRef.current = null;
    };
    speechRef.current = recognition;
    setRecording(true);
    recognition.start();
  };

  const submitMessage = async () => {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || sending) return;
    setSendError(null);

    if (recording) {
      speechRef.current?.stop();
      speechRef.current = null;
      setRecording(false);
    }

    if (!activeThread || !activeThreadRef) {
      workspace.setMainView("setup");
      return;
    }

    const uploadAttachments: ReadonlyArray<UploadChatAttachment> = attachments.map((att) => ({
      type: "image",
      name: att.name,
      mimeType: att.mimeType,
      sizeBytes: att.sizeBytes,
      dataUrl: att.dataUrl,
    }));

    setSending(true);
    const res = await startTurn({
      environmentId: activeThreadRef.environmentId,
      input: {
        threadId: activeThreadRef.threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text,
          attachments: uploadAttachments,
        },
        runtimeMode: activeThread.source.runtimeMode,
        interactionMode: activeThread.source.interactionMode,
      },
    });
    setSending(false);
    if (res._tag === "Success") {
      setDraft("");
      setAttachments([]);
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
    const lead = workspace.lead;
    if (lead && lead.source.dropwaveBot?.kind === "lead") {
      const existing = lead.source.dropwaveBot.rules;
      if (!existing.includes(ruleText)) {
        void updateMetadataCmd({
          environmentId: lead.environmentId,
          input: {
            threadId: lead.id,
            dropwaveBot: {
              ...lead.source.dropwaveBot,
              rules: [...existing, ruleText].slice(-50),
            },
          },
        });
      }
    }
    workspace.refreshOpenAsksCount();
  };

  const liveMessages = projection?.projection.messages ?? [];
  const liveSubagents = projection?.projection.subagents ?? [];
  const liveApprovals = pendingRequests?.approvals ?? [];
  const liveUserInputs = pendingRequests?.userInputs ?? [];
  const streamingAssistant = visibleItems
    .filter((entry) => entry.item.type === "assistant_message" && entry.item.status === "running")
    .at(-1);

  const runningTool = visibleItems
    .filter(
      (entry) =>
        (entry.item.type === "command_execution" ||
          entry.item.type === "dynamic_tool" ||
          entry.item.type === "file_change" ||
          entry.item.type === "web_search") &&
        entry.item.status === "running",
    )
    .at(-1);
  const runningSubagent = liveSubagents.find(
    (s) => s.status === "running" || s.status === "pending" || s.status === "waiting",
  );
  const helperRefsForLead =
    workspace.lead && activeThread && workspace.lead.id === activeThread.id
      ? workspace.bots
          .filter(
            (bot) =>
              bot.environmentId === workspace.lead!.environmentId &&
              bot.source.dropwaveBot?.kind === "teammate" &&
              bot.source.dropwaveBot.leadThreadId === workspace.lead!.id,
          )
          .map((bot) => scopeThreadRef(bot.environmentId, bot.id))
      : [];

  return (
    <div data-dw-pillar-body="">
      <header data-dw-pillar-head="">
        <div data-dw-head-identity="">
          <button
            type="button"
            data-dw-avatar-ring=""
            aria-label={gt("Bot and core loop settings")}
            onClick={() => {
              if (liveBot) {
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
            <p>{headerSub}</p>
          </div>
        </div>

        <div data-dw-head-actions="">
          <button
            type="button"
            data-dw-header-pill=""
            onClick={() => workspace.openPanel({ kind: "asks" })}
          >
            <T>Asks</T>
            <strong>{workspace.openAsksCount}</strong>
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
        {!activeThread ? (
          <div data-dw-empty-chat="">
            <div data-dw-avatar-ring="lg">DW</div>
            <h3>
              <T>Set up your Chief of Staff</T>
            </h3>
            <p>
              <T>
                Launch your project’s main agent with its own soul, core loop, and specialist team
                through a quick conversation.
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
                          "Let us refine our core loop together. Ask me what shipped means and wire the steps with dropwave_team.",
                        ),
                      )
                    }
                  >
                    <T>Refine core loop</T>
                  </button>
                  <button
                    type="button"
                    data-dw-quick-chip=""
                    onClick={() =>
                      setDraft(
                        gt("Audit this project right now and propose the top 3 things to ship."),
                      )
                    }
                  >
                    <T>Audit & plan next work</T>
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
                      <div data-dw-bubble="bot">
                        <DropwaveMarkdown text={msg.text} />
                      </div>
                    </div>
                  </div>
                ),
              )
            )}

            {liveSubagents.length > 0 && activeThreadRef ? (
              <div data-dw-msg="bot">
                <span data-dw-msg-avatar="bot">{headerCode}</span>
                <div data-dw-msg-stack="">
                  <div data-dw-fold-wrap="">
                    <button
                      type="button"
                      data-dw-fold-pill=""
                      onClick={() => setWorkersFoldOpen((open) => !open)}
                    >
                      <span
                        data-dw-dot={runningSubagent ? "emerald" : "indigo"}
                        data-pulse={runningSubagent ? "" : undefined}
                      />
                      <strong>
                        <T>
                          <Var>{liveSubagents.length}</Var> delegated sessions
                        </T>
                      </strong>
                      <span data-dw-muted-sep="">
                        ·{" "}
                        <T>
                          <Var>
                            {
                              liveSubagents.filter(
                                (s) => s.status === "running" || s.status === "pending",
                              ).length
                            }
                          </Var>{" "}
                          running,{" "}
                          <Var>{liveSubagents.filter((s) => s.status === "completed").length}</Var>{" "}
                          done
                        </T>
                      </span>
                      {workersFoldOpen ? (
                        <ChevronUpIcon className="size-3" />
                      ) : (
                        <ChevronDownIcon className="size-3" />
                      )}
                    </button>
                    {workersFoldOpen ? (
                      <div data-dw-fold-body="">
                        {liveSubagents.slice(-8).map((sub) => (
                          <div key={sub.id} data-dw-fold-line="">
                            <div data-dw-fold-worker-head="">
                              <strong>{sub.title || sub.prompt.slice(0, 60)}</strong>
                              <span
                                data-dw-mono={
                                  sub.status === "failed"
                                    ? "coral"
                                    : sub.status === "running"
                                      ? "emerald"
                                      : "muted"
                                }
                              >
                                {sub.status}
                              </span>
                            </div>
                            {sub.result ? <p>{sub.result.slice(0, 200)}</p> : null}
                            {sub.childThreadId ? (
                              <button
                                type="button"
                                data-dw-inline-link=""
                                onClick={() =>
                                  workspace.openThread(
                                    scopeThreadRef(
                                      activeThreadRef.environmentId,
                                      sub.childThreadId!,
                                    ),
                                  )
                                }
                              >
                                <T>Inspect session</T>
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {streamingAssistant && streamingAssistant.item.type === "assistant_message" ? (
              <div data-dw-msg="bot">
                <span data-dw-msg-avatar="bot">{headerCode}</span>
                <div data-dw-msg-stack="">
                  <div data-dw-bubble="bot">
                    <DropwaveMarkdown text={streamingAssistant.item.text || gt("Thinking…")} />
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

            {directChildApprovals.map((entry) => (
              <div key={`${entry.thread.threadId}:${entry.approval.requestId}`} data-dw-msg="bot">
                <span data-dw-msg-avatar="bot">{headerCode}</span>
                <div data-dw-msg-stack="">
                  <LiveApprovalCard
                    approval={entry.approval}
                    threadRef={entry.thread}
                    sourceTitle={entry.title}
                  />
                </div>
              </div>
            ))}
            {helperRefsForLead.map((helperRef) => (
              <HelperChildApprovals
                key={`${helperRef.environmentId}:${helperRef.threadId}`}
                ownerRef={helperRef}
                headerCode={headerCode}
              />
            ))}
          </>
        )}
        <div ref={streamEndRef} />
      </div>

      <div data-dw-composer-wrap="">
        <div data-dw-ticker="">
          <div data-dw-ticker-left="">
            <span
              data-dw-dot={recording ? "coral" : "emerald"}
              data-pulse={isLiveRunning || recording ? "" : undefined}
            />
            {recording ? (
              <span>
                <T>Listening… speak naturally, click mic again when done</T>
              </span>
            ) : runningSubagent ? (
              <>
                <strong>{runningSubagent.title || gt("Worker session")}</strong>
                <span>
                  <T>is running in an isolated worktree…</T>
                </span>
              </>
            ) : runningTool ? (
              <>
                <strong>{headerName}</strong>
                <span>
                  <T>
                    is running{" "}
                    <Var>
                      {runningTool.item.type === "dynamic_tool"
                        ? (runningTool.item.toolName ?? gt("tool"))
                        : runningTool.item.type === "command_execution"
                          ? gt("shell command")
                          : runningTool.item.type === "file_change"
                            ? gt("file edit")
                            : gt("web search")}
                    </Var>
                    …
                  </T>
                </span>
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
        </div>

        {sendError ? (
          <p data-dropwave-form-error="" role="alert">
            {sendError}
          </p>
        ) : null}

        <form data-dw-composer-box="" onSubmit={handleSend}>
          {attachments.length > 0 ? (
            <div data-dw-attach-strip="">
              {attachments.map((att) => (
                <div key={att.id} data-dw-attach-chip="">
                  <img src={att.dataUrl} alt={att.name} />
                  <span>{att.name}</span>
                  <button
                    type="button"
                    aria-label={gt("Remove attachment")}
                    onClick={() =>
                      setAttachments((prev) => prev.filter((item) => item.id !== att.id))
                    }
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

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
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={handleAttachFiles}
              />
              <button
                type="button"
                data-dw-composer-icon=""
                aria-label={gt("Attach image")}
                onClick={() => fileInputRef.current?.click()}
              >
                <PaperclipIcon className="size-4" />
              </button>
              <DropwaveSelect
                value={activeLiveModelKey || "none"}
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
                data-recording={recording ? "true" : undefined}
                aria-label={recording ? gt("Stop voice input") : gt("Voice input")}
                aria-pressed={recording}
                onClick={toggleVoice}
              >
                {recording ? <MicOffIcon className="size-4" /> : <MicIcon className="size-4" />}
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
                  disabled={(!draft.trim() && attachments.length === 0) || sending}
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
