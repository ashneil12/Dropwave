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
import type {
  ProviderApprovalDecision,
  ScopedThreadRef,
  UploadChatAttachment,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { T, Var, useGT } from "gt-react";
import {
  ArrowUpIcon,
  BotIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  FileTextIcon,
  ImagePlusIcon,
  ListTodoIcon,
  MicIcon,
  MicOffIcon,
  PlusIcon,
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

import { Popover, PopoverPopup, PopoverTrigger } from "../components/ui/popover";
import { newMessageId } from "../lib/utils";
import { useThreadProjection, useThreadVisibleTurnItems } from "../state/entities";
import { serverEnvironment } from "../state/server";
import {
  childThreadApprovalsAtom,
  environmentThreadDetails,
  threadEnvironment,
} from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { DropwaveBotAvatar } from "./DropwaveBotAvatar";
import { DropwaveComposerControls } from "./DropwaveComposerControls";
import { DropwaveMarkdown } from "./DropwaveMarkdown";
import { buildDropwaveChatTimeline } from "./DropwaveChatTimeline.logic";
import { DropwaveWorkingBlock, workSegmentHasSteps } from "./DropwaveWorkingBlock";
import { workState } from "./model";
import { useDropwaveWorkspace } from "./workspaceContext";

const EMPTY_PENDING_REQUESTS_ATOM = Atom.make(null);
const EMPTY_CHILD_APPROVALS_ATOM = Atom.make<ReadonlyArray<ChildThreadApproval>>([]);

// Fold pills for supervisor notes show a human label; the full text stays in the expanded body.
function supervisorCheckLabel(text: string, gt: (message: string) => string): string {
  const body = text.replace(/^\[Dropwave supervisor\]\s*/i, "");
  if (/asks? with no status/i.test(body)) return gt("Checked that every ask is tracked");
  if (/failed again|reached the fix-round cap/i.test(body)) return gt("Flagged a stuck worker");
  if (/worker .* failed/i.test(body)) return gt("Flagged a failed worker");
  if (/finished its assigned run/i.test(body)) return gt("Noted a teammate finishing up");
  if (/landed into the main checkout/i.test(body)) return gt("Noted work landing in the project");
  if (/changed .+ directly/i.test(body)) return gt("Noted a direct edit");
  return gt("Supervisor check");
}

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

type InlineDecisionEntry =
  | {
      readonly key: string;
      readonly kind: "approval";
      readonly threadRef: ScopedThreadRef;
      readonly sourceTitle?: string | undefined;
      readonly approval: ThreadPendingApproval;
    }
  | {
      readonly key: string;
      readonly kind: "input";
      readonly threadRef: ScopedThreadRef;
      readonly input: ThreadPendingUserInput;
    };

/**
 * AffectUI-inspired calm Decision Inbox:
 * One elevated dark-glass card with a 0.5px hairline shadow.
 * First item expanded, remaining items folded quietly to 1 line below.
 */
function AffectDecisionInbox({
  entries,
  projectName,
  onSaveRule,
}: {
  entries: ReadonlyArray<InlineDecisionEntry>;
  projectName: string;
  onSaveRule: (ruleText: string, quote: string) => void;
}) {
  const gt = useGT();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [selectedByKey, setSelectedByKey] = useState<Record<string, string>>({});
  const [customByKey, setCustomByKey] = useState<Record<string, string>>({});

  const respondApproval = useOrchestrationCommand(threadEnvironment.respondToApproval, {
    reportFailure: false,
  });
  const respondInput = useOrchestrationCommand(threadEnvironment.respondToUserInput, {
    reportFailure: false,
  });

  if (entries.length === 0) return null;

  const activeKey =
    expandedKey && entries.some((e) => e.key === expandedKey) ? expandedKey : entries[0]!.key;

  const decideApproval = async (
    entry: Extract<InlineDecisionEntry, { kind: "approval" }>,
    decision: ProviderApprovalDecision,
  ) => {
    if (busyKey) return;
    setBusyKey(entry.key);
    await respondApproval({
      environmentId: entry.threadRef.environmentId,
      input: {
        threadId: entry.threadRef.threadId,
        requestId: entry.approval.requestId,
        decision,
      },
    });
    setBusyKey(null);
  };

  const submitUserInput = async (
    entry: Extract<InlineDecisionEntry, { kind: "input" }>,
    chosen: string,
    alwaysDoThis: boolean,
  ) => {
    if (busyKey || !chosen) return;
    const firstQ = entry.input.questions[0];
    if (!firstQ) return;
    setBusyKey(entry.key);
    const answers: Record<string, string> = {};
    for (const q of entry.input.questions) {
      answers[q.id] = q.id === firstQ.id ? chosen : (q.options[0]?.label ?? chosen);
    }
    const res = await respondInput({
      environmentId: entry.threadRef.environmentId,
      input: {
        threadId: entry.threadRef.threadId,
        requestId: entry.input.requestId,
        answers,
      },
    });
    if (res._tag === "Success" && alwaysDoThis) {
      onSaveRule(`When asked "${firstQ.question}": ${chosen}`, firstQ.question);
    }
    setBusyKey(null);
  };

  return (
    <div data-dw-affect-inbox="">
      <div data-dw-affect-head="">
        <span data-dw-affect-head-left="">
          <span data-dw-dot="coral" data-pulse="" />
          <span>
            {entries.length === 1 ? (
              <T>1 needs your input</T>
            ) : (
              <T>
                <Var>{entries.length}</Var> need your input
              </T>
            )}
          </span>
        </span>
        <span data-dw-mono="muted">{projectName}</span>
      </div>

      {entries.map((entry) => {
        const isOpen = entry.key === activeKey;
        const busy = busyKey === entry.key;

        if (entry.kind === "approval") {
          const title =
            entry.approval.detail ||
            gt("{source} wants approval to run an action.", {
              source: entry.sourceTitle || gt("Your agent"),
            });
          if (!isOpen) {
            return (
              <button
                key={entry.key}
                type="button"
                data-dw-affect-row="folded"
                onClick={() => setExpandedKey(entry.key)}
              >
                {title}
              </button>
            );
          }
          return (
            <div key={entry.key} data-dw-affect-row="open">
              <p data-dw-affect-title="">{title}</p>
              <p data-dw-affect-detail="">
                {entry.sourceTitle ? `${entry.sourceTitle} · ` : ""}
                {entry.approval.requestKind}
              </p>
              <div data-dw-affect-actions="">
                <button
                  type="button"
                  data-dw-btn-solid=""
                  disabled={busy}
                  onClick={() => void decideApproval(entry, "accept")}
                >
                  <T>Approve</T>
                </button>
                <button
                  type="button"
                  data-dw-btn-ghost=""
                  disabled={busy}
                  onClick={() => void decideApproval(entry, "decline")}
                >
                  <T>Decline</T>
                </button>
              </div>
            </div>
          );
        }

        const q = entry.input.questions[0];
        if (!q) return null;
        if (!isOpen) {
          return (
            <button
              key={entry.key}
              type="button"
              data-dw-affect-row="folded"
              onClick={() => setExpandedKey(entry.key)}
            >
              {q.question}
            </button>
          );
        }

        const primaryOpt = q.options[0];
        const secondaryOpt = q.options[1];
        const extraOpts = q.options.slice(2);
        const customText = customByKey[entry.key] ?? "";
        const selectedLabel = selectedByKey[entry.key] ?? primaryOpt?.label ?? "";
        const effectiveChoice = customText.trim() || selectedLabel;

        return (
          <div key={entry.key} data-dw-affect-row="open">
            <p data-dw-affect-title="">{q.question}</p>
            {q.header ? <p data-dw-affect-detail="">{q.header}</p> : null}

            {q.options.length <= 2 && !customText.trim() ? (
              <div data-dw-affect-actions="">
                {primaryOpt ? (
                  <button
                    type="button"
                    data-dw-btn-solid=""
                    disabled={busy}
                    onClick={() => void submitUserInput(entry, primaryOpt.label, false)}
                  >
                    {primaryOpt.label}
                  </button>
                ) : null}
                {secondaryOpt ? (
                  <button
                    type="button"
                    data-dw-btn-ghost=""
                    disabled={busy}
                    onClick={() => void submitUserInput(entry, secondaryOpt.label, false)}
                  >
                    {secondaryOpt.label}
                  </button>
                ) : null}
                {primaryOpt ? (
                  <button
                    type="button"
                    data-dw-btn-rule=""
                    disabled={busy}
                    onClick={() => void submitUserInput(entry, primaryOpt.label, true)}
                  >
                    <T>Always do this</T>
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                {q.options.length > 0 ? (
                  <div data-dw-affect-choices="">
                    {[primaryOpt, secondaryOpt, ...extraOpts].filter(Boolean).map((opt) => (
                      <button
                        key={opt!.label}
                        type="button"
                        data-dw-affect-choice=""
                        aria-pressed={!customText.trim() && selectedLabel === opt!.label}
                        onClick={() => {
                          setSelectedByKey((prev) => ({ ...prev, [entry.key]: opt!.label }));
                          setCustomByKey((prev) => ({ ...prev, [entry.key]: "" }));
                        }}
                      >
                        {opt!.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div data-dw-affect-actions="">
                  <button
                    type="button"
                    data-dw-btn-solid=""
                    disabled={busy || !effectiveChoice}
                    onClick={() => void submitUserInput(entry, effectiveChoice, false)}
                  >
                    <T>Confirm</T>
                  </button>
                  <button
                    type="button"
                    data-dw-btn-rule=""
                    disabled={busy || !effectiveChoice}
                    onClick={() => void submitUserInput(entry, effectiveChoice, true)}
                  >
                    <T>Always do this</T>
                  </button>
                </div>
              </>
            )}

            <input
              data-dw-affect-input=""
              value={customText}
              onChange={(e) => {
                const val = e.currentTarget.value;
                setCustomByKey((prev) => ({ ...prev, [entry.key]: val }));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customText.trim()) {
                  e.preventDefault();
                  void submitUserInput(entry, customText.trim(), false);
                }
              }}
              placeholder={gt("Or type your own answer and press Enter…")}
            />
          </div>
        );
      })}
    </div>
  );
}

function HelperChildApprovals({
  ownerRef,
  projectName,
  onSaveRule,
}: {
  ownerRef: ScopedThreadRef;
  projectName: string;
  onSaveRule: (ruleText: string, quote: string) => void;
}) {
  const childApprovals = useAtomValue(childThreadApprovalsAtom(ownerRef));
  if (childApprovals.length === 0) return null;
  const entries: ReadonlyArray<InlineDecisionEntry> = childApprovals.map((entry) => ({
    key: `${entry.thread.threadId}:${entry.approval.requestId}`,
    kind: "approval",
    threadRef: entry.thread,
    sourceTitle: entry.title,
    approval: entry.approval,
  }));
  return (
    <AffectDecisionInbox entries={entries} projectName={projectName} onSaveRule={onSaveRule} />
  );
}

export function DropwaveChatPillar({
  composerPrefill,
  onOpenDocPath,
  onOpenThreadId,
}: {
  composerPrefill?: { threadId: string; text: string; nonce: number } | null;
  onOpenDocPath?: (docPath: string) => void;
  onOpenThreadId?: (threadId: string) => void;
} = {}) {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Array<PendingImageAttachment>>([]);
  const [workersFoldOpen, setWorkersFoldOpen] = useState(false);
  const [openAgentMsgs, setOpenAgentMsgs] = useState<Record<string, boolean>>({});
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
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

  const appliedPrefillRef = useRef<number | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- applies a one-shot composer prefill requested from another surface
  useEffect(() => {
    if (!composerPrefill || composerPrefill.threadId !== activeThread?.id) return;
    if (appliedPrefillRef.current === composerPrefill.nonce) return;
    appliedPrefillRef.current = composerPrefill.nonce;
    setDraft(composerPrefill.text);
    textareaRef.current?.focus();
  }, [composerPrefill, activeThread?.id]);

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

  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });
  const interruptTurn = useOrchestrationCommand(threadEnvironment.interruptTurn, {
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
  const isLiveRunning = activeThread ? workState(activeThread) === "working" : false;

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

  // Combine direct approvals, user inputs, and child worker approvals into ONE calm AffectUI Decision Inbox!
  const combinedDecisions: Array<InlineDecisionEntry> = [];
  if (activeThreadRef) {
    for (const userInput of liveUserInputs) {
      combinedDecisions.push({
        key: `input:${userInput.requestId}`,
        kind: "input",
        threadRef: activeThreadRef,
        input: userInput,
      });
    }
    for (const approval of liveApprovals) {
      combinedDecisions.push({
        key: `approval:${approval.requestId}`,
        kind: "approval",
        threadRef: activeThreadRef,
        approval,
      });
    }
  }
  for (const child of directChildApprovals) {
    combinedDecisions.push({
      key: `child:${child.thread.threadId}:${child.approval.requestId}`,
      kind: "approval",
      threadRef: child.thread,
      sourceTitle: child.title,
      approval: child.approval,
    });
  }

  const projectName = workspace.project?.title ?? gt("Workspace");

  const renderChatMessage = (msg: (typeof liveMessages)[number]) => {
    if (msg.role === "user" && msg.createdBy !== "user") {
      const isOpen = Boolean(openAgentMsgs[msg.id]);
      const senderBot = msg.senderThreadId
        ? workspace.bots.find((b) => b.id === msg.senderThreadId)
        : null;
      const isSupervisor = msg.text.startsWith("[Dropwave supervisor]");
      const senderLabel = senderBot
        ? gt("From {name}", { name: senderBot.title })
        : isSupervisor
          ? gt("Supervisor check")
          : gt("Agent update");
      const preview = isSupervisor
        ? supervisorCheckLabel(msg.text, gt)
        : msg.text
            .replace(/^\[From [^\]]+\]\s*/i, "")
            .split("\n")[0]
            ?.slice(0, 72);
      return (
        <div key={msg.id} data-dw-turn="bot">
          <div data-dw-work-fold="">
            <button
              type="button"
              data-dw-work-trigger=""
              aria-expanded={isOpen}
              onClick={() => setOpenAgentMsgs((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))}
            >
              <span data-dw-dot="indigo" />
              <span>{senderLabel}</span>
              {preview ? (
                <span data-dw-mono={isSupervisor ? undefined : "dim"}>· {preview}</span>
              ) : null}
              {isOpen ? (
                <ChevronUpIcon className="size-3 opacity-60" />
              ) : (
                <ChevronDownIcon className="size-3 opacity-60" />
              )}
            </button>
            <div data-dw-work-body={isOpen ? "open" : "closed"}>
              <div data-dw-work-body-inner="">
                <div data-dw-work-step="">
                  <DropwaveMarkdown
                    text={msg.text}
                    onOpenDocPath={onOpenDocPath}
                    onOpenThreadId={onOpenThreadId}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return msg.role === "user" ? (
      <div key={msg.id} data-dw-turn="owner">
        <div data-dw-owner-pill="">
          <p>{msg.text}</p>
        </div>
      </div>
    ) : (
      <div key={msg.id} data-dw-turn="bot">
        <DropwaveMarkdown
          text={msg.text}
          onOpenDocPath={onOpenDocPath}
          onOpenThreadId={onOpenThreadId}
        />
      </div>
    );
  };

  // One ordered timeline from the same projected turn items T3's chat uses:
  // each run of work renders as its own block where it happened. When the
  // projection does not account for every message, fall back to the plain
  // message list plus a single trailing block so nothing is lost.
  const timelineSegments = buildDropwaveChatTimeline(visibleItems);
  const lastWorkSegmentIndex = timelineSegments.findLastIndex((s) => s.kind === "work");
  const messageById = new Map<string, (typeof liveMessages)[number]>(
    liveMessages.map((msg) => [msg.id, msg]),
  );
  const coveredMessageIds = new Set(
    timelineSegments.flatMap((segment) => (segment.kind === "message" ? [segment.messageId] : [])),
  );
  const timelineCoversMessages =
    liveMessages.length > 0 && liveMessages.every((msg) => coveredMessageIds.has(msg.id));

  return (
    <div data-dw-chat-stage="">
      <div data-dw-chat-scroll="">
        <div data-dw-chat-lane="">
          {!activeThread ? (
            <div data-dw-empty-chat="">
              <DropwaveBotAvatar name={projectName} role="lead" size="lg" />
              <h3>
                <T>Set up your Chief of Staff</T>
              </h3>
              <p>
                <T>
                  Launch your project’s main bot with its own soul, core loop, and specialist team
                  through a quick conversation.
                </T>
              </p>
              <button
                type="button"
                data-dw-btn-solid=""
                onClick={() => workspace.setMainView("setup")}
              >
                <T>Start conversational setup</T>
              </button>
            </div>
          ) : (
            <>
              {liveMessages.length === 0 &&
              workspace.activeBot?.source.dropwaveBot?.kind === "lead" &&
              workspace.activeBot.source.dropwaveBot.onboardingPhase === "first_run" ? (
                <div data-dw-turn="bot">
                  <DropwaveMarkdown
                    text={gt(
                      "Hey. I just came online. I'll be running point on your projects with you. Before anything else, what should I call you?",
                    )}
                    onOpenDocPath={onOpenDocPath}
                    onOpenThreadId={onOpenThreadId}
                  />
                </div>
              ) : liveMessages.length === 0 ? (
                <div data-dw-empty-chat="">
                  <DropwaveBotAvatar
                    name={headerName}
                    seed={liveBot?.source.dropwaveBot?.avatarSeed}
                    role={liveBot?.source.dropwaveBot?.kind === "lead" ? "lead" : "specialist"}
                    size="lg"
                  />
                  <h3>{headerName}</h3>
                  <p>
                    {liveBot?.source.dropwaveBot?.brief || (
                      <T>
                        Dump ideas, decisions, or tasks. Everything is tracked through your core
                        loop.
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
              ) : timelineCoversMessages ? (
                timelineSegments.map((segment, segmentIndex) => {
                  if (segment.kind === "message") {
                    const msg = messageById.get(segment.messageId);
                    return msg ? renderChatMessage(msg) : null;
                  }
                  const workKey = segment.entries[0]?.item.id ?? `work-${segmentIndex}`;
                  const segmentIsLive = isLiveRunning && segmentIndex === lastWorkSegmentIndex;
                  if (!segmentIsLive && !workSegmentHasSteps(segment.entries)) return null;
                  return (
                    <div key={`work-${workKey}`} data-dw-turn="bot">
                      <DropwaveWorkingBlock
                        visibleItems={segment.entries}
                        isRunning={segmentIsLive}
                      />
                    </div>
                  );
                })
              ) : (
                liveMessages.map((msg) => renderChatMessage(msg))
              )}

              {/* Devin-Next style live working stream + faded auto-collapsing Thoughts + Thinking Orb */}
              {!timelineCoversMessages ? (
                <div data-dw-turn="bot">
                  <DropwaveWorkingBlock visibleItems={visibleItems} isRunning={isLiveRunning} />
                </div>
              ) : null}

              {/* AffectUI-style 1-line folding background runs pill */}
              {liveSubagents.length > 0 && activeThreadRef ? (
                <div data-dw-turn="bot">
                  <div data-dw-work-fold="">
                    <button
                      type="button"
                      data-dw-work-trigger=""
                      aria-expanded={workersFoldOpen}
                      onClick={() => setWorkersFoldOpen((open) => !open)}
                    >
                      <span
                        data-dw-dot={runningSubagent ? "emerald" : "emerald"}
                        data-pulse={runningSubagent ? "" : undefined}
                      />
                      <span>
                        {liveSubagents.length === 1 ? (
                          <T>1 background run</T>
                        ) : (
                          <T>
                            <Var>{liveSubagents.length}</Var> background runs
                          </T>
                        )}
                      </span>
                      <span data-dw-mono="dim">
                        ·{" "}
                        <T>
                          <Var>{liveSubagents.filter((s) => s.status === "completed").length}</Var>/
                          <Var>{liveSubagents.length}</Var> done
                        </T>
                      </span>
                      {workersFoldOpen ? (
                        <ChevronUpIcon className="size-3 opacity-60" />
                      ) : (
                        <ChevronDownIcon className="size-3 opacity-60" />
                      )}
                    </button>

                    <div data-dw-work-body={workersFoldOpen ? "open" : "closed"}>
                      <div data-dw-work-body-inner="">
                        {liveSubagents.slice(-8).map((sub) => (
                          <div key={sub.id} data-dw-work-step="">
                            <div data-dw-work-step-head="">
                              <strong>{sub.title || sub.prompt.slice(0, 60)}</strong>
                              <span
                                data-dw-mono={
                                  sub.status === "failed"
                                    ? "coral"
                                    : sub.status === "running"
                                      ? "emerald"
                                      : "dim"
                                }
                              >
                                {sub.status}
                              </span>
                            </div>
                            {sub.result ? <p>{sub.result.slice(0, 220)}</p> : null}
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
                                <T>Inspect run</T>
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              {streamingAssistant && streamingAssistant.item.type === "assistant_message" ? (
                <div data-dw-turn="bot">
                  <DropwaveMarkdown
                    text={streamingAssistant.item.text || gt("Thinking…")}
                    onOpenDocPath={onOpenDocPath}
                    onOpenThreadId={onOpenThreadId}
                  />
                </div>
              ) : null}

              {/* Calm AffectUI inline Decision Inbox */}
              {combinedDecisions.length > 0 ? (
                <div data-dw-turn="bot">
                  <AffectDecisionInbox
                    entries={combinedDecisions}
                    projectName={projectName}
                    onSaveRule={handleSaveRule}
                  />
                </div>
              ) : null}

              {helperRefsForLead.map((helperRef) => (
                <div key={`${helperRef.environmentId}:${helperRef.threadId}`} data-dw-turn="bot">
                  <HelperChildApprovals
                    ownerRef={helperRef}
                    projectName={projectName}
                    onSaveRule={handleSaveRule}
                  />
                </div>
              ))}
            </>
          )}
          <div ref={streamEndRef} />
        </div>
      </div>

      {/* Luminous Frosted-Glass Composer with full T3 Provider/Model/Effort + Permissions */}
      <div data-dw-composer-dock="">
        <div data-dw-composer-lane="">
          {recording || runningSubagent || runningTool || isLiveRunning ? (
            <div data-dw-live-status="">
              <span data-dw-dot={recording ? "coral" : "emerald"} data-pulse="" />
              {recording ? (
                <span>
                  <T>Listening… speak naturally, click mic again when done</T>
                </span>
              ) : runningSubagent ? (
                <span>
                  <strong>{runningSubagent.title || gt("Worker")}</strong>{" "}
                  <T>is running in an isolated worktree…</T>
                </span>
              ) : runningTool ? (
                <span>
                  <strong>{headerName}</strong>{" "}
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
              ) : (
                <span>
                  <strong>{headerName}</strong> <T>is working…</T>
                </span>
              )}
            </div>
          ) : null}

          {sendError ? (
            <p data-dropwave-form-error="" role="alert">
              {sendError}
            </p>
          ) : null}

          <form data-dw-glass-composer="" onSubmit={handleSend}>
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
                <Popover open={plusMenuOpen} onOpenChange={setPlusMenuOpen}>
                  <PopoverTrigger
                    type="button"
                    data-dw-plus-btn=""
                    data-open={plusMenuOpen ? "true" : undefined}
                    aria-label={gt("Add to message")}
                  >
                    <PlusIcon className="size-4" />
                  </PopoverTrigger>
                  <PopoverPopup align="start" width="sm" padding="compact" data-dropwave-popover="">
                    <div data-dw-plus-menu="">
                      <button
                        type="button"
                        data-dw-plus-item=""
                        onClick={() => {
                          setPlusMenuOpen(false);
                          fileInputRef.current?.click();
                        }}
                      >
                        <ImagePlusIcon className="size-3.5" />
                        <span>
                          <T>Attach image</T>
                        </span>
                      </button>
                      <button
                        type="button"
                        data-dw-plus-item=""
                        onClick={() => {
                          setPlusMenuOpen(false);
                          workspace.setMainView("asks");
                        }}
                      >
                        <ListTodoIcon className="size-3.5" />
                        <span>
                          <T>Open tracked asks</T>
                        </span>
                      </button>
                      <button
                        type="button"
                        data-dw-plus-item=""
                        onClick={() => {
                          setPlusMenuOpen(false);
                          workspace.setMainView("docs");
                        }}
                      >
                        <FileTextIcon className="size-3.5" />
                        <span>
                          <T>Browse project docs</T>
                        </span>
                      </button>
                      {workspace.lead && workspace.project ? (
                        <button
                          type="button"
                          data-dw-plus-item=""
                          onClick={() => {
                            setPlusMenuOpen(false);
                            workspace.openPanel({
                              kind: "profile",
                              target: {
                                kind: "new-teammate",
                                project: workspace.project!,
                                lead: workspace.lead!,
                              },
                            });
                          }}
                        >
                          <BotIcon className="size-3.5" />
                          <span>
                            <T>Add specialist bot</T>
                          </span>
                        </button>
                      ) : null}
                    </div>
                  </PopoverPopup>
                </Popover>

                {activeThread ? (
                  <DropwaveComposerControls
                    thread={activeThread}
                    project={workspace.project}
                    prompt={draft}
                    onPromptEdit={(edit) => setDraft((prev) => edit(prev))}
                    disabled={sending}
                  />
                ) : null}
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
    </div>
  );
}
