import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  DEFAULT_SERVER_SETTINGS,
  DropwaveBotProfile,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Schema from "effect/Schema";
import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";

import { requestConfirmDialog } from "../confirmDialog";
import { Button } from "../components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../components/ui/dialog";
import { newThreadId } from "../lib/utils";
import {
  providerInstanceEntriesFor,
  resolveProjectDefaultProviderModelSelection,
} from "../providerInstances";
import { readEnvironmentProviders } from "../state/environments";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { environmentServerConfigsAtom } from "../state/server";
import { useEnvironmentScope } from "../state/session";
import { threadEnvironment } from "../state/threads";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { useDropwaveWorkspace, type BotEditorTarget } from "./workspaceContext";

const validProfile = Schema.is(DropwaveBotProfile);
const lines = (value: string) =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

function saveError(cause: unknown) {
  return cause instanceof Error ? cause.message : "The bot couldn’t be saved. Try again.";
}

export function DropwaveBotEditor({
  target,
  onClose,
}: {
  target: BotEditorTarget;
  onClose: () => void;
}) {
  const workspace = useDropwaveWorkspace();
  const existing = target.kind === "edit" ? target.bot : null;
  const profile = existing?.source.dropwaveBot;
  const decision = target.kind === "edit" ? target.decision : undefined;
  const environmentId =
    target.kind === "edit" ? target.bot.environmentId : target.project.environmentId;
  const canOperate = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const isLead = target.kind === "new-lead" || profile?.kind === "lead";
  const [name, setName] = useState(existing?.title ?? (isLead ? "Chief of Staff" : ""));
  const [brief, setBrief] = useState(profile?.brief ?? "");
  const [workflow, setWorkflow] = useState(
    profile?.kind === "lead" ? profile.workflow.join("\n") : "",
  );
  const [rules, setRules] = useState(profile?.kind === "lead" ? profile.rules.join("\n") : "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useOrchestrationCommand(threadEnvironment.create, { reportFailure: false });
  const update = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const archive = useOrchestrationCommand(threadEnvironment.archive, { reportFailure: false });

  if (!workspace) return null;

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending || !canOperate) return;
    setError(null);
    const title = name.trim();
    if (title === "") {
      setError("Enter a name.");
      return;
    }
    const leadThreadId =
      target.kind === "new-teammate"
        ? target.lead.id
        : profile?.kind === "teammate"
          ? profile.leadThreadId
          : null;
    const next: DropwaveBotProfile | null = isLead
      ? { kind: "lead", brief: brief.trim(), workflow: lines(workflow), rules: lines(rules) }
      : leadThreadId
        ? { kind: "teammate", brief: brief.trim(), leadThreadId }
        : null;
    if (next === null || !validProfile(next)) {
      setError("Keep to 12 workflow steps and 20 rules, with at most 400 characters per line.");
      return;
    }
    const threadId = existing?.id ?? newThreadId();
    let commit;
    if (target.kind === "edit") {
      commit = () => update({ environmentId, input: { threadId, title, dropwaveBot: next } });
    } else {
      const providers = readEnvironmentProviders(environmentId) ?? [];
      const settings =
        appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.settings ??
        DEFAULT_SERVER_SETTINGS;
      const projectSettings = resolveProjectSettings(settings, target.project.id).settings;
      const configured = target.project.defaultModelSelection;
      const available = providerInstanceEntriesFor(providers, settings, target.project.id);
      const modelSelection =
        configured &&
        available.some(
          (entry) =>
            entry.instanceId === configured.instanceId && entry.enabled && entry.isAvailable,
        )
          ? configured
          : resolveProjectDefaultProviderModelSelection(providers, settings, target.project.id);
      if (!modelSelection) {
        setError("Connect an agent provider in Settings, then try again.");
        return;
      }
      commit = () =>
        create({
          environmentId,
          input: {
            threadId,
            projectId: target.project.id,
            title,
            dropwaveBot: next,
            modelSelection,
            runtimeMode: projectSettings.defaultRuntimeMode,
            interactionMode: "default",
            branch: null,
            worktreePath: null,
          },
        });
    }

    setPending(true);
    const result = await commit().catch((cause: unknown) => {
      setError(saveError(cause));
      return null;
    });
    setPending(false);
    if (result === null) return;
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) setError(saveError(squashAtomCommandFailure(result)));
      return;
    }
    if (target.kind === "edit") onClose();
    else workspace.openThread(scopeThreadRef(environmentId, threadId));
  };

  const archiveBot = async () => {
    if (!existing || !canOperate || pending) return;
    setPending(true);
    const message = isLead
      ? "Archive this lead? The project can have a new lead. This conversation will be kept in Archived threads."
      : "Archive this teammate? The conversation will be kept in Archived threads.";
    if (!(await requestConfirmDialog(message))) {
      setPending(false);
      return;
    }
    const result = await archive({ environmentId, input: { threadId: existing.id } }).catch(
      (cause: unknown) => {
        setError(
          cause instanceof Error ? cause.message : "The bot couldn’t be archived. Try again.",
        );
        return null;
      },
    );
    setPending(false);
    if (result === null) return;
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const cause = squashAtomCommandFailure(result);
        setError(
          cause instanceof Error ? cause.message : "The bot couldn’t be archived. Try again.",
        );
      }
      return;
    }
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogPopup data-dropwave-editor="">
        <form onSubmit={(event) => void save(event)} aria-busy={pending}>
          <DialogHeader>
            <DialogTitle>
              {decision
                ? "Standing rules"
                : target.kind === "edit"
                  ? "Bot profile"
                  : isLead
                    ? "Create a lead"
                    : "Add teammate"}
            </DialogTitle>
            <DialogDescription>
              {decision
                ? "Add a rule for future decisions. Answer the current question in the conversation."
                : isLead
                  ? "The lead turns your ideas into work and coordinates the team."
                  : "Give this bot a clear responsibility so your lead knows when to bring it in."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div data-dropwave-form="">
              {decision ? <p data-dropwave-rule-question="">{decision}</p> : null}
              <label hidden={Boolean(decision)}>
                Name
                <input
                  required
                  maxLength={100}
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                />
              </label>
              <label hidden={Boolean(decision)}>
                {isLead ? "Project brief" : "Responsibility"}
                <textarea
                  rows={3}
                  maxLength={4000}
                  value={brief}
                  onChange={(event) => setBrief(event.currentTarget.value)}
                  placeholder={
                    isLead
                      ? "What are we building, and what should the lead know?"
                      : "What can this teammate take ownership of?"
                  }
                />
              </label>
              {isLead ? (
                <>
                  <label hidden={Boolean(decision)}>
                    Workflow <span>One step per line</span>
                    <textarea
                      rows={3}
                      maxLength={4800}
                      value={workflow}
                      onChange={(event) => setWorkflow(event.currentTarget.value)}
                      placeholder={
                        "Plan the change\nBuild it in a worktree\nRun the tests and show the result"
                      }
                    />
                  </label>
                  <label>
                    Rules <span>One per line</span>
                    <textarea
                      rows={2}
                      maxLength={8000}
                      value={rules}
                      onChange={(event) => setRules(event.currentTarget.value)}
                      placeholder="Ask me before publishing."
                    />
                  </label>
                </>
              ) : null}
              {!canOperate ? (
                <p role="status">This connection doesn’t have permission to edit the team.</p>
              ) : null}
              {error ? (
                <p data-dropwave-form-error="" role="alert">
                  {error}{" "}
                  {error.includes("provider") ? (
                    <Link to="/settings/providers" onClick={onClose}>
                      Provider settings
                    </Link>
                  ) : null}
                </p>
              ) : null}
            </div>
          </DialogPanel>
          <DialogFooter>
            {existing && !decision ? (
              <button
                data-dropwave-archive=""
                type="button"
                onClick={() => void archiveBot()}
                disabled={!canOperate || pending}
              >
                Archive
              </button>
            ) : null}
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canOperate || pending}>
              {pending
                ? "Saving…"
                : existing
                  ? "Save changes"
                  : isLead
                    ? "Create lead"
                    : "Add teammate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
