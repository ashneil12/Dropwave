import type {
  DropwaveWorkerReview,
  DropwaveWorkerReviewsListResult,
  EnvironmentId,
  ModelSelection,
  ProjectId,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { useAtomValue } from "@effect/atom-react";

import { deriveProviderInstanceEntries } from "../providerInstances";
import { serverEnvironment } from "../state/server";
import { useEnvironmentProviders } from "../state/environments";

const EMPTY_WORKER_REVIEWS_ATOM = Atom.make(
  AsyncResult.success<DropwaveWorkerReviewsListResult, never>({ reviews: [] }),
);

/**
 * Fusion worker-review records for a project, keyed by delegated job id.
 * Backed by the live `dropwave.workerReviews.subscribe` stream, so
 * Reviewing → Fixing → Approved updates without polling.
 */
export function useWorkerReviews(input: {
  readonly environmentId: EnvironmentId | null;
  readonly projectId: ProjectId | null;
}): ReadonlyMap<string, DropwaveWorkerReview> {
  const { environmentId, projectId } = input;
  const liveAtom =
    environmentId === null || projectId === null
      ? EMPTY_WORKER_REVIEWS_ATOM
      : serverEnvironment.dropwaveWorkerReviewsLive({
          environmentId,
          input: { projectId, limit: 200 },
        });
  const result = useAtomValue(liveAtom);
  const reviews = AsyncResult.isSuccess(result) ? result.value.reviews : [];
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
