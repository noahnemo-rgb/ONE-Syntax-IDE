import { and, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { findings } from "@/db/schema";
import { DiffView } from "@/components/diff-view";
import { Badge, Button, Card, PageHeader } from "@/components/ui";
import { CATEGORY_LABELS, effectiveSeverity } from "@/lib/findings";
import { getOrgContext } from "@/lib/session";
import { setFindingStatus } from "../../actions/findings";

export default async function FindingPage(props: PageProps<"/findings/[id]">) {
  const { id } = await props.params;
  const { org } = await getOrgContext();
  const f = await db.query.findings.findFirst({ where: and(eq(findings.id, id), eq(findings.orgId, org.id)) });
  if (!f) notFound();

  const location = f.url ?? (f.filePath ? `${f.filePath}${f.startLine ? `:${f.startLine}` : ""}` : null);

  return (
    <>
      <Link href={`/scans/${f.scanId}`} className="text-sm text-muted hover:text-foreground">
        ← Back to scan
      </Link>
      <div className="mt-4">
        <PageHeader
          title={f.title}
          description={
            <>
              {CATEGORY_LABELS[f.category]} · {f.tools.join(", ")} · <span className="font-mono">{f.ruleId}</span>
            </>
          }
          actions={
            <form action={setFindingStatus} className="flex gap-2">
              <input type="hidden" name="findingId" value={f.id} />
              {f.status === "open" ? (
                <>
                  <Button name="status" value="dismissed" variant="secondary">
                    Dismiss
                  </Button>
                  <Button name="status" value="fixed" variant="secondary">
                    Mark fixed
                  </Button>
                </>
              ) : (
                <Button name="status" value="open" variant="secondary">
                  Reopen
                </Button>
              )}
            </form>
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <h2 className="mb-2 font-semibold">AI triage</h2>
            {f.aiVerdict ? (
              <>
                <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                  <Badge kind={f.aiVerdict} />
                  {f.aiConfidence != null && (
                    <span className="text-muted">{Math.round(f.aiConfidence * 100)}% confidence</span>
                  )}
                  {f.aiSeverity && f.aiSeverity !== f.severity && (
                    <span className="text-muted">
                      · re-rated {f.severity} → {f.aiSeverity}
                    </span>
                  )}
                </div>
                <p className="whitespace-pre-wrap text-sm leading-6">{f.aiExplanation}</p>
                <p className="mt-3 text-xs text-muted">
                  AI analysis is assistive. Verify the conclusion before relying on it.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted">
                Not triaged. AI triage runs for the most severe findings of each scan when it is enabled for this
                workspace.
              </p>
            )}
          </Card>

          {f.aiFixDiff && (
            <Card>
              <h2 className="mb-3 font-semibold">Suggested fix</h2>
              <DiffView diff={f.aiFixDiff} />
            </Card>
          )}

          <Card>
            <h2 className="mb-2 font-semibold">Scanner details</h2>
            <p className="whitespace-pre-wrap text-sm leading-6 text-muted">{f.description}</p>
            {f.evidence && (
              <pre className="mt-4 overflow-x-auto rounded-md border border-border bg-background p-4 font-mono text-xs leading-5">
                {f.evidence}
              </pre>
            )}
          </Card>
        </div>

        <Card className="h-fit space-y-3 text-sm">
          <div>
            <p className="text-xs uppercase text-muted">Severity</p>
            <Badge kind={effectiveSeverity(f)} />
          </div>
          {location && (
            <div>
              <p className="text-xs uppercase text-muted">Location</p>
              <p className="break-all font-mono text-xs">{location}</p>
            </div>
          )}
          {f.cwe && (
            <div>
              <p className="text-xs uppercase text-muted">Weakness</p>
              <a
                className="text-accent hover:underline"
                href={`https://cwe.mitre.org/data/definitions/${f.cwe.replace("CWE-", "")}.html`}
                target="_blank"
                rel="noreferrer noopener"
              >
                {f.cwe}
              </a>
            </div>
          )}
          {f.packageName && (
            <div>
              <p className="text-xs uppercase text-muted">Package</p>
              <p>
                {f.packageName} {f.installedVersion}
                {f.fixedVersion && <span className="text-emerald-300"> → {f.fixedVersion}</span>}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs uppercase text-muted">Status</p>
            <p className="capitalize">{f.status}</p>
          </div>
        </Card>
      </div>
    </>
  );
}
