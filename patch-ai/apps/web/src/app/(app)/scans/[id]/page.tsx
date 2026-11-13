import clsx from "clsx";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge, Button, ButtonLink, Card, EmptyState, Notice, PageHeader, formatDate } from "@/components/ui";
import {
  CATEGORY_LABELS,
  effectiveSeverity,
  getScanWithSubject,
  parseFilters,
  scanFindings,
  subjectName,
} from "@/lib/findings";
import { SEVERITY_ORDER } from "@/lib/scans";
import { getOrgContext } from "@/lib/session";
import { cancelScan } from "../../actions/repos";

function FilterLink({
  params,
  name,
  value,
  label,
}: {
  params: Record<string, string | undefined>;
  name: string;
  value?: string;
  label: string;
}) {
  const next = new URLSearchParams(
    Object.entries({ ...params, [name]: value }).filter(([, v]) => v) as [string, string][],
  );
  const active = params[name] === value;
  return (
    <Link
      href={`?${next.toString()}`}
      className={clsx(
        "rounded-md border px-2.5 py-1 text-xs",
        active ? "border-accent text-accent" : "border-border text-muted hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}

export default async function ScanPage(props: PageProps<"/scans/[id]">) {
  const { id } = await props.params;
  const { org } = await getOrgContext();
  const row = await getScanWithSubject(id, org.id);
  if (!row) notFound();
  const { scan } = row;
  const filters = parseFilters(await props.searchParams);
  const list = await scanFindings(scan.id, org.id, filters);
  const active = scan.status === "queued" || scan.status === "running";
  const summary = scan.summary ?? {};
  const params = filters as Record<string, string | undefined>;

  return (
    <>
      <AutoRefresh active={active} />
      <PageHeader
        title={subjectName(row)}
        description={
          <>
            {scan.kind === "code" ? "Code scan" : `Live-target scan (${scan.profile})`} · requested{" "}
            {formatDate(scan.createdAt)}
            {scan.commitSha && <> · commit {scan.commitSha.slice(0, 10)}</>}
          </>
        }
        actions={
          <>
            {active && (
              <form action={cancelScan}>
                <input type="hidden" name="scanId" value={scan.id} />
                <Button variant="danger" type="submit">
                  Cancel scan
                </Button>
              </form>
            )}
            {scan.status === "succeeded" && (
              <>
                <ButtonLink href={`/api/scans/${scan.id}/export`} variant="secondary" prefetch={false}>
                  Export JSON
                </ButtonLink>
                <ButtonLink href={`/scans/${scan.id}/report`} variant="secondary">
                  Report (PDF)
                </ButtonLink>
              </>
            )}
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Badge kind={scan.status} />
        {active && <span className="text-sm text-muted">This page updates automatically.</span>}
        {scan.error && <span className="text-sm text-red-300">{scan.error}</span>}
      </div>

      {scan.status === "succeeded" && (
        <div className="mb-6 grid gap-3 sm:grid-cols-5">
          {SEVERITY_ORDER.map((s) => (
            <Card key={s} className="p-4">
              <Badge kind={s} />
              <p className="mt-2 text-2xl font-semibold">{summary[s] ?? 0}</p>
            </Card>
          ))}
        </div>
      )}

      {(scan.status === "succeeded" || list.length > 0) && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs uppercase text-muted">Severity</span>
            <FilterLink params={params} name="severity" label="All" />
            {SEVERITY_ORDER.map((s) => (
              <FilterLink key={s} params={params} name="severity" value={s} label={s} />
            ))}
            <span className="ml-4 mr-1 text-xs uppercase text-muted">Type</span>
            <FilterLink params={params} name="category" label="All" />
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <FilterLink key={k} params={params} name="category" value={k} label={v} />
            ))}
            <span className="ml-4 mr-1 text-xs uppercase text-muted">AI verdict</span>
            <FilterLink params={params} name="verdict" label="All" />
            <FilterLink params={params} name="verdict" value="true_positive" label="Real issue" />
            <FilterLink params={params} name="verdict" value="needs_review" label="Needs review" />
            <FilterLink params={params} name="verdict" value="false_positive" label="False positive" />
          </div>
          {list.length === 0 ? (
            <EmptyState title="No findings match these filters" />
          ) : (
            <Card className="p-0">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-muted">
                  <tr>
                    <th className="px-5 py-3">Severity</th>
                    <th className="px-5 py-3">Finding</th>
                    <th className="px-5 py-3">Location</th>
                    <th className="px-5 py-3">AI verdict</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((f) => (
                    <tr key={f.id} className={clsx("border-t border-border", f.status !== "open" && "opacity-50")}>
                      <td className="px-5 py-3">
                        <Badge kind={effectiveSeverity(f)} />
                      </td>
                      <td className="px-5 py-3">
                        <Link href={`/findings/${f.id}`} className="hover:text-accent">
                          {f.title}
                        </Link>
                        <div className="text-xs text-muted">
                          {CATEGORY_LABELS[f.category]} · {f.tools.join(", ")}
                        </div>
                      </td>
                      <td className="max-w-xs truncate px-5 py-3 font-mono text-xs text-muted">
                        {f.url ?? (f.filePath ? `${f.filePath}${f.startLine ? `:${f.startLine}` : ""}` : "—")}
                      </td>
                      <td className="px-5 py-3">{f.aiVerdict ? <Badge kind={f.aiVerdict} /> : <span className="text-xs text-muted">—</span>}</td>
                      <td className="px-5 py-3 text-xs capitalize text-muted">{f.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}

      {scan.status === "queued" && (
        <Notice>Waiting for a scan worker. Scans usually start within a few seconds.</Notice>
      )}

      <details className="mt-8" open={active || scan.status === "failed"}>
        <summary className="cursor-pointer text-sm text-muted">Scan log</summary>
        <pre className="mt-3 max-h-96 overflow-auto rounded-md border border-border bg-background p-4 font-mono text-xs leading-5 text-muted">
          {scan.logs || "No log output yet."}
        </pre>
      </details>
    </>
  );
}
