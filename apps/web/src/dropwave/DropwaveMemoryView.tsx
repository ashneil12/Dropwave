import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type DropwaveMemoryItem,
  type DropwaveMemoryKind,
  type DropwaveMemoryScope,
  type DropwaveMemoryStatus,
  type DropwaveMemoryTier,
} from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { T, msg, useGT } from "gt-react";
import {
  BrainIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  SearchIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { DropwaveSelect, type DropwaveSelectOption } from "./DropwaveSelect";
import { useDropwaveWorkspace } from "./workspaceContext";

interface RecallTraceEntry {
  readonly id: string;
  readonly turnKey: string;
  readonly createdAt: string;
  readonly trace: unknown;
}

interface TraceScore {
  readonly id: string;
  readonly score?: number;
  readonly semantic?: number;
  readonly lexical?: number;
  readonly via?: string;
}

interface TraceDrop {
  readonly id: string;
  readonly reason: string;
}

function asTrace(value: unknown): {
  gate?: string;
  shown?: ReadonlyArray<TraceScore>;
  drops?: ReadonlyArray<TraceDrop>;
  vectors?: boolean;
  timing?: {
    readonly totalMs?: number;
    readonly ftsMs?: number;
    readonly vectorMs?: number;
    readonly graphMs?: number;
  };
} {
  if (typeof value !== "object" || value === null) return {};
  const record = value as Record<string, unknown>;
  return {
    ...(typeof record.gate === "string" ? { gate: record.gate } : {}),
    ...(Array.isArray(record.shown) ? { shown: record.shown as TraceScore[] } : {}),
    ...(Array.isArray(record.drops) ? { drops: record.drops as TraceDrop[] } : {}),
    ...(typeof record.vectors === "boolean" ? { vectors: record.vectors } : {}),
    ...(typeof record.timing === "object" && record.timing !== null
      ? { timing: record.timing as NonNullable<ReturnType<typeof asTrace>["timing"]> }
      : {}),
  };
}

const KIND_OPTIONS: ReadonlyArray<DropwaveSelectOption<DropwaveMemoryKind | "all">> = [
  { value: "all", label: msg("All kinds") },
  { value: "fact", label: msg("Fact") },
  { value: "preference", label: msg("Preference") },
  { value: "rule", label: msg("Rule") },
  { value: "decision", label: msg("Decision") },
  { value: "lesson", label: msg("Lesson") },
  { value: "person", label: msg("Person") },
  { value: "project", label: msg("Project") },
  { value: "tool", label: msg("Tool") },
];

const TIER_OPTIONS: ReadonlyArray<DropwaveSelectOption<DropwaveMemoryTier | "all">> = [
  { value: "all", label: msg("All tiers") },
  { value: "core", label: msg("Core") },
  { value: "semantic", label: msg("Semantic") },
  { value: "episodic", label: msg("Episodic") },
];

const STATUS_OPTIONS: ReadonlyArray<DropwaveSelectOption<DropwaveMemoryStatus | "all">> = [
  { value: "all", label: msg("All statuses") },
  { value: "active", label: msg("Active") },
  { value: "needs_review", label: msg("Needs review") },
  { value: "superseded", label: msg("Superseded") },
  { value: "archived", label: msg("Archived") },
];

export function DropwaveMemoryView({ project }: { project: EnvironmentProject }) {
  const gt = useGT();
  const workspace = useDropwaveWorkspace();
  const environmentId = project.environmentId;

  const [items, setItems] = useState<ReadonlyArray<DropwaveMemoryItem>>([]);
  const [personaNames, setPersonaNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<DropwaveMemoryKind | "all">("all");
  const [tierFilter, setTierFilter] = useState<DropwaveMemoryTier | "all">("all");
  const [statusFilter, setStatusFilter] = useState<DropwaveMemoryStatus | "all">("all");
  const [searchTrace, setSearchTrace] = useState<{ gate: string; shown: number } | null>(null);
  const [tracesOpen, setTracesOpen] = useState(false);
  const [traces, setTraces] = useState<ReadonlyArray<RecallTraceEntry>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listMemCmd = useAtomCommand(serverEnvironment.dropwaveMemoryList, {
    reportFailure: false,
  });
  const searchMemCmd = useAtomCommand(serverEnvironment.dropwaveMemorySearch, {
    reportFailure: false,
  });
  const tracesCmd = useAtomCommand(serverEnvironment.dropwaveMemoryTraces, {
    reportFailure: false,
  });
  const reviewCmd = useAtomCommand(serverEnvironment.dropwaveMemoryReview, {
    reportFailure: false,
  });
  const undoCmd = useAtomCommand(serverEnvironment.dropwaveMemoryUndo, {
    reportFailure: false,
  });
  const removeCmd = useAtomCommand(serverEnvironment.dropwaveMemoryRemove, {
    reportFailure: false,
  });
  const scopeCmd = useAtomCommand(serverEnvironment.dropwaveMemorySetScope, {
    reportFailure: false,
  });
  const listPersonasCmd = useAtomCommand(serverEnvironment.dropwavePersonaList, {
    reportFailure: false,
  });

  const reload = () => {
    const statuses =
      statusFilter === "all"
        ? (["active", "needs_review", "superseded", "archived"] as const)
        : statusFilter === "active"
          ? (["active", "needs_review"] as const)
          : ([statusFilter] as const);
    void listMemCmd({
      environmentId,
      input: {
        projectId: project.id,
        limit: 200,
        ...(statuses !== undefined ? { statuses: [...statuses] } : {}),
      },
    }).then((res) => {
      if (res._tag === "Success") {
        setError(null);
        setItems(res.value.items);
      } else if (!isAtomCommandInterrupted(res)) {
        const cause = squashAtomCommandFailure(res);
        setError(cause instanceof Error ? cause.message : gt("Could not load memory."));
      }
    });
    void listPersonasCmd({ environmentId, input: {} }).then((personaRes) => {
      if (personaRes._tag !== "Success") return;
      setPersonaNames(new Map(personaRes.value.items.map((persona) => [persona.id, persona.name])));
    });
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads live server memories when filters change
  useEffect(() => {
    reload();
  }, [reload]);

  const runSearch = (value: string) => {
    const trimmed = value.trim();
    if (trimmed === "") {
      setSearchTrace(null);
      reload();
      return;
    }
    void searchMemCmd({
      environmentId,
      input: {
        projectId: project.id,
        query: trimmed,
        ...(workspace?.lead ? { botThreadId: workspace.lead.id } : {}),
      },
    }).then((res) => {
      if (res._tag !== "Success") {
        if (!isAtomCommandInterrupted(res)) {
          const cause = squashAtomCommandFailure(res);
          setError(cause instanceof Error ? cause.message : gt("Memory search failed."));
        }
        return;
      }
      setError(null);
      setItems(res.value.items);
      const trace = res.value.trace;
      setSearchTrace(trace === undefined ? null : { gate: trace.gate, shown: trace.shown.length });
    });
  };

  const resolveReview = async (id: string, action: "keep_old" | "use_new" | "keep_both") => {
    if (busy) return;
    setBusy(true);
    const res = await reviewCmd({ environmentId, input: { id, action } });
    setBusy(false);
    if (res._tag === "Success") reload();
    else if (!isAtomCommandInterrupted(res)) {
      const cause = squashAtomCommandFailure(res);
      setError(cause instanceof Error ? cause.message : gt("Could not resolve this memory."));
    }
  };

  const undoMemory = async (id: string) => {
    if (busy) return;
    setBusy(true);
    const res = await undoCmd({ environmentId, input: { id } });
    setBusy(false);
    if (res._tag === "Success") reload();
  };

  const forgetMemory = async (id: string) => {
    if (busy) return;
    setBusy(true);
    const res = await removeCmd({ environmentId, input: { id } });
    setBusy(false);
    if (res._tag === "Success") reload();
    else if (!isAtomCommandInterrupted(res)) {
      const cause = squashAtomCommandFailure(res);
      setError(cause instanceof Error ? cause.message : gt("Could not forget this memory."));
    }
  };

  const moveScope = async (
    item: DropwaveMemoryItem,
    scope: DropwaveMemoryScope,
    personaId?: string | null,
  ) => {
    if (
      busy ||
      (item.scope === scope && (scope !== "bot" || item.personaId === (personaId ?? null)))
    )
      return;
    setBusy(true);
    const res = await scopeCmd({
      environmentId,
      input: {
        id: item.id,
        scope,
        ...(scope === "project" ? { projectId: project.id } : {}),
        ...(scope === "bot" ? { personaId: personaId ?? null } : {}),
      },
    });
    setBusy(false);
    if (res._tag === "Success") reload();
  };

  const loadTraces = () => {
    const threadId = workspace?.lead?.id;
    if (threadId === undefined) return;
    void tracesCmd({ environmentId, input: { threadId, limit: 10 } }).then((res) => {
      if (res._tag === "Success") setTraces(res.value.traces);
    });
  };

  const toggleTraces = () => {
    const next = !tracesOpen;
    setTracesOpen(next);
    if (next) loadTraces();
  };

  const visible = items.filter(
    (item) =>
      (kindFilter === "all" || item.kind === kindFilter) &&
      (tierFilter === "all" || item.tier === tierFilter) &&
      (statusFilter === "all" ||
        item.status === statusFilter ||
        (statusFilter === "active" && item.status === "needs_review")),
  );

  const reviewItems = visible.filter((item) => item.status === "needs_review");
  const groups = (() => {
    const map = new Map<string, { label: string; items: DropwaveMemoryItem[] }>();
    for (const item of visible) {
      if (item.status === "needs_review") continue;
      const key =
        item.scope === "owner"
          ? "you"
          : item.scope === "project"
            ? "project"
            : `bot:${item.personaId ?? ""}`;
      const label =
        key === "you"
          ? gt("You")
          : key === "project"
            ? gt("This project")
            : item.personaId !== null
              ? (personaNames.get(item.personaId) ?? gt("A bot"))
              : gt("Bots");
      const group = map.get(key) ?? { label, items: [] };
      group.items.push(item);
      map.set(key, group);
    }
    const order = ["you", "project"];
    return [...map.entries()].sort(([a], [b]) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.localeCompare(b);
    });
  })();

  const scopeOptionsFor = (): ReadonlyArray<DropwaveSelectOption<string>> => [
    { value: "owner", label: gt("Everywhere") },
    { value: "project", label: gt("This project") },
    ...[...personaNames.entries()].map(([id, name]) => ({
      value: `bot:${id}`,
      label: name,
    })),
  ];

  const scopeValueFor = (item: DropwaveMemoryItem): string =>
    item.scope === "bot" ? `bot:${item.personaId ?? ""}` : item.scope;

  const onScopeChange = (item: DropwaveMemoryItem, value: string) => {
    if (value.startsWith("bot:")) {
      const personaId = value.slice(4);
      void moveScope(item, "bot", personaId === "" ? null : personaId);
    } else {
      void moveScope(item, value as DropwaveMemoryScope);
    }
  };

  const openInChat = (item: DropwaveMemoryItem) => {
    const threadId = item.botThreadId ?? workspace?.lead?.id;
    if (threadId === null || threadId === undefined || workspace === null) return;
    workspace.openThread(scopeThreadRef(environmentId, threadId));
  };

  const leadName = workspace?.lead?.title ?? gt("your lead");

  return (
    <div data-dropwave-memory-view="">
      <header data-dropwave-memory-header="">
        <div>
          <h2>
            <T>Memory</T>
          </h2>
          <p>
            {gt(
              "What {name} and the crew remember across projects. Owner memories follow you everywhere; project memories stay here.",
              { name: leadName },
            )}
          </p>
        </div>
        <button
          type="button"
          data-dropwave-header-button=""
          onClick={toggleTraces}
          aria-expanded={tracesOpen}
        >
          <BrainIcon />
          {gt("Why did {name} remember this?", { name: leadName })}
          <ChevronDownIcon data-open={tracesOpen ? "" : undefined} />
        </button>
      </header>

      {tracesOpen ? (
        <section data-dropwave-memory-traces="">
          <h3>
            <T>Recent recall</T>
          </h3>
          {traces.length === 0 ? (
            <p>
              <T>No recall runs recorded for this thread yet.</T>
            </p>
          ) : (
            <ul>
              {traces.map((entry) => {
                const trace = asTrace(entry.trace);
                return (
                  <li key={entry.id}>
                    <div data-dropwave-memory-trace-head="">
                      <code>{entry.turnKey}</code>
                      <span>
                        {trace.gate ?? "?"}
                        {trace.vectors === true ? ` · ${gt("vectors")}` : ""}
                        {typeof trace.timing?.totalMs === "number"
                          ? ` · ${gt("{ms} ms", { ms: Math.round(trace.timing.totalMs) })}`
                          : ""}
                      </span>
                    </div>
                    {(trace.shown ?? []).map((shown) => (
                      <div key={shown.id} data-dropwave-memory-trace-row="">
                        <span>{shown.id}</span>
                        <span>
                          {typeof shown.score === "number" ? shown.score.toFixed(2) : ""}
                          {shown.via ? ` · ${shown.via}` : ""}
                        </span>
                      </div>
                    ))}
                    {(trace.drops ?? []).length > 0 ? (
                      <div data-dropwave-memory-trace-drops="">
                        {(trace.drops ?? []).map((drop) => (
                          <span key={drop.id}>
                            {drop.id}: {drop.reason}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      <div data-dropwave-memory-filters="">
        <label data-dropwave-docs-search="">
          <SearchIcon aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              runSearch(event.currentTarget.value);
            }}
            placeholder={gt("Search memory (semantic recall)…")}
          />
        </label>
        <DropwaveSelect
          value={kindFilter}
          options={KIND_OPTIONS}
          ariaLabel={gt("Filter by kind")}
          onChange={setKindFilter}
        />
        <DropwaveSelect
          value={tierFilter}
          options={TIER_OPTIONS}
          ariaLabel={gt("Filter by tier")}
          onChange={setTierFilter}
        />
        <DropwaveSelect
          value={statusFilter}
          options={STATUS_OPTIONS}
          ariaLabel={gt("Filter by status")}
          onChange={setStatusFilter}
        />
      </div>
      {searchTrace !== null ? (
        <p data-dropwave-memory-search-note="">
          {searchTrace.gate === "hit"
            ? gt("Recall found {count} memories.", { count: searchTrace.shown })
            : gt("Nothing matched. The recall gate stayed quiet.")}
        </p>
      ) : null}
      {error !== null ? <p data-dropwave-memory-error="">{error}</p> : null}

      {reviewItems.length > 0 ? (
        <section data-dropwave-memory-review="">
          <h3>
            <T>Needs your call</T>
          </h3>
          <ul>
            {reviewItems.map((item) => (
              <li key={item.id} data-dropwave-memory-review-card="">
                <div>
                  <span data-dropwave-doc-pill="">{item.kind}</span>
                  <p>{item.text}</p>
                  {item.conflict !== undefined ? (
                    <p data-dropwave-memory-conflict="">
                      <T>Conflicts with:</T> “{item.conflict.candidate}”. {item.conflict.reason}
                    </p>
                  ) : null}
                </div>
                <div data-dropwave-memory-review-actions="">
                  <button
                    type="button"
                    data-dropwave-header-button=""
                    disabled={busy}
                    onClick={() => void resolveReview(item.id, "keep_old")}
                  >
                    <T>Keep old</T>
                  </button>
                  <button
                    type="button"
                    data-dropwave-header-button=""
                    disabled={busy}
                    onClick={() => void resolveReview(item.id, "use_new")}
                  >
                    <T>Use new</T>
                  </button>
                  <button
                    type="button"
                    data-dropwave-header-button=""
                    disabled={busy}
                    onClick={() => void resolveReview(item.id, "keep_both")}
                  >
                    <T>Keep both</T>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {groups.map(([key, group]) => (
        <section key={key} data-dropwave-memory-group="">
          <h3>{group.label}</h3>
          <ul>
            {group.items.map((item) => (
              <li key={item.id} data-dropwave-memory-card="">
                <div data-dropwave-memory-card-head="">
                  <span data-dropwave-doc-pill="">{item.kind}</span>
                  {item.tier !== "semantic" ? (
                    <span data-dropwave-doc-pill="">{item.tier}</span>
                  ) : null}
                  {item.status !== "active" ? (
                    <span data-dropwave-doc-pill="">{item.status}</span>
                  ) : null}
                  <DropwaveSelect
                    value={scopeValueFor(item)}
                    options={scopeOptionsFor()}
                    ariaLabel={gt("Move memory scope")}
                    onChange={(value) => onScopeChange(item, value)}
                  />
                  {item.status === "active" || item.status === "needs_review" ? (
                    <button
                      type="button"
                      data-dropwave-icon-button=""
                      aria-label={gt("Forget this memory")}
                      disabled={busy}
                      onClick={() => void forgetMemory(item.id)}
                    >
                      <Trash2Icon />
                    </button>
                  ) : null}
                </div>
                {item.subject !== "" ? <strong>{item.subject}</strong> : null}
                <p>{item.text}</p>
                {item.tags.length > 0 ? (
                  <div data-dropwave-memory-tags="">
                    {item.tags.map((tag) => (
                      <span key={tag} data-dropwave-doc-pill="">
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                {item.quote !== undefined && item.quote !== "" ? (
                  <p data-dropwave-memory-quote="">
                    “{item.quote}”
                    {item.botThreadId !== null ? (
                      <button
                        type="button"
                        data-dropwave-memory-open-chat=""
                        onClick={() => openInChat(item)}
                      >
                        <ExternalLinkIcon />
                        <T>Open in chat</T>
                      </button>
                    ) : null}
                  </p>
                ) : null}
                {item.journal.length > 0 ? (
                  <div data-dropwave-memory-journal="">
                    <span>
                      {gt("{count} changes", { count: item.journal.length })} ·{" "}
                      {item.journal[item.journal.length - 1]?.by ?? ""}
                    </span>
                    <button
                      type="button"
                      data-dropwave-icon-button=""
                      aria-label={gt("Undo last change")}
                      disabled={busy}
                      onClick={() => void undoMemory(item.id)}
                    >
                      <Undo2Icon />
                    </button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {visible.length === 0 && reviewItems.length === 0 ? (
        <div data-dropwave-panel-empty="">
          <BrainIcon />
          <p>
            {gt(
              "Nothing remembered yet. Tell {name} “always do this” or “remember that…”, and it will show up here.",
              { name: leadName },
            )}
          </p>
        </div>
      ) : null}
    </div>
  );
}
