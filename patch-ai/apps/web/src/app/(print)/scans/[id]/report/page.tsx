import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { CATEGORY_LABELS, effectiveSeverity, getScanWithSubject, scanFindings, subjectName } from "@/lib/findings";
import { SEVERITY_ORDER } from "@/lib/scans";
import { getOrgContext } from "@/lib/session";
import { formatDate } from "@/components/ui";

export default async function ReportPage(props: PageProps<"/scans/[id]/report">) {
  const { id } = await props.params;
  const { org } = await getOrgContext();
  const row = await getScanWithSubject(id, org.id);
  if (!row) notFound();
  const { scan } = row;
  const list = (await scanFindings(id, org.id)).filter((f) => f.status === "open" && f.aiVerdict !== "false_positive");
  const counts = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, list.filter((f) => effectiveSeverity(f) === s).length]));

  return (
    <main className="mx-auto max-w-4xl bg-white px-10 py-12 text-[13px] leading-6 text-neutral-900 print:px-0 print:py-0">
      <div className="no-print mb-8 flex justify-end">
        <PrintButton />
      </div>
      <header className="mb-8 border-b border-neutral-300 pb-6">
        <p className="text-xs uppercase tracking-widest text-neutral-500">Patch AI security report</p>
        <h1 className="mt-1 text-2xl font-semibold">{subjectName(row)}</h1>
        <p className="mt-1 text-neutral-600">
          Workspace {org.name} · {scan.kind === "code" ? "Source code scan" : `Live-target scan (${scan.profile})`} ·
          completed {formatDate(scan.finishedAt)}
          {scan.commitSha && <> · commit {scan.commitSha.slice(0, 12)}</>}
        </p>
      </header>

      <section className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Summary</h2>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr>
              {SEVERITY_ORDER.map((s) => (
                <th key={s} className="border border-neutral-300 px-3 py-1.5 capitalize">
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {SEVERITY_ORDER.map((s) => (
                <td key={s} className="border border-neutral-300 px-3 py-1.5 text-lg font-semibold">
                  {counts[s]}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-neutral-600">
          Open findings only. Findings marked dismissed or fixed, and findings the AI review classified as false
          positives, are excluded. Automated scanning cannot prove the absence of vulnerabilities.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Findings</h2>
        {list.map((f, i) => (
          <article key={f.id} className="mb-5 break-inside-avoid border-b border-neutral-200 pb-4">
            <h3 className="font-semibold">
              {i + 1}. [{effectiveSeverity(f).toUpperCase()}] {f.title}
            </h3>
            <p className="text-neutral-600">
              {CATEGORY_LABELS[f.category]}
              {f.cwe && <> · {f.cwe}</>}
              {(f.url || f.filePath) && (
                <>
                  {" "}
                  · <span className="font-mono text-xs">{f.url ?? `${f.filePath}${f.startLine ? `:${f.startLine}` : ""}`}</span>
                </>
              )}
              {f.packageName && (
                <>
                  {" "}
                  · {f.packageName} {f.installedVersion}
                  {f.fixedVersion && <> → upgrade to {f.fixedVersion}</>}
                </>
              )}
            </p>
            <p className="mt-1 whitespace-pre-wrap">{f.aiExplanation ?? f.description}</p>
          </article>
        ))}
        {list.length === 0 && <p>No open findings.</p>}
      </section>
    </main>
  );
}
