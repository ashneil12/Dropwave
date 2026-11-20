import { useGT } from "gt-react";
import { CheckIcon, CopyIcon, FileTextIcon, MessageSquareIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

type MdBlock =
  | { readonly kind: "code"; readonly key: string; readonly lang: string; readonly code: string }
  | { readonly kind: "h1" | "h2" | "h3"; readonly key: string; readonly text: string }
  | { readonly kind: "ul"; readonly key: string; readonly items: ReadonlyArray<string> }
  | { readonly kind: "ol"; readonly key: string; readonly items: ReadonlyArray<string> }
  | {
      readonly kind: "table";
      readonly key: string;
      readonly headers: ReadonlyArray<string>;
      readonly rows: ReadonlyArray<ReadonlyArray<string>>;
    }
  | { readonly kind: "p"; readonly key: string; readonly text: string };

export interface DropwaveMarkdownHandlers {
  readonly onOpenDocPath?: ((docPath: string) => void) | undefined;
  readonly onOpenThreadId?: ((threadId: string) => void) | undefined;
}

function extractDropwaveDocPath(href: string): string | null {
  const dropwaveMatch = /(\.dropwave\/docs\/[^\s#?]+)/i.exec(href);
  if (dropwaveMatch) return dropwaveMatch[1]!;
  if (/\.md$/i.test(href)) {
    const file = href.split("/").pop();
    if (file) return file;
  }
  return null;
}

function extractThreadId(href: string): string | null {
  if (!href.startsWith("t3-thread://")) return null;
  const parts = href.split("/");
  const last = parts.at(-1);
  return last ? decodeURIComponent(last) : null;
}

function parseMarkdown(source: string): Array<MdBlock> {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Array<MdBlock> = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = /^```([\w-]*)\s*$/.exec(line.trim());
    if (fence) {
      const lang = fence[1] ?? "";
      const codeLines: Array<string> = [];
      const start = i;
      i += 1;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) {
        codeLines.push(lines[i]!);
        i += 1;
      }
      if (i < lines.length) i += 1;
      blocks.push({ kind: "code", key: `code-${start}`, lang, code: codeLines.join("\n") });
      continue;
    }

    if (line.startsWith("### ")) {
      blocks.push({ kind: "h3", key: `h3-${i}`, text: line.slice(4).trim() });
      i += 1;
      continue;
    }
    if (line.startsWith("## ")) {
      blocks.push({ kind: "h2", key: `h2-${i}`, text: line.slice(3).trim() });
      i += 1;
      continue;
    }
    if (line.startsWith("# ")) {
      blocks.push({ kind: "h1", key: `h1-${i}`, text: line.slice(2).trim() });
      i += 1;
      continue;
    }

    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1]!)
    ) {
      const start = i;
      const splitRow = (raw: string) =>
        raw
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const headers = splitRow(line);
      i += 2;
      const rows: Array<Array<string>> = [];
      while (i < lines.length && lines[i]!.includes("|") && lines[i]!.trim()) {
        rows.push(splitRow(lines[i]!));
        i += 1;
      }
      blocks.push({ kind: "table", key: `tbl-${start}`, headers, rows });
      continue;
    }

    if (/^\s*[-*•]\s+/.test(line)) {
      const start = i;
      const items: Array<string> = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*•]\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ul", key: `ul-${start}`, items });
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const start = i;
      const items: Array<string> = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ol", key: `ol-${start}`, items });
      continue;
    }

    const start = i;
    const para: Array<string> = [];
    while (
      i < lines.length &&
      lines[i]!.trim() &&
      !lines[i]!.trim().startsWith("```") &&
      !lines[i]!.startsWith("#") &&
      !/^\s*[-*•]\s+/.test(lines[i]!) &&
      !/^\s*\d+\.\s+/.test(lines[i]!)
    ) {
      para.push(lines[i]!);
      i += 1;
    }
    blocks.push({ kind: "p", key: `p-${start}`, text: para.join("\n") });
  }
  return blocks;
}

function renderInline(text: string, handlers: DropwaveMarkdownHandlers): ReactNode {
  const tokenRe = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\)|#\d+)/g;
  const nodes: Array<ReactNode> = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${match.index}-${token.slice(0, 12)}`;
    if (token.startsWith("`") && token.endsWith("`")) {
      const codeVal = token.slice(1, -1);
      const docPath = extractDropwaveDocPath(codeVal);
      if (docPath && handlers.onOpenDocPath) {
        nodes.push(
          <button
            key={key}
            type="button"
            data-dw-ref-chip="doc"
            onClick={() => handlers.onOpenDocPath?.(docPath)}
          >
            <FileTextIcon className="size-3 shrink-0" />
            <span>{codeVal}</span>
          </button>,
        );
      } else {
        nodes.push(
          <code key={key} data-dw-inline-code="">
            {codeVal}
          </code>,
        );
      }
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("[")) {
      const parsed = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (parsed) {
        const label = parsed[1]!;
        const href = parsed[2]!;
        const threadId = extractThreadId(href);
        const docPath = extractDropwaveDocPath(href);
        if (/^https?:\/\//i.test(href)) {
          nodes.push(
            <a key={key} href={href} target="_blank" rel="noreferrer" data-dw-md-link="">
              {label}
            </a>,
          );
        } else if (threadId && handlers.onOpenThreadId) {
          nodes.push(
            <button
              key={key}
              type="button"
              data-dw-ref-chip="thread"
              onClick={() => handlers.onOpenThreadId?.(threadId)}
            >
              <MessageSquareIcon className="size-3 shrink-0" />
              <span>{label}</span>
            </button>,
          );
        } else if (docPath && handlers.onOpenDocPath) {
          nodes.push(
            <button
              key={key}
              type="button"
              data-dw-ref-chip="doc"
              onClick={() => handlers.onOpenDocPath?.(docPath)}
            >
              <FileTextIcon className="size-3 shrink-0" />
              <span>{label}</span>
            </button>,
          );
        } else {
          nodes.push(
            <code key={key} data-dw-inline-code="">
              {label}
            </code>,
          );
        }
      } else {
        nodes.push(token);
      }
    } else if (/^#\d+$/.test(token)) {
      nodes.push(
        <span key={key} data-dw-mono="emerald">
          {token}
        </span>,
      );
    } else {
      nodes.push(token);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const gt = useGT();
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div data-dw-code-block="">
      <div data-dw-code-head="">
        <span>{lang || "code"}</span>
        <button type="button" data-dw-code-copy="" onClick={copy} aria-label={gt("Copy code")}>
          {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function DropwaveMarkdown({
  text,
  onOpenDocPath,
  onOpenThreadId,
}: {
  text: string;
} & DropwaveMarkdownHandlers) {
  const blocks = parseMarkdown(text);
  const handlers: DropwaveMarkdownHandlers = { onOpenDocPath, onOpenThreadId };
  return (
    <div data-dw-md="">
      {blocks.map((block) => {
        switch (block.kind) {
          case "code":
            return <CodeBlock key={block.key} lang={block.lang} code={block.code} />;
          case "h1":
            return <h3 key={block.key}>{renderInline(block.text, handlers)}</h3>;
          case "h2":
            return <h4 key={block.key}>{renderInline(block.text, handlers)}</h4>;
          case "h3":
            return <h5 key={block.key}>{renderInline(block.text, handlers)}</h5>;
          case "ul":
            return (
              <ul key={block.key}>
                {block.items.map((item) => (
                  <li key={`${block.key}-${item.slice(0, 24)}`}>{renderInline(item, handlers)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={block.key}>
                {block.items.map((item) => (
                  <li key={`${block.key}-${item.slice(0, 24)}`}>{renderInline(item, handlers)}</li>
                ))}
              </ol>
            );
          case "table":
            return (
              <div key={block.key} data-dw-md-table-wrap="">
                <table>
                  <thead>
                    <tr>
                      {block.headers.map((h) => (
                        <th key={`${block.key}-h-${h}`}>{renderInline(h, handlers)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row) => (
                      <tr key={`${block.key}-r-${row.join("|").slice(0, 28)}`}>
                        {row.map((cell) => (
                          <td key={`${block.key}-c-${cell.slice(0, 24)}`}>
                            {renderInline(cell, handlers)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "p":
            return <p key={block.key}>{renderInline(block.text, handlers)}</p>;
        }
      })}
    </div>
  );
}
