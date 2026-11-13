import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Minimal Markdown for first-party documents: headings, paragraphs, lists,
 * blockquotes, tables, **bold**, `code` and [links](url). Output is React
 * elements, never raw HTML.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

export function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const [, label, href] = link;
      if (href.startsWith("/")) return <Link key={i} href={href}>{label}</Link>;
      if (/^https?:\/\//.test(href) || href.startsWith("mailto:")) {
        return <a key={i} href={href} rel="noreferrer noopener">{label}</a>;
      }
      return label;
    }
    return part;
  });
}

export function parseFrontmatter(source: string): { meta: Record<string, string>; body: string } {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return { meta: {}, body: source };
  const meta = Object.fromEntries(
    match[1].split("\n").map((line) => {
      const [k, ...v] = line.split(":");
      return [k.trim(), v.join(":").trim()];
    }),
  );
  return { meta, body: source.slice(match[0].length) };
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  const key = () => blocks.length;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const content = inline(heading[2]);
      blocks.push(
        level === 1 ? <h1 key={key()}>{content}</h1> : level === 2 ? <h2 key={key()}>{content}</h2> : <h3 key={key()}>{content}</h3>,
      );
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) quote.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push(<blockquote key={key()}>{inline(quote.join(" "))}</blockquote>);
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        const cells = lines[i++].split("|").slice(1, -1).map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
      }
      const [head, ...body] = rows;
      blocks.push(
        <table key={key()}>
          <thead>
            <tr>{head.map((c, j) => <th key={j}>{inline(c)}</th>)}</tr>
          </thead>
          <tbody>
            {body.map((r, k) => (
              <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    if (/^(-|\d+\.)\s/.test(line)) {
      const ordered = /^\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^(-|\d+\.)\s/.test(lines[i])) items.push(lines[i++].replace(/^(-|\d+\.)\s+/, ""));
      const children = items.map((it, j) => <li key={j}>{inline(it)}</li>);
      blocks.push(ordered ? <ol key={key()}>{children}</ol> : <ul key={key()}>{children}</ul>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|>|\||-\s|\d+\.\s)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={key()}>{inline(para.join(" "))}</p>);
  }
  return <>{blocks}</>;
}
