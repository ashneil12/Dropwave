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
import { Suspense, lazy, useEffect, useRef, useState } from "react";

import { requestConfirmDialog } from "../confirmDialog";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { serverEnvironment } from "../state/server";
import { useAtomCommand } from "../state/use-atom-command";
import { DropwaveMarkdown } from "./DropwaveMarkdown";
import { DropwaveSelect, type DropwaveSelectOption } from "./DropwaveSelect";
import { formatShortAge } from "./model";
import { useDropwaveWorkspace } from "./workspaceContext";

const DropwaveBlockNoteEditor = lazy(() => import("./DropwaveBlockNoteEditor"));

type DocsTab = "docs" | "memory";

export function DropwaveDocsView({
  initialDocPath,
  initialTab,
}: {
  initialDocPath?: string | null;
  initialTab?: DocsTab;
} = {}) {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const project = workspace?.project ?? null;
  const [tab, setTab] = useState<DocsTab>(initialTab ?? "docs");
  const [query, setQuery] = useState("");
  const [docs, setDocs] = useState<ReadonlyArray<DropwaveDocSummary>>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(initialDocPath ?? null);
  const [openDoc, setOpenDoc] = useState<DropwaveDoc | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftKind, setDraftKind] = useState<DropwaveDocKind>("note");
  const [draftContent, setDraftContent] = useState("");
  const [creatingNew, setCreatingNew] = useState(false);

  const [memories, setMemories] = useState<ReadonlyArray<DropwaveMemoryItem>>([]);
  const [personaNames, setPersonaNames] = useState<ReadonlyMap<string, string>>(new Map());
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
  const setScopeCmd = useAtomCommand(serverEnvironment.dropwaveMemorySetScope, {
    reportFailure: false,
  });
  const listPersonasCmd = useAtomCommand(serverEnvironment.dropwavePersonaList, {
    reportFailure: false,
  });

  const [reloadNonce, setReloadNonce] = useState(0);
  const triggerReload = () => setReloadNonce((n) => n + 1);
  const autosavedRef = useRef({ key: "", title: "", kind: "", content: "" });
  // Touch-narrow screens read first; everything else edits in place.
  const narrowViewport = useMediaQuery("(max-width: 640px), (pointer: coarse)");
  const narrowRef = useRef(narrowViewport);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the latest viewport flag for async doc callbacks that outlive the render closure
  useEffect(() => {
    narrowRef.current = narrowViewport;
  }, [narrowViewport]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads live server docs or memories
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
          const onlyDocs = res.value.docs.filter(
            (doc) => doc.kind !== "hub" && !doc.path.startsWith(".dropwave/hubs/"),
          );
          setDocs(onlyDocs);
          setSelectedPath((prev) =>
            prev && onlyDocs.some((doc) => doc.path === prev) ? prev : (onlyDocs[0]?.path ?? null),
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
          void listPersonasCmd({ environmentId: project.environmentId, input: {} }).then(
            (personaRes) => {
              if (cancelled || personaRes._tag !== "Success") return;
              setPersonaNames(
                new Map(personaRes.value.items.map((persona) => [persona.id, persona.name])),
              );
            },
          );
        } else if (!isAtomCommandInterrupted(res)) {
          const cause = squashAtomCommandFailure(res);
          setError(cause instanceof Error ? cause.message : gt("Could not load memory."));
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [gt, listDocsCmd, listMemCmd, listPersonasCmd, project, query, reloadNonce, tab]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads selected markdown document content
  useEffect(() => {
    if (!project || !selectedPath || creatingNew) return;
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
        autosavedRef.current = {
          key: res.value.doc.path,
          title: res.value.doc.title,
          kind: res.value.doc.kind,
          content: res.value.doc.content,
        };
        setEditing(!narrowRef.current);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [autosavedRef, creatingNew, project, readDocCmd, selectedPath]);

  const saveDoc = async (quiet = false) => {
    if (!project || busy || !draftTitle.trim()) return;
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
      if (!quiet) {
        setCreatingNew(false);
        setEditing(!narrowRef.current);
      }
      setOpenDoc(res.value.doc);
      setSelectedPath(res.value.doc.path);
      triggerReload();
      workspace?.refreshOpenAsksCount();
    } else if (!isAtomCommandInterrupted(res)) {
      const cause = squashAtomCommandFailure(res);
      setError(cause instanceof Error ? cause.message : gt("Could not save document."));
    }
  };

  const saveDocRef = useRef(saveDoc);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the latest saveDoc reachable from the autosave timer
  useEffect(() => {
    saveDocRef.current = saveDoc;
  });

  // Debounced autosave while editing an existing doc; Save remains the explicit path for new docs.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the on-disk doc in step with draft edits after a 900ms idle timer
  useEffect(() => {
    if (!editing || creatingNew || !openDoc) return;
    const timer = window.setTimeout(() => {
      const saved = autosavedRef.current;
      if (
        saved.key === openDoc.path &&
        saved.title === draftTitle &&
        saved.kind === draftKind &&
        saved.content === draftContent
      ) {
        return;
      }
      autosavedRef.current = {
        key: openDoc.path,
        title: draftTitle,
        kind: draftKind,
        content: draftContent,
      };
      void saveDocRef.current(true);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [
    autosavedRef,
    creatingNew,
    draftContent,
    draftKind,
    draftTitle,
    editing,
    openDoc,
    saveDocRef,
  ]);

  if (!workspace || !project) {
    return (
      <div data-dropwave-panel-empty="">
        <FileTextIcon />
        <p>
          <T>Link a project folder to view and edit shared Docs & Memory.</T>
        </p>
      </div>
    );
  }

  const activeDocView = creatingNew || !selectedPath ? null : openDoc;
  // Wide pointers edit in place: a selected doc always shows the editor, so a
  // stale `editing=false` (e.g. re-clicking the open doc) can never strand the
  // reader on desktop. Narrow/coarse keeps read-first with an Edit button.
  const showEditor = editing || creatingNew || (activeDocView !== null && !narrowViewport);
  const filteredDocs = query.trim()
    ? docs.filter(
        (doc) =>
          doc.title.toLowerCase().includes(query.trim().toLowerCase()) ||
          doc.excerpt.toLowerCase().includes(query.trim().toLowerCase()) ||
          doc.path.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : docs;

  const docKindOptions: ReadonlyArray<DropwaveSelectOption<DropwaveDocKind>> = [
    { value: "brief", label: gt("Brief") },
    { value: "spec", label: gt("Spec") },
    { value: "note", label: gt("Note") },
    { value: "loop", label: gt("Core loop") },
    { value: "memory", label: gt("Memory") },
  ];
  const memoryKindOptions: ReadonlyArray<DropwaveSelectOption<DropwaveMemoryKind>> = [
    { value: "rule", label: gt("Rule") },
    { value: "preference", label: gt("Preference") },
    { value: "decision", label: gt("Decision") },
    { value: "fact", label: gt("Fact") },
    { value: "lesson", label: gt("Lesson") },
  ];

  const startNewDoc = () => {
    setCreatingNew(true);
    setEditing(true);
    setSelectedPath(null);
    setOpenDoc(null);
    setDraftTitle(gt("Untitled"));
    setDraftKind("note");
    setDraftContent("");
  };

  const beginEdit = () => {
    if (!activeDocView) return;
    setDraftTitle(activeDocView.title);
    setDraftKind(activeDocView.kind);
    setDraftContent(activeDocView.content);
    setEditing(true);
  };

  const deleteCurrentDoc = async () => {
    if (!openDoc || busy) return;
    if (!(await requestConfirmDialog(gt("Delete this document?")))) return;
    setBusy(true);
    const res = await deleteDocCmd({
      environmentId: project.environmentId,
      input: { projectId: project.id, path: openDoc.path },
    });
    setBusy(false);
    if (res._tag === "Success") {
      setOpenDoc(null);
      setSelectedPath(null);
      triggerReload();
      workspace.refreshOpenAsksCount();
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
      workspace.refreshOpenAsksCount();
    } else if (!isAtomCommandInterrupted(res)) {
      const cause = squashAtomCommandFailure(res);
      setError(cause instanceof Error ? cause.message : gt("Could not save memory."));
    }
  };

  const toggleMemoryScope = async (item: DropwaveMemoryItem) => {
    if (busy) return;
    setBusy(true);
    const res = await setScopeCmd({
      environmentId: project.environmentId,
      input: { id: item.id, scope: item.scope === "global" ? "project" : "global" },
    });
    setBusy(false);
    if (res._tag === "Success") triggerReload();
  };

  const removeMemory = async (id: string) => {
    if (busy) return;
    setBusy(true);
    const res = await removeMemCmd({
      environmentId: project.environmentId,
      input: { id },
    });
    setBusy(false);
    if (res._tag === "Success") {
      triggerReload();
      workspace.refreshOpenAsksCount();
    }
  };

  const canDeleteOpenDoc = activeDocView?.path.startsWith(".dropwave/docs/") ?? false;

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
                    aria-current={
                      !creatingNew && (selectedPath ?? filteredDocs[0]?.path) === doc.path
                        ? "true"
                        : undefined
                    }
                    onClick={() => {
                      setCreatingNew(false);
                      setEditing(false);
                      setSelectedPath(doc.path);
                    }}
                  >
                    <strong>{doc.title}</strong>
                    <small>
                      <span data-dropwave-doc-pill="">{doc.kind}</span>{" "}
                      {formatShortAge(doc.updatedAt)}
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
          showEditor ? (
            <div data-dropwave-doc-editor="editorial">
              <div data-dropwave-doc-bar="">
                <DropwaveSelect
                  value={draftKind}
                  options={docKindOptions}
                  ariaLabel={gt("Document kind")}
                  compact
                  onChange={setDraftKind}
                />
                <div data-dropwave-doc-actions="">
                  {creatingNew ? (
                    <>
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
                    </>
                  ) : narrowViewport ? (
                    <button
                      type="button"
                      data-dropwave-header-button=""
                      onClick={() => setEditing(false)}
                    >
                      <T>Done</T>
                    </button>
                  ) : null}
                </div>
              </div>
              <input
                data-dropwave-editorial-title=""
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.currentTarget.value)}
                onFocus={(event) => event.currentTarget.select()}
                placeholder={gt("Untitled")}
                aria-label={gt("Document title")}
                autoFocus={creatingNew}
              />
              <Suspense
                fallback={
                  <div data-dropwave-editorial-body="" data-dw-blocknote-loading="">
                    <T>Loading editor…</T>
                  </div>
                }
              >
                <DropwaveBlockNoteEditor
                  key={creatingNew ? "new" : (openDoc?.path ?? "draft")}
                  markdown={draftContent}
                  onChange={setDraftContent}
                />
              </Suspense>
            </div>
          ) : activeDocView ? (
            <article data-dropwave-doc-reader="">
              <header data-dropwave-doc-reader-header="">
                <div>
                  <span data-dropwave-doc-pill="">{activeDocView.kind}</span>
                  <span data-dropwave-doc-path="">{activeDocView.path}</span>
                </div>
                <div data-dropwave-doc-actions="">
                  <button type="button" data-dropwave-header-button="" onClick={beginEdit}>
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
              <div data-dropwave-doc-body="">
                <DropwaveMarkdown text={activeDocView.content} />
              </div>
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
                  Injected automatically before every turn. Global memories are shared with every
                  bot in every project; project memories stay here.
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
              <DropwaveSelect
                value={newMemoryKind}
                options={memoryKindOptions}
                ariaLabel={gt("Memory kind")}
                onChange={setNewMemoryKind}
              />
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
                    <button
                      type="button"
                      data-dropwave-doc-pill=""
                      onClick={() => void toggleMemoryScope(item)}
                    >
                      {item.scope === "global" ? gt("Everywhere") : gt("This project")}
                    </button>
                    {item.scope === "global" ? (
                      <span data-dropwave-doc-pill="">
                        {item.personaId === null
                          ? gt("About you")
                          : (personaNames.get(item.personaId) ?? gt("Bot"))}
                      </span>
                    ) : null}
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
