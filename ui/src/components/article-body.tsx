import type { ReactNode } from "react";

// Renders the markdown subset the writer actually emits: "##"/"###" headings, bulleted lists with one
// level of nesting, paragraphs, **bold** and `code`.
//
// Deliberately NOT a markdown engine and deliberately NOT dangerouslySetInnerHTML. The content is LLM
// output built partly from retrieved web snippets, so it is untrusted; every branch below produces React
// elements with the text as a CHILD, which React escapes. That makes HTML injection structurally
// impossible rather than a sanitiser configuration that has to be kept correct.
//
// Anything outside the subset (tables, links, fenced blocks) renders as its literal characters - visible
// and harmless, rather than silently swallowed.

const BOLD_OR_CODE = /(\*\*[^*]+\*\*|`[^`]+`)/g;

// Inline pass. Splits on the delimiters and keeps them, so the parts alternate plain / marked.
function inline(text: string): ReactNode[] {
  return text.split(BOLD_OR_CODE).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-astral-starlight">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="rounded bg-astral-900 px-1 py-0.5 font-code text-[0.85em] text-astral-blue">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

type Block =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: { text: string; nested: string[] }[] };

const BULLET = /^([ \t]*)[-*]\s+(.*)$/;

// Block pass, line by line. A list is accumulated across consecutive bullet lines, which is exactly what
// the previous renderer got wrong: it split on blank lines only, so "- a\n- b" collapsed onto one line.
export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  let list: { text: string; nested: string[] }[] | undefined;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (list !== undefined) {
      blocks.push({ kind: "list", items: list });
      list = undefined;
    }
  };

  for (const raw of markdown.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{2,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      flushParagraph();
      flushList();
      // Everything deeper than ### renders as ###: an article is a page section, not a document.
      blocks.push({ kind: "heading", level: heading[1]!.length === 2 ? 2 : 3, text: heading[2]!.trim() });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet !== null) {
      flushParagraph();
      const indented = bullet[1]!.length >= 2;
      const text = bullet[2]!.trim();
      if (list === undefined) list = [];
      if (indented && list.length > 0) list[list.length - 1]!.nested.push(text);
      else list.push({ text, nested: [] });
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  return blocks;
}

export function ArticleBody({ contentMd }: { contentMd: string }) {
  const blocks = parseBlocks(contentMd);
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        if (block.kind === "heading") {
          return block.level === 2 ? (
            <h2 key={i} className="mt-5 font-serif text-lg font-bold text-astral-gold first:mt-0">
              {inline(block.text)}
            </h2>
          ) : (
            <h3 key={i} className="mt-4 font-serif text-base font-semibold text-amber-200 first:mt-0">
              {inline(block.text)}
            </h3>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={i} className="ml-1 space-y-1.5">
              {block.items.map((item, j) => (
                <li key={j} className="flex gap-2 text-sm leading-relaxed text-slate-200">
                  <span aria-hidden="true" className="mt-[0.35rem] h-1 w-1 shrink-0 rounded-full bg-astral-gold" />
                  <span>
                    {inline(item.text)}
                    {item.nested.length === 0 ? null : (
                      <ul className="mt-1.5 ml-1 space-y-1">
                        {item.nested.map((child, k) => (
                          <li key={k} className="flex gap-2 text-slate-400">
                            <span aria-hidden="true" className="mt-[0.4rem] h-1 w-1 shrink-0 rounded-full bg-astral-600" />
                            <span>{inline(child)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="text-sm leading-relaxed text-slate-200">
            {inline(block.text)}
          </p>
        );
      })}
    </div>
  );
}

// ~200 words per minute, the usual reading-speed convention. Shown because articles are long enough for it
// to mean something now; it was dropped in Phase 9 precisely because 100-word articles made it absurd.
export function readingMinutes(contentMd: string): number {
  const words = contentMd.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}
