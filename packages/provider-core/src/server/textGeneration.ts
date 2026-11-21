import type {
  BranchNamingOptions,
  ChatAttachment,
  ModelSelection,
  ProjectId,
  PullRequestReviewGuide,
  TextGenerationError,
} from "@t3tools/contracts";
import type * as Effect from "effect/Effect";

import type { TextGenerationPolicy } from "./textGenerationPolicy.ts";
import type { ThreadTitleForkSource } from "./textGenerationPrompts.ts";

export interface CommitMessageGenerationInput {
  cwd: string;
  branch: string | null;
  stagedSummary: string;
  stagedPatch: string;
  includeBranch?: boolean;
  policy?: TextGenerationPolicy | undefined;
  modelSelection: ModelSelection;
  projectId?: ProjectId | null | undefined;
}

export interface CommitMessageGenerationResult {
  subject: string;
  body: string;
  branch?: string | undefined;
}

export interface PrContentGenerationInput {
  cwd: string;
  baseBranch: string;
  headBranch: string;
  commitSummary: string;
  diffSummary: string;
  diffPatch: string;
  changeRequestTemplate?: string | undefined;
  threadContext?: string | undefined;
  policy?: TextGenerationPolicy | undefined;
  modelSelection: ModelSelection;
  projectId?: ProjectId | null | undefined;
}

export interface PrContentGenerationResult {
  title: string;
  body: string;
}

export interface BranchNameGenerationInput {
  naming?: BranchNamingOptions | undefined;
  cwd: string;
  message: string;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  modelSelection: ModelSelection;
  projectId?: ProjectId | null | undefined;
}

export interface BranchNameGenerationResult {
  branch: string;
}

export interface ThreadTitleGenerationInput {
  linkedContext?: string | undefined;
  cwd: string;
  message: string;
  projectTitle?: string | undefined;
  previousTitle?: string | undefined;
  forkSource?: ThreadTitleForkSource | undefined;
  attachments?: ReadonlyArray<ChatAttachment> | undefined;
  instructions?: string | undefined;
  modelSelection: ModelSelection;
  projectId?: ProjectId | null | undefined;
}

export interface ThreadTitleGenerationResult {
  title: string;
  needsRefinement?: boolean | undefined;
}

export interface ReviewGuideStackLayer {
  readonly number: number;
  readonly title: string | null;
  readonly headSha: string | null;
  readonly state: "open" | "closed" | "merged";
}

export interface ReviewGuideGenerationInput {
  cwd: string;
  number: number;
  title: string;
  description: string;
  baseBranch: string;
  baseCommit: string;
  settledReview: string;
  instructions?: string | undefined;
  stack?: ReadonlyArray<ReviewGuideStackLayer> | undefined;
  modelSelection: ModelSelection;
  projectId?: ProjectId | null | undefined;
}

export type ReviewGuideGenerationResult = Omit<
  PullRequestReviewGuide,
  "headSha" | "generatedAt" | "modelSelection"
>;

export interface TranscriptionPostProcessingInput {
  cwd: string;
  prompt: string;
  modelSelection: ModelSelection;
}

export interface TranscriptionPostProcessingResult {
  transcription: string;
}

export interface WorkerReviewIssue {
  readonly severity: "blocker" | "major" | "minor";
  readonly file: string;
  readonly line: number | null;
  readonly problem: string;
  readonly fix: string;
}

export interface WorkerReviewGenerationInput {
  /** The worker's checkout; the reviewer reads it read-only when it can investigate. */
  cwd: string;
  /** The delegate_task brief without the appended worker boilerplate. */
  brief: string;
  /** Definition-of-done check lines, when the brief carried them. */
  doneChecks?: string | undefined;
  /** The worker's latest final report. */
  workerReport: string;
  /** `git diff <base>...HEAD` plus the uncommitted diff stat, capped inline. */
  diff: string;
  /** Appended inside the diff heading, e.g. that the diff is inlined for a non-investigating reviewer. */
  diffNote?: string | undefined;
  /** Default true: investigate cwd read-only. False: single-shot with the diff inline. */
  investigate?: boolean | undefined;
  modelSelection: ModelSelection;
  projectId?: ProjectId | null | undefined;
}

export interface WorkerReviewGenerationResult {
  readonly verdict: "approve" | "changes";
  readonly summary: string;
  readonly issues: ReadonlyArray<WorkerReviewIssue>;
}

export interface ProviderTextGeneration {
  readonly generateTranscriptionPostProcessing: (
    input: TranscriptionPostProcessingInput,
  ) => Effect.Effect<TranscriptionPostProcessingResult, TextGenerationError>;

  readonly generateCommitMessage: (
    input: CommitMessageGenerationInput,
  ) => Effect.Effect<CommitMessageGenerationResult, TextGenerationError>;

  readonly generatePrContent: (
    input: PrContentGenerationInput,
  ) => Effect.Effect<PrContentGenerationResult, TextGenerationError>;

  readonly generateBranchName: (
    input: BranchNameGenerationInput,
  ) => Effect.Effect<BranchNameGenerationResult, TextGenerationError>;

  readonly generateThreadTitle: (
    input: ThreadTitleGenerationInput,
  ) => Effect.Effect<ThreadTitleGenerationResult, TextGenerationError>;

  readonly generateReviewGuide: (
    input: ReviewGuideGenerationInput,
  ) => Effect.Effect<ReviewGuideGenerationResult, TextGenerationError>;

  readonly generateWorkerReview: (
    input: WorkerReviewGenerationInput,
  ) => Effect.Effect<WorkerReviewGenerationResult, TextGenerationError>;
}
