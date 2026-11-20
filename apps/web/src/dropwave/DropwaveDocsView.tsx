import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type DropwaveDoc,
  type DropwaveDocKind,
  type DropwaveDocSummary,
  type DropwaveMemoryItem,
  type DropwaveMemoryKind,
} from "@t3tools/contracts";
import { T, Var, useGT } from "gt-react";
import {
  ArrowLeftIcon,
  BrainIcon,
  FileTextIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { requestConfirmDialog } from "../confirmDialog";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { formatShortAge } from "./model";
import { useDropwaveWorkspace } from "./workspaceContext";

type DocsTab = "docs" | "memory";

function renderMarkdownBlocks(content: string) {
  let offset = 0;
  const blocks = content.split(/\r?\n/).map((line) => {
    const id = `md-${offset}-${line.slice(0, 16)}`;
    offset += line.length + 1;
    return { id, line };
  });
  return blocks.map(({ id, line }) => {
    if (line.startsWith("### ")) {
      return (
        <h4 key={id} data-dropwave-md-h3="">
          {line.slice(4)}
        </h4>
      );
    }
    if (line.startsWith("## ")) {
      return (
        <h3 key={id} data-dropwave-md-h2="">
          {line.slice(3)}
        </h3>
      );
    }
    if (line.startsWith("# ")) {
      return (
        <h2 key={id} data-dropwave-md-h1="">
          {line.slice(2)}
        </h2>
      );
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      return (
        <div key={id} data-dropwave-md-li="">
          <span aria-hidden="true">·</span>
          <span>{line.replace(/^\s*[-*•]\s+/, "")}</span>
        </div>
      );
    }
    if (!line.trim()) {
      return <div key={id} data-dropwave-md-gap="" />;
    }
    return (
      <p key={id} data-dropwave-md-p="">
        {line}
      </p>
    );
  });
}

export function DropwaveDocsView() {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const project = workspace?.project ?? null;
  const [tab, setTab] = useState<DocsTab>("docs");
  const [query, setQuery] = useState("");
  const [docs, setDocs] = useState<ReadonlyArray<DropwaveDocSummary>>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openDoc, setOpenDoc] = useState<DropwaveDoc | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftKind, setDraftKind] = useState<DropwaveDocKind>("note");
  const [draftContent, setDraftContent] = useState("");
  const [creatingNew, setCreatingNew] = useState(false);

  const [memories, setMemories] = useState<ReadonlyArray<DropwaveMemoryItem>>([]);
  const [newMemoryText, setNewMemoryText] = useState("");
  const [newMemoryKind, setNewMemoryKind] = useState<DropwaveMemoryKind>("rule");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listDocsCmd = useAtomCommand(serverEnvironment.dropwaveDocsList, { reportFailure: false });
  const readDocCmd = useAtomCommand(serverEnvironment.dropwaveDocRead, { reportFailure: false });
  const writeDocCmd = useAtomCommand(serverEnvironment.dropwaveDocWrite, { reportFailure: false });
  const deleteDocCmd = useAtomCommand(serverEnvironment.dropwaveDocDelete, {
    reportFailure: false,
  });
  const listMemCmd = useAtomCommand(serverEnvironment.dropwaveMemoryList, { reportFailure: false });
  const saveMemCmd = useAtomCommand(serverEnvironment.dropwaveMemorySave, { reportFailure: false });
  const removeMemCmd = useAtomCommand(serverEnvironment.dropwaveMemoryRemove, {
    reportFailure: false,
  });

  const [reloadNonce, setReloadNonce] = useState(0);
  const triggerReload = () => setReloadNonce((n) => n + 1);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- fetches server docs or memory list when project, tab, query, or mutation nonce changes
  useEffect(() => {
    if (!project || reloadNonce < 0) return;
    let cancelled = false;
    if (tab === "docs") {
      void listDocsCmd({
        environmentId: project.environmentId,
        input: { projectId: project.id },
      }).then((res) => {
        if (cancelled) return;
        if (res._tag === "Success") {
          setError(null);
          setDocs(res.value.docs);
          setSelectedPath((prev) =>
            prev && res.value.docs.some((doc) => doc.path === prev)
              ? prev
              : (res.value.docs[0]?.path ?? null),
          );
        } else if (!isAtomCommandInterrupted(res)) {
          const cause = squashAtomCommandFailure(res);
          setError(cause instanceof Error ? cause.message : gt("Could not load docs."));
        }
      });
    } else {
      void listMemCmd({
        environmentId: project.environmentId,
        input: { projectId: project.id, ...(query.trim() ? { query: query.trim() } : {}) },
      }).then((res) => {
        if (cancelled) return;
        if (res._tag === "Success") {
          setError(null);
          setMemories(res.value.items);
        } else if (!isAtomCommandInterrupted(res)) {
          const cause = squashAtomCommandFailure(res);
          setError(cause instanceof Error ? cause.message : gt("Could not load memory."));
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [gt, listDocsCmd, listMemCmd, project, query, reloadNonce, tab]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads selected markdown document content from server
  useEffect(() => {
    if (!project || !selectedPath || creatingNew) {
      return;
    }
    let cancelled = false;
    void readDocCmd({
      environmentId: project.environmentId,
      input: { projectId: project.id, path: selectedPath },
    }).then((res) => {
      if (cancelled) return;
      if (res._tag === "Success") {
        setOpenDoc(res.value.doc);
        setDraftTitle(res.value.doc.title);
        setDraftKind(res.value.doc.kind);
        setDraftContent(res.value.doc.content);
        setEditing(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [creatingNew, project, readDocCmd, selectedPath]);

  const activeDoc = creatingNew || !selectedPath ? null : openDoc;

  if (!workspace || !project) return null;

  const filteredDocs = query.trim()
    ? docs.filter(
        (doc) =>
          doc.title.toLowerCase().includes(query.trim().toLowerCase()) ||
          doc.excerpt.toLowerCase().includes(query.trim().toLowerCase()) ||
          doc.path.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : docs;

  const startNewDoc = () => {
    setCreatingNew(true);
    setEditing(true);
    setSelectedPath(null);
    setOpenDoc(null);
    setDraftTitle("");
    setDraftKind("note");
    setDraftContent("");
  };

  const saveDoc = async () => {
    if (busy || !draftTitle.trim()) return;
    setBusy(true);
    setError(null);
    const res = await writeDocCmd({
      environmentId: project.environmentId,
      input: {
        projectId: project.id,
        ...(creatingNew ? {} : openDoc ? { path: openDoc.path } : {}),
        title: draftTitle.trim(),
        kind: draftKind,
        content: draftContent,
      },
    });
    setBusy(false);
    if (res._tag === "Success") {
      setCreatingNew(false);
      setEditing(false);
      setOpenDoc(res.value.doc);
      setSelectedPath(res.value.doc.path);
      triggerReload();
    } else if (!isAtomCommandInterrupted(res)) {
      const cause = squashAtomCommandFailure(res);
      setError(cause instanceof Error ? cause.message : gt("Could not save document."));
    }
  };

  const deleteCurrentDoc = async () => {
    if (!activeDoc || busy) return;
    if (!(await requestConfirmDialog(gt("Delete this document?")))) return;
    setBusy(true);
    const res = await deleteDocCmd({
      environmentId: project.environmentId,
      input: { projectId: project.id, path: activeDoc.path },
    });
    setBusy(false);
    if (res._tag === "Success") {
      setOpenDoc(null);
      setSelectedPath(null);
      triggerReload();
    } else if (!isAtomCommandInterrupted(res)) {
      const cause = squashAtomCommandFailure(res);
      setError(cause instanceof Error ? cause.message : gt("Could not delete document."));
    }
  };

  const addMemory = async () => {
    if (!newMemoryText.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await saveMemCmd({
      environmentId: project.environmentId,
      input: {
        projectId: project.id,
        botThreadId: workspace.lead?.id ?? null,
        kind: newMemoryKind,
        text: newMemoryText.trim(),
        confidence: "confirmed",
      },
    });
    setBusy(false);
    if (res._tag === "Success") {
      setNewMemoryText("");
      triggerReload();
    } else if (!isAtomCommandInterrupted(res)) {
      const cause = squashAtomCommandFailure(res);
      setError(cause instanceof Error ? cause.message : gt("Could not save memory."));
    }
  };

  const removeMemory = async (id: string) => {
    if (busy) return;
    setBusy(true);
    const res = await removeMemCmd({
      environmentId: project.environmentId,
      input: { id },
    });
    setBusy(false);
    if (res._tag === "Success") triggerReload();
  };

  const canDeleteOpenDoc = activeDoc?.path.startsWith(".dropwave/docs/") ?? false;

  return (
    <section data-dropwave-docs="" aria-label={gt("Project docs and memory")}>
      <aside data-dropwave-docs-rail="">
        <button
          type="button"
          data-dropwave-back-chat=""
          onClick={() => workspace.setMainView("chat")}
        >
          <ArrowLeftIcon />
          <T>Back to chat</T>
        </button>

        <div data-dropwave-docs-tabs="" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "docs"}
            onClick={() => setTab("docs")}
          >
            <FileTextIcon />
            <T>Docs</T>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "memory"}
            onClick={() => setTab("memory")}
          >
            <BrainIcon />
            <T>Memory</T>
          </button>
        </div>

        <label data-dropwave-docs-search="">
          <SearchIcon aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder={tab === "docs" ? gt("Filter docs…") : gt("Search memory…")}
          />
        </label>

        {tab === "docs" ? (
          <>
            <div data-dropwave-docs-heading="">
              <span>
                <T>
                  <Var>{project.title}</Var> docs
                </T>
              </span>
              <button
                type="button"
                data-dropwave-small-button=""
                onClick={startNewDoc}
                aria-label={gt("New doc")}
              >
                <PlusIcon />
              </button>
            </div>
            <ul data-dropwave-docs-list="">
              {filteredDocs.map((doc) => (
                <li key={doc.path}>
                  <button
                    type="button"
                    aria-current={!creatingNew && selectedPath === doc.path ? "true" : undefined}
                    onClick={() => {
                      setCreatingNew(false);
                      setSelectedPath(doc.path);
                    }}
                  >
                    <strong>{doc.title}</strong>
                    <small>
                      {doc.kind} · {formatShortAge(doc.updatedAt)}
                    </small>
                  </button>
                </li>
              ))}
              {filteredDocs.length === 0 ? (
                <li data-dropwave-docs-empty="">
                  <T>No docs yet. Create one or ask your lead bot to write a brief.</T>
                </li>
              ) : null}
            </ul>
          </>
        ) : (
          <div data-dropwave-docs-heading="">
            <span>
              <T>
                <Var>{project.title}</Var> memory (<Var>{memories.length}</Var>)
              </T>
            </span>
          </div>
        )}
      </aside>

      <div data-dropwave-docs-main="">
        {error ? (
          <p data-dropwave-form-error="" role="alert">
            {error}
          </p>
        ) : null}

        {tab === "docs" ? (
          editing || creatingNew ? (
            <div data-dropwave-doc-editor="">
              <div data-dropwave-doc-bar="">
                <input
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.currentTarget.value)}
                  placeholder={gt("Document title")}
                  aria-label={gt("Document title")}
                />
                <select
                  value={draftKind}
                  onChange={(event) => setDraftKind(event.currentTarget.value as DropwaveDocKind)}
                  aria-label={gt("Document kind")}
                >
                  <option value="brief">{gt("Brief")}</option>
                  <option value="spec">{gt("Spec")}</option>
                  <option value="note">{gt("Note")}</option>
                  <option value="loop">{gt("Core loop")}</option>
                  <option value="memory">{gt("Memory")}</option>
                </select>
                <button
                  type="button"
                  data-dropwave-header-button=""
                  onClick={() => {
                    setCreatingNew(false);
                    setEditing(false);
                  }}
                >
                  <T>Cancel</T>
                </button>
                <button
                  type="button"
                  data-dropwave-primary-button=""
                  disabled={busy || !draftTitle.trim()}
                  onClick={() => void saveDoc()}
                >
                  <SaveIcon />
                  <T>Save</T>
                </button>
              </div>
              <textarea
                value={draftContent}
                onChange={(event) => setDraftContent(event.currentTarget.value)}
                placeholder={gt("Write briefs, specs, decisions, or notes in Markdown…")}
              />
            </div>
          ) : activeDoc ? (
            <article data-dropwave-doc-reader="">
              <header data-dropwave-doc-reader-header="">
                <div>
                  <span data-dropwave-doc-pill="">{activeDoc.kind}</span>
                  <span data-dropwave-doc-path="">{activeDoc.path}</span>
                </div>
                <div data-dropwave-doc-actions="">
                  <button
                    type="button"
                    data-dropwave-header-button=""
                    onClick={() => setEditing(true)}
                  >
                    <PencilIcon />
                    <T>Edit</T>
                  </button>
                  {canDeleteOpenDoc ? (
                    <button
                      type="button"
                      data-dropwave-icon-button=""
                      aria-label={gt("Delete document")}
                      onClick={() => void deleteCurrentDoc()}
                    >
                      <Trash2Icon />
                    </button>
                  ) : null}
                </div>
              </header>
              <div data-dropwave-doc-body="">{renderMarkdownBlocks(activeDoc.content)}</div>
            </article>
          ) : (
            <div data-dropwave-panel-empty="">
              <FileTextIcon />
              <p>
                <T>Keep briefs, specs, and project notes here, readable by you and every bot.</T>
              </p>
              <button type="button" data-dropwave-primary-button="" onClick={startNewDoc}>
                <PlusIcon />
                <T>New doc</T>
              </button>
            </div>
          )
        ) : (
          <div data-dropwave-memory-view="">
            <header>
              <h2>
                <T>Learned memory & standing rules</T>
              </h2>
              <p>
                <T>
                  Injected automatically before every turn for this project only. Bots never mix
                  memory across projects.
                </T>
              </p>
            </header>
            <form
              data-dropwave-memory-form=""
              onSubmit={(event) => {
                event.preventDefault();
                void addMemory();
              }}
            >
              <select
                value={newMemoryKind}
                onChange={(event) =>
                  setNewMemoryKind(event.currentTarget.value as DropwaveMemoryKind)
                }
                aria-label={gt("Memory kind")}
              >
                <option value="rule">{gt("Rule")}</option>
                <option value="preference">{gt("Preference")}</option>
                <option value="decision">{gt("Decision")}</option>
                <option value="fact">{gt("Fact")}</option>
                <option value="lesson">{gt("Lesson")}</option>
              </select>
              <input
                value={newMemoryText}
                onChange={(event) => setNewMemoryText(event.currentTarget.value)}
                placeholder={gt("Add a fact, rule, or preference for this project…")}
              />
              <button
                type="submit"
                data-dropwave-primary-button=""
                disabled={busy || !newMemoryText.trim()}
              >
                <PlusIcon />
                <T>Save</T>
              </button>
            </form>
            <ul data-dropwave-memory-list="">
              {memories.map((item) => (
                <li key={item.id}>
                  <div>
                    <span data-dropwave-doc-pill="">{item.kind}</span>
                    <p>{item.text}</p>
                    {item.quote ? <small>“{item.quote}”</small> : null}
                  </div>
                  <button
                    type="button"
                    data-dropwave-icon-button=""
                    aria-label={gt("Remove memory")}
                    onClick={() => void removeMemory(item.id)}
                  >
                    <Trash2Icon />
                  </button>
                </li>
              ))}
              {memories.length === 0 ? (
                <li data-dropwave-docs-empty="">
                  <T>
                    No project memories yet. Answer asks with “Always do this” or add rules above.
                  </T>
                </li>
              ) : null}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
