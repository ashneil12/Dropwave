import type { DropwaveWorkerReview } from "@t3tools/contracts";
import { useGT } from "gt-react";

import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";

/**
 * Fusion worker-review state chip: Reviewing (model) → Fixing (round n) →
 * Approved / Changes requested / Unreviewed. Shared by chat run rows and ask
 * cards so a delegated job reads the same everywhere.
 */
export function DropwaveReviewChip({
  review,
  reviewerName,
}: {
  review: DropwaveWorkerReview;
  /** Display name for in-flight states before the first verdict lands. */
  reviewerName?: string | null | undefined;
}) {
  const gt = useGT();
  const latest = review.verdicts.at(-1);
  const name = latest?.reviewerModel ?? reviewerName ?? null;
  const summary = latest?.summary ?? "";

  let label: string;
  let tone: "indigo" | "amber" | "emerald" | "coral" | "dim";
  switch (review.status) {
    case "reviewing":
      label = name === null ? gt("Reviewing") : gt("Reviewing ({name})", { name });
      tone = "indigo";
      break;
    case "fixing":
      label = gt("Fixing · round {round}", { round: review.rounds });
      tone = "amber";
      break;
    case "approved":
      label = name === null ? gt("Approved") : gt("Approved · {name}", { name });
      tone = "emerald";
      break;
    case "changes":
      label = gt("Changes requested");
      tone = "coral";
      break;
    case "unreviewed":
      label = gt("Unreviewed");
      tone = "dim";
      break;
  }

  if (summary.length === 0) {
    return (
      <span data-dw-review-chip="" data-tone={tone}>
        {label}
      </span>
    );
  }
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger render={<span data-dw-review-chip="" data-tone={tone} />}>
          {label}
        </TooltipTrigger>
        <TooltipPopup>{summary}</TooltipPopup>
      </Tooltip>
    </TooltipProvider>
  );
}
