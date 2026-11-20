import { T, Var, useGT } from "gt-react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookmarkCheckIcon,
  CheckCircle2Icon,
  FileTextIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

import { Dialog, DialogPopup } from "../components/ui/dialog";
import type { SamplePendingReview } from "./sampleData";

export interface DecisionQueueItem {
  readonly id: string;
  readonly projectName: string;
  readonly sessionTag: string;
  readonly title: string;
  readonly summary: string;
  readonly context: string;
  readonly question: string;
  readonly ifDoNothing: string;
  readonly evidence?: string;
  readonly options: SamplePendingReview["options"];
}

export function DropwaveDecisionModal({
  open,
  items,
  initialIndex = 0,
  onClose,
  onResolve,
  onIgnore,
  onJumpToChat,
}: {
  open: boolean;
  items: ReadonlyArray<DecisionQueueItem>;
  initialIndex?: number;
  onClose: () => void;
  onResolve: (item: DecisionQueueItem, choiceLabel: string, alwaysDoThis: boolean) => void;
  onIgnore: (item: DecisionQueueItem) => void;
  onJumpToChat: (item: DecisionQueueItem) => void;
}) {
  const gt = useGT();
  const [cursor, setCursor] = useState(initialIndex);
  const [selectedById, setSelectedById] = useState<Record<string, string>>({});
  const [customById, setCustomById] = useState<Record<string, string>>({});

  if (!open) return null;

  const safeIndex = items.length > 0 ? Math.min(cursor, items.length - 1) : 0;
  const item = items[safeIndex] ?? null;

  const defaultOpt = item
    ? (item.options.find((o) => o.recommended) ?? item.options[0])
    : undefined;
  const selectedId = item ? (selectedById[item.id] ?? defaultOpt?.id ?? "") : "";
  const customText = item ? (customById[item.id] ?? "") : "";
  const chosenLabel = item
    ? customText.trim() ||
      item.options.find((o) => o.id === selectedId)?.label ||
      defaultOpt?.label ||
      ""
    : "";

  const handleDecision = (alwaysDoThis: boolean) => {
    if (!item || !chosenLabel) return;
    onResolve(item, chosenLabel, alwaysDoThis);
    if (safeIndex >= items.length - 1 && safeIndex > 0) {
      setCursor(safeIndex - 1);
    }
  };

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
            {items.length > 0 ? (
              <span data-dw-mono="muted">
                <T>
                  <Var>{safeIndex + 1}</Var> of <Var>{items.length}</Var>
                </T>
              </span>
            ) : null}
          </div>

          <div data-dw-decision-head-right="">
            {items.length > 1 ? (
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
                  disabled={safeIndex >= items.length - 1}
                  onClick={() => setCursor((c) => Math.min(items.length - 1, c + 1))}
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

        {item ? (
          <div data-dw-decision-body="">
            <div data-dw-decision-meta="">
              <span data-dw-badge="violet">{item.projectName}</span>
              <span data-dw-mono="muted">{item.sessionTag}</span>
              <button
                type="button"
                data-dw-inline-link=""
                onClick={() => {
                  onClose();
                  onJumpToChat(item);
                }}
              >
                <T>View in chat</T>
              </button>
            </div>

            <h2 data-dw-decision-title="">{item.title}</h2>

            <div data-dw-decision-context-box="">
              <span data-dw-section-micro="">
                <T>What happened</T>
              </span>
              <p>{item.context}</p>
              {item.evidence ? (
                <div data-dw-decision-evidence="">
                  <FileTextIcon className="size-3.5 shrink-0" data-dw-icon="indigo" />
                  <span>{item.evidence}</span>
                </div>
              ) : null}
              <em>{item.ifDoNothing}</em>
            </div>

            <div data-dw-decision-question="">
              <span data-dw-section-micro="">
                <T>Decision needed</T>
              </span>
              <strong>{item.question}</strong>
            </div>

            <div data-dw-needs-options="">
              {item.options.map((opt) => {
                const isSelected = !customText.trim() && selectedId === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    data-dw-option-row=""
                    aria-pressed={isSelected}
                    onClick={() => {
                      setSelectedById((prev) => ({ ...prev, [item.id]: opt.id }));
                      setCustomById((prev) => ({ ...prev, [item.id]: "" }));
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
              onChange={(e) => {
                const val = e.currentTarget.value;
                setCustomById((prev) => ({ ...prev, [item.id]: val }));
              }}
              placeholder={gt("Or explain your own call in plain English…")}
            />

            <footer data-dw-decision-foot="">
              <button type="button" data-dw-ghost-xs="" onClick={() => onIgnore(item)}>
                <T>Skip / Ignore</T>
              </button>
              <div data-dw-needs-actions="">
                <button
                  type="button"
                  data-dw-ghost-sm=""
                  disabled={!chosenLabel}
                  onClick={() => handleDecision(false)}
                >
                  <T>Just this once</T>
                </button>
                <button
                  type="button"
                  data-dw-white-pill=""
                  disabled={!chosenLabel}
                  onClick={() => handleDecision(true)}
                >
                  <BookmarkCheckIcon className="size-3.5" />
                  <T>Always do this</T>
                </button>
              </div>
            </footer>
          </div>
        ) : (
          <div data-dw-decision-clear="">
            <CheckCircle2Icon className="size-9" data-dw-icon="emerald" />
            <h3>
              <T>All decisions resolved</T>
            </h3>
            <p>
              <T>Your bots have everything they need to keep shipping.</T>
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
