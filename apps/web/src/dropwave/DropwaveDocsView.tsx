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
import { DropwaveSelect, type DropwaveSelectOption } from "./DropwaveSelect";
import { formatShortAge } from "./model";
import type { SampleDoc, SampleMemory, SampleVenture } from "./sampleData";
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

export function DropwaveDocsView({
  venture,
  initialDocId,
  onSavePreviewDoc,
  onAddPreviewMemory,
  onRemovePreviewMemory,
}: {
  venture?: SampleVenture | null;
  initialDocId?: string | null;
  onSavePreviewDoc?: (doc: SampleDoc) => void;
  onAddPreviewMemory?: (mem: SampleMemory) => void;
  onRemovePreviewMemory?: (id: string) => void;
} = {}) {
  const workspace = useDropwaveWorkspace();
  const gt = useGT();
  const isPreview = workspace?.mode === "preview" && venture != null;
  const project = workspace?.project ?? null;
  const [tab, setTab] = useState<DocsTab>("docs");
  const [query, setQuery] = useState("");
  const [docs, setDocs] = useState<ReadonlyArray<DropwaveDocSummary>>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(
    initialDocId ?? (isPreview ? (venture.docs[0]?.id ?? null) : null),
  );
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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- fetches live server docs or memory list when in live mode
  useEffect(() => {
    if (isPreview || !project || reloadNonce < 0) return;
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
  }, [gt, isPreview, listDocsCmd, listMemCmd, project, query, reloadNonce, tab]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads selected live markdown document content from server
  useEffect(() => {
    if (isPreview || !project || !selectedPath || creatingNew) {
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
  }, [creatingNew, isPreview, project, readDocCmd, selectedPath]);

  if (!workspace || (!isPreview && !project)) return null;

  const displayProjectName = isPreview ? venture.name : project!.title;
  const previewSelectedDoc = isPreview
    ? (venture.docs.find((d) => d.id === selectedPath) ?? venture.docs[0] ?? null)
    : null;

  const activeDocView = creatingNew
    ? null
    : isPreview
      ? previewSelectedDoc
        ? {
            path: previewSelectedDoc.path,
            title: previewSelectedDoc.title,
            kind: previewSelectedDoc.kind,
            content: previewSelectedDoc.content,
            id: previewSelectedDoc.id,
          }
        : null
      : selectedPath && openDoc
        ? openDoc
        : null;

  const listedDocs = isPreview
    ? venture.docs.map((doc) => ({
        key: doc.id,
        title: doc.title,
        kind: doc.kind,
        meta: `${doc.kind} · ${doc.updated}`,
        excerpt: doc.excerpt,
        path: doc.path,
      }))
    : docs.map((doc) => ({
        key: doc.path,
        title: doc.title,
        kind: doc.kind,
        meta: `${doc.kind} · ${formatShortAge(doc.updatedAt)}`,
        excerpt: doc.excerpt,
        path: doc.path,
      }));

  const filteredDocs = query.trim()
    ? listedDocs.filter(
        (doc) =>
          doc.title.toLowerCase().includes(query.trim().toLowerCase()) ||
          doc.excerpt.toLowerCase().includes(query.trim().toLowerCase()) ||
          doc.path.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : listedDocs;

  const listedMemories = isPreview
    ? venture.memories
        .filter((m) => !query.trim() || m.text.toLowerCase().includes(query.trim().toLowerCase()))
        .map((m) => ({ id: m.id, kind: m.kind, text: m.text, quote: m.quote }))
    : memories.map((m) => ({ id: m.id, kind: m.kind, text: m.text, quote: m.quote }));

  const startNewDoc = () => {
    setCreatingNew(true);
    setEditing(true);
    setSelectedPath(null);
    setOpenDoc(null);
    setDraftTitle("");
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

  const saveDoc = async () => {
    if (busy || !draftTitle.trim()) return;
    if (isPreview) {
      const slug = draftTitle
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const doc: SampleDoc = {
        id: creatingNew ? `doc-${Date.now()}` : (activeDocView?.id ?? `doc-${Date.now()}`),
        path: creatingNew
          ? `.dropwave/docs/${slug || "note"}.md`
          : (activeDocView?.path ?? `.dropwave/docs/${slug || "note"}.md`),
        title: draftTitle.trim(),
        kind: draftKind,
        updated: "Just now",
        excerpt: draftContent.split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#")) ?? "",
        content: draftContent.trimStart().startsWith("# ")
          ? draftContent
          : `# ${draftTitle.trim()}\n\n${draftContent}`,
      };
      onSavePreviewDoc?.(doc);
      setCreatingNew(false);
      setEditing(false);
      setSelectedPath(doc.id);
      return;
    }

    setBusy(true);
    setError(null);
    const res = await writeDocCmd({
      environmentId: project!.environmentId,
      input: {
        projectId: project!.id,
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
    if (isPreview || !openDoc || busy) return;
    if (!(await requestConfirmDialog(gt("Delete this document?")))) return;
    setBusy(true);
    const res = await deleteDocCmd({
      environmentId: project!.environmentId,
      input: { projectId: project!.id, path: openDoc.path },
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
    if (isPreview) {
      onAddPreviewMemory?.({
        id: `mem-${Date.now()}`,
        kind: newMemoryKind === "lesson" ? "fact" : newMemoryKind,
        text: newMemoryText.trim(),
      });
      setNewMemoryText("");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await saveMemCmd({
      environmentId: project!.environmentId,
      input: {
        projectId: project!.id,
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
    if (isPreview) {
      onRemovePreviewMemory?.(id);
      return;
    }
    if (busy) return;
    setBusy(true);
    const res = await removeMemCmd({
      environmentId: project!.environmentId,
      input: { id },
    });
    setBusy(false);
    if (res._tag === "Success") triggerReload();
  };

  const canDeleteOpenDoc =
    !isPreview && (activeDocView?.path.startsWith(".dropwave/docs/") ?? false);

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
                  <Var>{displayProjectName}</Var> docs
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
                <li key={doc.key}>
                  <button
                    type="button"
                    aria-current={
                      !creatingNew && (selectedPath ?? listedDocs[0]?.key) === doc.key
                        ? "true"
                        : undefined
                    }
                    onClick={() => {
                      setCreatingNew(false);
                      setEditing(false);
                      setSelectedPath(doc.key);
                    }}
                  >
                    <strong>{doc.title}</strong>
                    <small>{doc.meta}</small>
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
                <Var>{displayProjectName}</Var> memory (<Var>{listedMemories.length}</Var>)
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
              </div>
              <input
                data-dropwave-editorial-title=""
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.currentTarget.value)}
                placeholder={gt("Untitled document")}
                aria-label={gt("Document title")}
              />
              <textarea
                data-dropwave-editorial-body=""
                value={draftContent}
                onChange={(event) => setDraftContent(event.currentTarget.value)}
                placeholder={gt("Write briefs, specs, decisions, or notes…")}
              />
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
              <div data-dropwave-doc-body="">{renderMarkdownBlocks(activeDocView.content)}</div>
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
              {listedMemories.map((item) => (
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
              {listedMemories.length === 0 ? (
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
