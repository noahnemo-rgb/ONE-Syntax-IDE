import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "./markdown";

export const LEGAL_DOCS = ["terms", "acceptable-use", "privacy", "dpa"] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

export function isLegalDoc(value: string): value is LegalDoc {
  return (LEGAL_DOCS as readonly string[]).includes(value);
}

export async function loadLegalDoc(doc: LegalDoc) {
  const source = await readFile(path.join(process.cwd(), "content", "legal", `${doc}.md`), "utf8");
  const { meta, body } = parseFrontmatter(source);
  return { title: meta.title ?? doc, updated: meta.updated, body };
}
