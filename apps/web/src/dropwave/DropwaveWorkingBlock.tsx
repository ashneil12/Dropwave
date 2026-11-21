import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { T, Var, useGT } from "gt-react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface VisibleTurnEntry {
  readonly item: OrchestrationV2TurnItem;
}

function summarizeStep(
  item: OrchestrationV2TurnItem,
  gt: ReturnType<typeof useGT>,
): {
  readonly label: string;
  readonly detail?: string | undefined;
  readonly isThought?: boolean;
} | null {
  switch (item.type) {
    case "reasoning": {
      const cleaned = item.text.trim();
      if (!cleaned) return null;
      return { label: gt("Thoughts"), detail: cleaned, isThought: true };
    }
    case "command_execution": {
      const cmd = item.input.trim().split("\n")[0]?.slice(0, 72) || gt("command");
      return {
        label: gt("Running {cmd}", { cmd }),
        detail: item.output?.trim() || undefined,
      };
    }
    case "file_change":
      return {
        label: gt("Edited {file}", { file: item.fileName }),
        detail: item.diffStr?.trim() || undefined,
      };
    case "file_search":
      return {
        label: item.pattern
          ? gt("Searched files: {pattern}", { pattern: item.pattern })
          : gt("Searched files"),
      };
    case "web_search":
      return {
        label: item.patterns?.[0]
          ? gt("Web search: {query}", { query: item.patterns[0] })
          : gt("Web search"),
      };
    case "dynamic_tool":
      return {
        label: gt("Used {tool}", { tool: item.toolName ?? gt("tool") }),
        detail:
          item.output !== undefined
            ? typeof item.output === "string"
              ? item.output.slice(0, 500)
              : JSON.stringify(item.output, null, 2).slice(0, 500)
            : undefined,
      };
    default:
      return null;
  }
}

/**
 * Devin-Next inspired live activity drawer + Thinking Orb:
 * - Shows a soft vertical-faded live peek of Thoughts while streaming, auto-collapsing once done
 * - Displays clickable 1-line tool/command/edit rows inside a calm collapsible section
 * - Anchors live work with an animated layered Thinking Orb ("Exploring" / "Pondering" / "Working")
 */
export function DropwaveWorkingBlock({
  visibleItems,
  isRunning,
}: {
  visibleItems: ReadonlyArray<VisibleTurnEntry>;
  isRunning: boolean;
}) {
  const gt = useGT();
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [showEarlierSteps, setShowEarlierSteps] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const stepsRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- live elapsed seconds counter while agent is actively working
  useEffect(() => {
    if (!isRunning) return;
    stickToBottomRef.current = true;
    const started = Date.now();
    const id = window.setInterval(() => {
      setElapsedSec(Math.max(1, Math.floor((Date.now() - started) / 1000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [isRunning]);

  const allSteps: Array<{
    readonly id: string;
    readonly label: string;
    readonly detail?: string | undefined;
    readonly isThought?: boolean;
    readonly streaming: boolean;
  }> = [];

  for (const entry of visibleItems) {
    const info = summarizeStep(entry.item, gt);
    if (!info) continue;
    allSteps.push({
      id: entry.item.id,
      label: info.label,
      detail: info.detail,
      ...(info.isThought ? { isThought: true } : {}),
      streaming:
        entry.item.status === "running" ||
        (entry.item.type === "reasoning" && entry.item.streaming),
    });
  }

  // Long runs render the newest steps; the rest stay one click away.
  const hiddenSteps = !showEarlierSteps && allSteps.length > 50 ? allSteps.length - 50 : 0;
  const steps = hiddenSteps > 0 ? allSteps.slice(-50) : allSteps;

  const lastStepId = steps.length > 0 ? steps[steps.length - 1]!.id : null;

  // Keep the latest step in view while running unless the owner scrolled up inside the steps list.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the steps list scroll position pinned to the newest step
  useEffect(() => {
    if (!isRunning) return;
    const el = stepsRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- lastStepId re-fires the scroll when a new step arrives
  }, [isRunning, lastStepId]);

  if (!isRunning && allSteps.length === 0) return null;

  // Open automatically while running; auto-collapses once settled unless user explicitly toggled it.
  const isOpen = userOpen !== null ? userOpen : isRunning;
  const activeThought = isRunning
    ? [...steps].reverse().find((s) => s.isThought && s.detail)
    : undefined;
  const latestRunning = [...steps].reverse().find((s) => s.streaming);
  const orbVerb = latestRunning?.isThought
    ? gt("Pondering")
    : latestRunning?.label.startsWith("Running")
      ? gt("Executing")
      : latestRunning
        ? gt("Exploring")
        : gt("Working");

  return (
    <div data-dw-working-block="" data-running={isRunning ? "true" : undefined}>
      <button
        type="button"
        data-dw-working-head=""
        aria-expanded={isOpen}
        onClick={() => setUserOpen(!isOpen)}
      >
        {isOpen ? (
          <ChevronDownIcon className="size-3.5 opacity-60" />
        ) : (
          <ChevronRightIcon className="size-3.5 opacity-60" />
        )}
        <span>
          {isRunning ? (
            elapsedSec > 0 ? (
              <T>
                Working for <Var>{elapsedSec}</Var>s
              </T>
            ) : (
              <T>Working…</T>
            )
          ) : (
            <T>
              Worked · <Var>{allSteps.length}</Var> steps
            </T>
          )}
        </span>
      </button>

      <div data-dw-working-drawer={isOpen ? "open" : "closed"}>
        <div
          ref={stepsRef}
          data-dw-working-drawer-inner=""
          onScroll={(e) => {
            const el = e.currentTarget;
            const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            stickToBottomRef.current = nearBottom;
          }}
        >
          {hiddenSteps > 0 ? (
            <button type="button" data-dw-step-trigger="" onClick={() => setShowEarlierSteps(true)}>
              <span>
                <T>
                  Show earlier steps (<Var>{hiddenSteps}</Var>)
                </T>
              </span>
            </button>
          ) : null}
          {steps.map((step) => {
            const isStepOpen = Boolean(expandedIds[step.id]);
            const showLivePeek = Boolean(isRunning && activeThought?.id === step.id && !isStepOpen);
            return (
              <div key={step.id} data-dw-step-row="">
                <button
                  type="button"
                  data-dw-step-trigger=""
                  disabled={!step.detail}
                  onClick={() => setExpandedIds((prev) => ({ ...prev, [step.id]: !prev[step.id] }))}
                >
                  <span>{step.label}</span>
                  {step.detail ? (
                    isStepOpen ? (
                      <ChevronDownIcon className="size-3 opacity-50" />
                    ) : (
                      <ChevronRightIcon className="size-3 opacity-50" />
                    )
                  ) : null}
                </button>

                {showLivePeek && step.detail ? (
                  <div data-dw-thought-peek="">
                    <p>{step.detail}</p>
                  </div>
                ) : null}

                {isStepOpen && step.detail ? <pre data-dw-step-detail="">{step.detail}</pre> : null}
              </div>
            );
          })}
        </div>
      </div>

      {isRunning ? (
        <div data-dw-orb-row="">
          <span data-dw-thinking-orb="" aria-hidden="true">
            <span data-dw-orb-core="" />
            <span data-dw-orb-ring="" />
          </span>
          <span>{orbVerb}</span>
        </div>
      ) : null}
    </div>
  );
}
