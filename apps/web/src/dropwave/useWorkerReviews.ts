import type {
  DropwaveWorkerReview,
  EnvironmentId,
  ModelSelection,
  ProjectId,
} from "@t3tools/contracts";
import { useEffect, useRef, useState } from "react";

import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { deriveProviderInstanceEntries } from "../providerInstances";
import { serverEnvironment } from "../state/server";
import { useEnvironmentProviders } from "../state/environments";
import { useAtomCommand } from "../state/use-atom-command";

const ACTIVE_REVIEW_POLL_MS = 8_000;

const isActiveReview = (review: DropwaveWorkerReview) =>
  review.status === "reviewing" || review.status === "fixing";

/**
 * Fusion worker-review records for a project, keyed by delegated job id.
 * `refreshKey` should change whenever the caller's view of worker jobs changes
 * (subagent statuses, ask reloads). While any review is still running the hook
 * polls slowly so Reviewing → Fixing → Approved stays live, then stops.
 */
export function useWorkerReviews(input: {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
  readonly refreshKey?: string;
}): ReadonlyMap<string, DropwaveWorkerReview> {
  const listCmd = useAtomCommand(serverEnvironment.dropwaveWorkerReviewsList, {
    reportFailure: false,
  });
  const [reviews, setReviews] = useState<ReadonlyArray<DropwaveWorkerReview>>([]);
  const hasActiveRef = useRef(false);
  const requestSeq = useRef(0);
  const refreshKey = input.refreshKey ?? "";
  const { environmentId, projectId } = input;

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls dropwave.workerReviews.list; review state lives in the server store, not an atom
  useEffect(() => {
    if (environmentId === null || projectId === null) {
      // oxlint-disable-next-line react/set-state-in-effect -- drops stale reviews when the project context goes away
      setReviews([]);
      hasActiveRef.current = false;
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const load = () => {
      const seq = ++requestSeq.current;
      void listCmd({
        environmentId,
        input: { projectId, limit: 200 },
      }).then((res) => {
        if (cancelled || seq !== requestSeq.current) return;
        if (res._tag === "Success") {
          hasActiveRef.current = res.value.reviews.some(isActiveReview);
          setReviews(res.value.reviews);
        } else if (!isAtomCommandInterrupted(res)) {
          squashAtomCommandFailure(res);
        }
      });
    };
    load();
    timer = setInterval(() => {
      if (!hasActiveRef.current) {
        if (timer !== undefined) clearInterval(timer);
        timer = undefined;
        return;
      }
      load();
    }, ACTIVE_REVIEW_POLL_MS);
    return () => {
      cancelled = true;
      if (timer !== undefined) clearInterval(timer);
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- refreshKey re-fires the load when the caller's job statuses change
  }, [environmentId, projectId, refreshKey, listCmd]);

  const map = new Map<string, DropwaveWorkerReview>();
  for (const review of reviews) map.set(review.jobId, review);
  return map;
}

/** Display name for a model selection, resolved against live provider metadata. */
export function useModelSelectionLabel(
  environmentId: EnvironmentId | null,
  selection: ModelSelection | null | undefined,
): string | null {
  const providersByEnv = useEnvironmentProviders();
  if (environmentId === null || selection === null || selection === undefined) return null;
  const providers = providersByEnv.get(environmentId) ?? [];
  const entries = deriveProviderInstanceEntries(providers);
  const entry = entries.find((candidate) => candidate.instanceId === selection.instanceId);
  const model = entry?.models.find((candidate) => candidate.slug === selection.model);
  return model?.name ?? model?.shortName ?? selection.model;
}
