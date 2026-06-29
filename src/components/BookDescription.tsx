import type { Book } from "@/lib/books";

type DescriptionBlock =
  | { kind: "paragraph"; text: string; bold?: boolean }
  | { kind: "list"; title: string; items: string[]; marker: "bullet" | "dash" };

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

function parseParagraph(inner: string): DescriptionBlock {
  const boldOnly = inner.match(
    /^<span[^>]*class="[^"]*a-text-bold[^"]*"[^>]*>([\s\S]*?)<\/span>$/i,
  );
  if (boldOnly) {
    return { kind: "paragraph", text: stripTags(boldOnly[1]), bold: true };
  }

  const normalized = inner.replace(/<\/?span[^>]*>/gi, "");
  const rawLines = normalized
    .split(/<br\s*\/?>/i)
    .map(stripTags)
    .filter(Boolean);

  if (rawLines.length === 1) {
    return { kind: "paragraph", text: rawLines[0] };
  }

  const title = rawLines[0];
  const items = rawLines.slice(1).map((line) => line.replace(/^[•-]\s*/, "").trim());
  const marker = rawLines[1]?.trimStart().startsWith("-") ? "dash" : "bullet";

  return { kind: "list", title, items, marker };
}

export function parseAmazonDescriptionHtml(html: string): DescriptionBlock[] {
  const blocks: DescriptionBlock[] = [];

  for (const match of html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)) {
    blocks.push(parseParagraph(match[1]));
  }

  return blocks;
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
              <p key={index} className={block.bold ? "font-bold text-brand-charcoal" : undefined}>
                {block.text}
              </p>
            );
          }

          return (
            <div key={index}>
              <p>{block.title}</p>
              <ul
                className={
                  block.marker === "dash"
                    ? "mt-2 list-none space-y-1"
                    : "mt-2 list-disc space-y-1 pl-5"
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
