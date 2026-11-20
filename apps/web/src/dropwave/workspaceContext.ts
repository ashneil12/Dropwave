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
  | { kind: "team" | "activity" | "needs" }
  | { kind: "work"; owner: ScopedThreadRef }
  | { kind: "profile"; target: BotEditorTarget };

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
  readonly selectedProjectKey: string | null;
  readonly selectProject: (project: EnvironmentProject) => void;
  readonly openThread: (thread: ScopedThreadRef) => void;
  readonly openPanel: (panel: WorkspacePanel) => void;
  readonly showClassicSidebar: () => void;
}

export const DropwaveWorkspaceContext = createContext<DropwaveWorkspaceState | null>(null);
export const useDropwaveWorkspace = () => use(DropwaveWorkspaceContext);
export const DropwaveModeContext = createContext(false);
export const useDropwaveMode = () => use(DropwaveModeContext);
