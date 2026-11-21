import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { DropwaveDoc, DropwaveDocSummary } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { T, useGT } from "gt-react";
import {
  CheckCircle2Icon,
  LayoutGridIcon,
  PinIcon,
  PinOffIcon,
  Trash2Icon,
  Wand2Icon,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { useLocalStorage } from "../hooks/useLocalStorage";
import { newMessageId } from "../lib/utils";
import { serverEnvironment } from "../state/server";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { useDropwaveWorkspace } from "./workspaceContext";

export const PINNED_HUBS_KEY = "dropwave:pinned-hubs";
export const PinnedHubsSchema = Schema.Array(Schema.String);
export const BUILTIN_SHIP_GATE_HUB_ID = "builtin:ship-gate";
/** Retired hub id kept only to sanitize stale pins stored in localStorage. */
const RETIRED_KANBAN_HUB_ID = "builtin:kanban";

function liveHubId(id: string | null | undefined): string {
  return !id || id === RETIRED_KANBAN_HUB_ID ? BUILTIN_SHIP_GATE_HUB_ID : id;
}

const DROPWAVE_HUB_THEME_HEAD = `<style>
:root {
  --bg: transparent;
  --ink: #f4f3ef;
  --muted: rgba(244, 243, 239, 0.58);
  --line: rgba(255, 255, 255, 0.10);
  --surface: rgba(255, 255, 255, 0.06);
  --accent: #a8acff;
  --ok: #5cd68d;
  --warn: #e8b35a;
  --alert: #ef6b6b;
  color-scheme: dark;
}
html, body {
  margin: 0; padding: 18px;
  background: transparent;
  color: var(--ink);
  font-family: "Instrument Sans", Inter, -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased;
}
</style>`;

function injectHubTheme(rawHtml: string): string {
  if (/<head[^>]*>/i.test(rawHtml)) {
    return rawHtml.replace(/<head[^>]*>/i, (m) => `${m}${DROPWAVE_HUB_THEME_HEAD}`);
  }
  return `<!doctype html><html><head><meta charset="utf-8">${DROPWAVE_HUB_THEME_HEAD}</head><body>${rawHtml}</body></html>`;
}

const ChecklistSchema = Schema.Record(Schema.String, Schema.Boolean);

function BuiltinShipGateHub({ projectKey }: { projectKey: string }) {
  const gt = useGT();
  const [checked, setChecked] = useLocalStorage(
    `dropwave:ship-gate:${projectKey}`,
    {},
    ChecklistSchema,
  );
  const gates = [
    { id: "tests", label: gt("Unit & integration tests passing locally") },
    { id: "qa", label: gt("Independent QA agent verified real user flows") },
    { id: "docs", label: gt("Release brief updated in .dropwave/docs/") },
    { id: "asks", label: gt("All tracked owner asks closed with real proof") },
    { id: "rollback", label: gt("Rollback path confirmed before production push") },
  ];
  const doneCount = gates.filter((g) => checked[g.id]).length;

  return (
    <div data-dw-ship-gate="">
      <div data-dw-ship-gate-head="">
        <h3>
          <T>Pre-Ship Verification Gate</T>
        </h3>
        <span data-dw-mono="emerald">
          {doneCount}/{gates.length}
        </span>
      </div>
      <div data-dw-ship-gate-list="">
        {gates.map((gate) => (
          <label key={gate.id} data-dw-check-row="">
            <input
              type="checkbox"
              checked={Boolean(checked[gate.id])}
              onChange={(e) => setChecked({ ...checked, [gate.id]: e.currentTarget.checked })}
            />
            <span>{gate.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function DropwaveHubsView({
  initialHubId,
  onSelectHubId,
}: {
  initialHubId?: string | null;
  onSelectHubId?: (id: string) => void;
}) {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const project = workspace?.project ?? null;

  const [pinnedHubs, setPinnedHubs] = useLocalStorage(
    PINNED_HUBS_KEY,
    [BUILTIN_SHIP_GATE_HUB_ID],
    PinnedHubsSchema,
  );
  const [customHubs, setCustomHubs] = useState<ReadonlyArray<DropwaveDocSummary>>([]);
  const [selectedHubId, setSelectedHubId] = useState<string>(() => liveHubId(initialHubId));
  const [loadedHubDoc, setLoadedHubDoc] = useState<DropwaveDoc | null>(null);
  const [buildIdea, setBuildIdea] = useState("");
  const [building, setBuilding] = useState(false);
  const [nonce, setNonce] = useState(0);

  const listDocs = useAtomCommand(serverEnvironment.dropwaveDocsList, { reportFailure: false });
  const readDoc = useAtomCommand(serverEnvironment.dropwaveDocRead, { reportFailure: false });
  const deleteDoc = useAtomCommand(serverEnvironment.dropwaveDocDelete, { reportFailure: false });
  const startTurn = useOrchestrationCommand(threadEnvironment.startTurn, { reportFailure: false });

  const activeHubId = liveHubId(initialHubId || selectedHubId);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- lists custom agent-built HTML hubs from .dropwave/hubs/
  useEffect(() => {
    if (!project || nonce < 0) return;
    let cancelled = false;
    void listDocs({
      environmentId: project.environmentId,
      input: { projectId: project.id },
    }).then((res) => {
      if (!cancelled && res._tag === "Success") {
        setCustomHubs(
          res.value.docs.filter((d) => d.kind === "hub" || d.path.startsWith(".dropwave/hubs/")),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [listDocs, nonce, project]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads active custom hub HTML source
  useEffect(() => {
    if (!project || activeHubId.startsWith("builtin:")) {
      return;
    }
    let cancelled = false;
    void readDoc({
      environmentId: project.environmentId,
      input: { projectId: project.id, path: activeHubId },
    }).then((res) => {
      if (!cancelled && res._tag === "Success") {
        setLoadedHubDoc(res.value.doc);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeHubId, project, readDoc]);

  if (!workspace || !project) {
    return (
      <div data-dropwave-panel-empty="">
        <LayoutGridIcon />
        <p>
          <T>Select a project to open built-in and agent-built Hubs.</T>
        </p>
      </div>
    );
  }

  const pinnedSet = new Set(pinnedHubs);
  const togglePin = (id: string) => {
    if (pinnedSet.has(id)) setPinnedHubs(pinnedHubs.filter((item) => item !== id));
    else setPinnedHubs([...pinnedHubs, id]);
  };

  const selectHub = (id: string) => {
    setSelectedHubId(id);
    onSelectHubId?.(id);
  };

  const askLeadToBuildHub = async (e: FormEvent) => {
    e.preventDefault();
    const idea = buildIdea.trim();
    if (!idea || !workspace.lead || building) return;
    setBuilding(true);
    const prompt = `Build a custom interactive Dropwave Hub mod for this project: "${idea}". Write a single self-contained HTML file to .dropwave/hubs/ using dropwave_docs (kind: "hub") with a clean <title> and Dropwave dark glass styling (transparent body, crisp typography, interactive controls). Tell me when it is ready so I can pin it.`;
    const res = await startTurn({
      environmentId: workspace.lead.environmentId,
      input: {
        threadId: workspace.lead.id,
        message: { messageId: newMessageId(), role: "user", text: prompt, attachments: [] },
        runtimeMode: workspace.lead.source.runtimeMode,
        interactionMode: workspace.lead.source.interactionMode,
      },
    });
    setBuilding(false);
    if (res._tag === "Success") {
      setBuildIdea("");
      workspace.openThread(scopeThreadRef(workspace.lead.environmentId, workspace.lead.id));
    }
  };

  const deleteCustomHub = async (path: string) => {
    await deleteDoc({
      environmentId: project.environmentId,
      input: { projectId: project.id, path },
    });
    if (pinnedSet.has(path)) togglePin(path);
    selectHub(BUILTIN_SHIP_GATE_HUB_ID);
    setNonce((n) => n + 1);
  };

  const isBuiltin = activeHubId.startsWith("builtin:");

  return (
    <section data-dw-hubs-view="" aria-label={gt("Project Hubs")}>
      <aside data-dw-hubs-rail="">
        <div data-dw-rail-head="">
          <span>
            <T>Shipped Hubs</T>
          </span>
        </div>
        <div data-dw-hub-list="">
          {[{ id: BUILTIN_SHIP_GATE_HUB_ID, title: gt("Ship Gate"), icon: CheckCircle2Icon }].map(
            (hub) => {
              const Icon = hub.icon;
              const pinned = pinnedSet.has(hub.id);
              return (
                <div
                  key={hub.id}
                  data-dw-hub-item=""
                  data-active={activeHubId === hub.id ? "true" : undefined}
                >
                  <button type="button" data-dw-hub-pick="" onClick={() => selectHub(hub.id)}>
                    <Icon className="size-3.5 shrink-0" />
                    <span>{hub.title}</span>
                  </button>
                  <button
                    type="button"
                    data-dw-pin-btn=""
                    aria-label={pinned ? gt("Unpin hub") : gt("Pin hub to sidebar")}
                    aria-pressed={pinned}
                    onClick={() => togglePin(hub.id)}
                  >
                    {pinned ? <PinOffIcon className="size-3" /> : <PinIcon className="size-3" />}
                  </button>
                </div>
              );
            },
          )}
        </div>

        <div data-dw-rail-head="" style={{ marginTop: 14 }}>
          <span>
            <T>Agent Mods</T>
          </span>
          <span data-dw-rail-count="">{customHubs.length}</span>
        </div>
        <div data-dw-hub-list="">
          {customHubs.map((hub) => {
            const pinned = pinnedSet.has(hub.path);
            return (
              <div
                key={hub.path}
                data-dw-hub-item=""
                data-active={activeHubId === hub.path ? "true" : undefined}
              >
                <button type="button" data-dw-hub-pick="" onClick={() => selectHub(hub.path)}>
                  <LayoutGridIcon className="size-3.5 shrink-0" />
                  <span>{hub.title}</span>
                </button>
                <button
                  type="button"
                  data-dw-pin-btn=""
                  aria-label={pinned ? gt("Unpin hub") : gt("Pin hub to sidebar")}
                  aria-pressed={pinned}
                  onClick={() => togglePin(hub.path)}
                >
                  {pinned ? <PinOffIcon className="size-3" /> : <PinIcon className="size-3" />}
                </button>
              </div>
            );
          })}
          {customHubs.length === 0 ? (
            <p data-dw-rail-empty="">
              <T>Ask your Lead bot below to generate custom UIs saved in .dropwave/hubs/.</T>
            </p>
          ) : null}
        </div>

        <form data-dw-hub-builder="" onSubmit={(e) => void askLeadToBuildHub(e)}>
          <span data-dw-section-micro="">
            <T>Create a custom Hub</T>
          </span>
          <input
            value={buildIdea}
            onChange={(e) => setBuildIdea(e.currentTarget.value)}
            placeholder={gt("e.g. Pricing calculator, KPI board…")}
          />
          <button
            type="submit"
            data-dw-btn-solid=""
            disabled={!buildIdea.trim() || !workspace.lead || building}
          >
            <Wand2Icon className="size-3.5" />
            <T>Ask Lead to build</T>
          </button>
        </form>
      </aside>

      <div data-dw-hubs-stage="">
        {activeHubId === BUILTIN_SHIP_GATE_HUB_ID ? (
          <BuiltinShipGateHub projectKey={`${project.environmentId}:${project.id}`} />
        ) : !isBuiltin && loadedHubDoc ? (
          <div data-dw-custom-hub-frame="">
            <header data-dw-custom-hub-head="">
              <div>
                <strong>{loadedHubDoc.title}</strong>
                <span data-dw-mono="dim">{loadedHubDoc.path}</span>
              </div>
              <button
                type="button"
                data-dw-mini-icon=""
                aria-label={gt("Delete custom hub")}
                onClick={() => void deleteCustomHub(loadedHubDoc.path)}
              >
                <Trash2Icon className="size-3.5" />
              </button>
            </header>
            <iframe
              title={loadedHubDoc.title}
              sandbox="allow-scripts"
              srcDoc={injectHubTheme(loadedHubDoc.content)}
            />
          </div>
        ) : (
          <div data-dropwave-panel-empty="">
            <LayoutGridIcon />
            <p>
              <T>Loading custom hub…</T>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
