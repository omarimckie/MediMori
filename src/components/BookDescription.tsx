import type { Book } from "@/lib/books";
import type { ReactNode } from "react";

type DescriptionBlock =
  | { kind: "paragraph"; nodes: ReactNode[]; bold?: boolean }
  | { kind: "list"; title?: string; items: string[]; marker: "bullet" | "dash" };

function decodeHtmlEntities(text: string) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string) {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function parseInlineAmazonHtml(html: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern =
    /<span[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/span>|<span>([\s\S]*?)<\/span>/gi;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    if (match.index > lastIndex) {
      parts.push(decodeHtmlEntities(html.slice(lastIndex, match.index)));
    }

    const classes = match[1] ?? "";
    const text = decodeHtmlEntities(match[2] ?? match[3] ?? "");

    if (classes.includes("a-text-bold")) {
      parts.push(<strong key={match.index}>{text}</strong>);
    } else if (classes.includes("a-text-italic")) {
      parts.push(<em key={match.index}>{text}</em>);
    } else {
      parts.push(text);
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < html.length) {
    parts.push(decodeHtmlEntities(html.slice(lastIndex)));
  }

  return parts.length ? parts : [stripTags(html)];
}

function parseLegacyParagraph(inner: string): DescriptionBlock {
  const boldOnly = inner.match(
    /^<span[^>]*class="[^"]*a-text-bold[^"]*"[^>]*>([\s\S]*?)<\/span>$/i,
  );
  if (boldOnly) {
    return {
      kind: "paragraph",
      nodes: [stripTags(boldOnly[1])],
      bold: true,
    };
  }

  const normalized = inner.replace(/<\/?span[^>]*>/gi, "");
  const rawLines = normalized
    .split(/<br\s*\/?>/i)
    .map(stripTags)
    .filter(Boolean);

  if (rawLines.length === 1) {
    return { kind: "paragraph", nodes: parseInlineAmazonHtml(inner) };
  }

  const title = rawLines[0];
  const items = rawLines.slice(1).map((line) => line.replace(/^[•-]\s*/, "").trim());
  const marker = rawLines[1]?.trimStart().startsWith("-") ? "dash" : "bullet";

  return { kind: "list", title, items, marker };
}

export function parseAmazonDescriptionHtml(html: string): DescriptionBlock[] {
  const blocks: DescriptionBlock[] = [];
  let remaining = html.trim();

  while (remaining.length > 0) {
    const boldSpan = remaining.match(
      /^<span[^>]*class="[^"]*a-text-bold[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
    );
    if (boldSpan) {
      blocks.push({
        kind: "paragraph",
        nodes: [stripTags(boldSpan[1])],
        bold: true,
      });
      remaining = remaining.slice(boldSpan[0].length);
      continue;
    }

    const paragraph = remaining.match(/^<p[^>]*>([\s\S]*?)<\/p>/i);
    if (paragraph) {
      const inner = paragraph[1];
      const boldParagraph = inner.match(
        /^<span[^>]*class="[^"]*a-text-bold[^"]*"[^>]*>([\s\S]*?)<\/span>$/i,
      );
      if (boldParagraph) {
        blocks.push({
          kind: "paragraph",
          nodes: [stripTags(boldParagraph[1])],
          bold: true,
        });
      } else {
        blocks.push({
          kind: "paragraph",
          nodes: parseInlineAmazonHtml(inner),
        });
      }
      remaining = remaining.slice(paragraph[0].length);
      continue;
    }

    const list = remaining.match(/^<ul[^>]*>([\s\S]*?)<\/ul>/i);
    if (list) {
      const items = [...list[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
        .map((item) => stripTags(item[1]))
        .filter(Boolean);

      blocks.push({ kind: "list", items, marker: "bullet" });
      remaining = remaining.slice(list[0].length);
      continue;
    }

    break;
  }

  if (blocks.length) {
    return blocks;
  }

  return [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((match) =>
    parseLegacyParagraph(match[1]),
  );
}

type Props = {
  book: Book;
  className?: string;
};

export function BookDescription({ book, className = "" }: Props) {
  const proseClass =
    "text-sm leading-relaxed text-brand-charcoal/85 sm:text-[0.95rem]";

  if (book.descriptionHtml) {
    const blocks = parseAmazonDescriptionHtml(book.descriptionHtml);

    return (
      <div className={`space-y-4 ${proseClass} ${className}`.trim()}>
        {blocks.map((block, index) => {
          if (block.kind === "paragraph") {
            return (
              <p
                key={index}
                className={block.bold ? "font-bold text-brand-charcoal" : undefined}
              >
                {block.nodes}
              </p>
            );
          }

          return (
            <div key={index}>
              {block.title ? <p>{block.title}</p> : null}
              <ul
                className={
                  block.marker === "dash"
                    ? `${block.title ? "mt-2" : ""} list-none space-y-1`
                    : `${block.title ? "mt-2" : ""} list-disc space-y-1 pl-5`
                }
              >
                {block.items.map((item) => (
                  <li key={item}>
                    {block.marker === "dash" ? `- ${item}` : item}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    );
  }

  return <p className={`${proseClass} ${className}`.trim()}>{book.description}</p>;
}
