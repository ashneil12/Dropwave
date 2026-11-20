import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { DropwavePersona } from "@t3tools/contracts";
import { T, Var, useGT } from "gt-react";
import { SaveIcon, UsersIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { DropwaveBotAvatar } from "./DropwaveBotAvatar";
import { useDropwaveWorkspace } from "./workspaceContext";

export function DropwaveCrewSettings() {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const environmentId = workspace?.project?.environmentId ?? null;

  const [personas, setPersonas] = useState<ReadonlyArray<DropwavePersona>>([]);
  const [drafts, setDrafts] = useState<Record<string, DropwavePersona>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const listPersonas = useAtomCommand(serverEnvironment.dropwavePersonaList, {
    reportFailure: false,
  });
  const upsertPersona = useAtomCommand(serverEnvironment.dropwavePersonaUpsert, {
    reportFailure: false,
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads global crew personas
  useEffect(() => {
    if (!environmentId) return;
    let cancelled = false;
    void listPersonas({ environmentId, input: {} }).then((res) => {
      if (cancelled) return;
      if (res._tag === "Success") {
        setError(null);
        setPersonas(res.value.items);
        setDrafts(Object.fromEntries(res.value.items.map((persona) => [persona.id, persona])));
      } else if (!isAtomCommandInterrupted(res)) {
        const cause = squashAtomCommandFailure(res);
        setError(cause instanceof Error ? cause.message : gt("Could not load crew."));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, gt, listPersonas]);

  if (!workspace || !environmentId) return null;

  const usageFor = (personaId: string) =>
    workspace.bots
      .filter((bot) => bot.source.dropwaveBot?.personaId === personaId)
      .map((bot) => {
        const project = workspace.projects.find(
          (candidate) =>
            candidate.id === bot.projectId && candidate.environmentId === bot.environmentId,
        );
        return project ? `${bot.title} · ${project.title}` : bot.title;
      });

  const patch = (personaId: string, field: keyof DropwavePersona, value: string) =>
    setDrafts((prev) => {
      const current = prev[personaId];
      if (!current) return prev;
      return { ...prev, [personaId]: { ...current, [field]: value } };
    });

  const save = async (personaId: string) => {
    const draft = drafts[personaId];
    if (!draft || busyId) return;
    setBusyId(personaId);
    setError(null);
    const res = await upsertPersona({
      environmentId,
      input: {
        id: personaId,
        name: draft.name,
        roleLabel: draft.roleLabel,
        soul: draft.soul,
        identity: draft.identity,
      },
    });
    setBusyId(null);
    if (res._tag === "Success") {
      setPersonas((prev) => prev.map((p) => (p.id === personaId ? res.value.item : p)));
      setDrafts((prev) => ({ ...prev, [personaId]: res.value.item }));
    } else if (!isAtomCommandInterrupted(res)) {
      const cause = squashAtomCommandFailure(res);
      setError(cause instanceof Error ? cause.message : gt("Could not save crew member."));
    }
  };

  return (
    <section data-dw-settings-group="">
      <h3>
        <UsersIcon className="size-3.5" data-dw-icon="indigo" />
        <T>Crew</T>
      </h3>
      <p data-dw-settings-desc="">
        <T>
          Your crew follows you into every project. The same Chief of Staff and specialists show up
          everywhere with their own memories and voice.
        </T>
      </p>
      {error ? (
        <p data-dropwave-form-error="" role="alert">
          {error}
        </p>
      ) : null}
      {personas.length === 0 ? (
        <p data-dw-settings-desc="">
          <T>No crew yet. They appear here after your first project setup.</T>
        </p>
      ) : (
        personas.map((persona) => {
          const draft = drafts[persona.id] ?? persona;
          const usage = usageFor(persona.id);
          return (
            <div key={persona.id} data-dw-setup-card="">
              <div data-dw-setup-card-head="">
                <span
                  style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                  data-dw-crew-head=""
                >
                  <DropwaveBotAvatar
                    name={draft.name}
                    seed={persona.avatarSeed}
                    role={persona.role === "chief_of_staff" ? "lead" : "specialist"}
                    size="sm"
                  />
                  {draft.name}
                </span>
                <button
                  type="button"
                  data-dw-inline-link=""
                  disabled={busyId === persona.id}
                  onClick={() => void save(persona.id)}
                >
                  <SaveIcon className="size-3" />
                  {busyId === persona.id ? <T>Saving…</T> : <T>Save</T>}
                </button>
              </div>
              <label data-dw-field-label="">
                <span>
                  <T>Name</T>
                </span>
                <input
                  data-dw-custom-answer=""
                  value={draft.name}
                  onChange={(e) => patch(persona.id, "name", e.currentTarget.value)}
                />
              </label>
              <label data-dw-field-label="">
                <span>
                  <T>Role</T>
                </span>
                <input
                  data-dw-custom-answer=""
                  value={draft.roleLabel}
                  onChange={(e) => patch(persona.id, "roleLabel", e.currentTarget.value)}
                  placeholder={persona.role === "chief_of_staff" ? gt("Chief of Staff") : ""}
                />
              </label>
              <label data-dw-field-label="">
                <span>
                  <T>Soul</T>
                </span>
                <textarea
                  data-dw-soul-input=""
                  rows={3}
                  value={draft.soul}
                  onChange={(e) => patch(persona.id, "soul", e.currentTarget.value)}
                  placeholder={gt("How this crew member thinks, speaks, and pushes back.")}
                />
              </label>
              <label data-dw-field-label="">
                <span>
                  <T>Identity</T>
                </span>
                <textarea
                  data-dw-soul-input=""
                  rows={3}
                  value={draft.identity}
                  onChange={(e) => patch(persona.id, "identity", e.currentTarget.value)}
                  placeholder={gt("What this crew member has confirmed about itself.")}
                />
              </label>
              <p data-dw-settings-desc="">
                {usage.length > 0 ? (
                  <T>
                    Used by: <Var>{usage.join(", ")}</Var>
                  </T>
                ) : (
                  <T>Not wired into any project yet.</T>
                )}
              </p>
            </div>
          );
        })
      )}
    </section>
  );
}
