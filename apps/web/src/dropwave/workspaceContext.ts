import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { createContext, use } from "react";

export type BotEditorTarget =
  | { kind: "new-lead"; project: EnvironmentProject }
  | { kind: "new-teammate"; project: EnvironmentProject; lead: EnvironmentThreadShell }
  | { kind: "edit"; bot: EnvironmentThreadShell; decision?: string };

export type WorkspacePanel =
  | { kind: "team" | "activity" | "asks" }
  | { kind: "work"; owner: ScopedThreadRef }
  | { kind: "profile"; target: BotEditorTarget };

export type DropwaveMainView = "chat" | "docs" | "asks" | "hubs" | "habits" | "setup";

interface DropwaveWorkspaceState {
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly project: EnvironmentProject | null;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly bots: ReadonlyArray<EnvironmentThreadShell>;
  readonly lead: EnvironmentThreadShell | null;
  readonly leadHidden: boolean;
  readonly activeThread: EnvironmentThreadShell | null;
  readonly activeBot: EnvironmentThreadShell | null;
  readonly needs: ReadonlyArray<EnvironmentThreadShell>;
  readonly needsProject: (project: EnvironmentProject) => boolean;
  readonly selectedProjectKey: string | null;
  readonly mainView: DropwaveMainView;
  readonly setMainView: (
    view: DropwaveMainView,
    options?: { readonly newProject?: boolean },
  ) => void;
  readonly openHub: (hubId: string) => void;
  readonly openAsksCount: number;
  readonly refreshOpenAsksCount: () => void;
  readonly selectProject: (project: EnvironmentProject) => void;
  readonly openThread: (thread: ScopedThreadRef) => void;
  /** Opens the thread and drops `text` into its composer without sending. */
  readonly prefillComposer: (thread: ScopedThreadRef, text: string) => void;
  readonly openPanel: (panel: WorkspacePanel | null) => void;
  readonly openDecisionQueue: () => void;
  readonly openSettings: () => void;
}

export const DropwaveWorkspaceContext = createContext<DropwaveWorkspaceState | null>(null);
export const useDropwaveWorkspace = () => use(DropwaveWorkspaceContext);
export const DropwaveModeContext = createContext(false);
export const useDropwaveMode = () => use(DropwaveModeContext);
