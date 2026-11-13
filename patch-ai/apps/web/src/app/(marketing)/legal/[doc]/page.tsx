import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isLegalDoc, LEGAL_DOCS, loadLegalDoc } from "@/lib/legal";
import { Markdown } from "@/lib/markdown";

export const dynamicParams = false;

export function generateStaticParams() {
  return LEGAL_DOCS.map((doc) => ({ doc }));
}

export async function generateMetadata(props: PageProps<"/legal/[doc]">): Promise<Metadata> {
  const { doc } = await props.params;
  if (!isLegalDoc(doc)) return {};
  return { title: `${(await loadLegalDoc(doc)).title} · Patch AI` };
}

const LABELS: Record<string, string> = {
  terms: "Terms",
  "acceptable-use": "Acceptable use",
  privacy: "Privacy",
  dpa: "DPA",
};

export default async function LegalPage(props: PageProps<"/legal/[doc]">) {
  const { doc } = await props.params;
  if (!isLegalDoc(doc)) notFound();
  const { title, updated, body } = await loadLegalDoc(doc);
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <nav className="no-print mb-10 flex flex-wrap gap-2 text-sm">
        {LEGAL_DOCS.map((d) => (
          <Link
            key={d}
            href={`/legal/${d}`}
            className={d === doc ? "rounded-md bg-surface-2 px-3 py-1.5" : "rounded-md px-3 py-1.5 text-muted hover:text-foreground"}
          >
            {LABELS[d]}
          </Link>
        ))}
      </nav>
      <h1 className="text-3xl font-semibold">{title}</h1>
      {updated && <p className="mt-2 text-sm text-muted">Last updated {updated}</p>}
      <article className="prose-legal mt-8">
        <Markdown source={body} />
      </article>
    </div>
  );
}
