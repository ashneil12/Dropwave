// Notion-style Markdown editor for Dropwave docs, adapted from coollabsio/orbit
// (Apache-2.0 — https://github.com/coollabsio/orbit). Loaded lazily: docs stay
// Markdown files on disk; this component only converts to/from BlockNote blocks.
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/shadcn";
import "@blocknote/shadcn/style.css";
import { useGT } from "gt-react";
import { useEffect, useRef, useState, type ComponentProps } from "react";

import { useRenderedAppearance } from "../hooks/useTheme";

// Round-trip comparison ignores line endings, trailing whitespace, and the
// serializer's unordered-list marker style (`*` vs `-`, same bullet); anything
// else it drops (frontmatter, raw HTML, footnotes, tables) counts as lossy.
function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/^(\s*)\* /gm, "$1- ")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

export default function DropwaveBlockNoteEditor({
  markdown,
  title,
  onChange,
}: {
  readonly markdown: string;
  readonly title?: string | undefined;
  readonly onChange: (markdown: string) => void;
}) {
  const gt = useGT();
  const resolvedTheme = useRenderedAppearance();
  // useCreateBlockNote types the default schema one alias deeper than BlockNoteView's
  // editor prop, so under exactOptionalPropertyTypes they only agree through the alias.
  const editor = useCreateBlockNote() as unknown as ComponentProps<typeof BlockNoteView>["editor"];
  const onChangeRef = useRef(onChange);
  // Serialized form of the document right after the initial parse; onChange
  // only reports content that differs from it, so mount never rewrites the file.
  const baselineRef = useRef<string | null>(null);
  const suppressInitialChange = useRef(false);
  // Parsed once (the parent keys this component per doc); a lossy round-trip
  // means the visual editor can't keep this doc's formatting.
  const [initial] = useState(() => {
    const blocks = editor.tryParseMarkdownToBlocks(markdown);
    const lossy =
      normalizeMarkdown(editor.blocksToMarkdownLossy(blocks)) !== normalizeMarkdown(markdown);
    // A leading "# Title" that only repeats the title field is hidden in the
    // editor; it stays in the block model so saves round-trip it unchanged.
    const first = blocks[0];
    const firstContent =
      first?.type === "heading" && first.props.level === 1
        ? (first.content as ReadonlyArray<{ readonly text?: string }>)
        : undefined;
    const firstText =
      firstContent === undefined
        ? ""
        : firstContent
            .map((part) => part.text ?? "")
            .join("")
            .trim();
    const hideTitleH1 =
      !lossy && firstText !== "" && title !== undefined && firstText === title.trim();
    return { blocks, lossy, hideTitleH1 };
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the latest onChange reachable from BlockNote's change callback
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- parses the initial markdown into BlockNote's model once on mount; later edits flow back through onChange
  useEffect(() => {
    if (initial.lossy) return;
    suppressInitialChange.current = true;
    editor.replaceBlocks(editor.document, initial.blocks);
    baselineRef.current = editor.blocksToMarkdownLossy(editor.document);
    suppressInitialChange.current = false;
  }, [editor, initial]);

  if (initial.lossy) {
    return (
      <div data-dw-blocknote="">
        <p data-dw-blocknote-lossy-note="">
          {gt(
            "This doc has formatting the visual editor can't keep, so it opens as plain Markdown.",
          )}
        </p>
        <textarea
          data-dropwave-editorial-body=""
          value={markdown}
          onChange={(event) => onChangeRef.current(event.currentTarget.value)}
        />
      </div>
    );
  }

  return (
    <div data-dw-blocknote="" {...(initial.hideTitleH1 ? { "data-dw-hide-title-h1": "" } : {})}>
      <BlockNoteView
        editor={editor}
        slashMenu
        theme={resolvedTheme}
        onChange={() => {
          if (suppressInitialChange.current) return;
          const next = editor.blocksToMarkdownLossy(editor.document);
          if (next === baselineRef.current) return;
          baselineRef.current = next;
          onChangeRef.current(next);
        }}
      />
    </div>
  );
}
