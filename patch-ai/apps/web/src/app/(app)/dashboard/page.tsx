import { and, count, desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { findings, repos, scans, targets } from "@/db/schema";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, formatDate } from "@/components/ui";
import { usageForOrg } from "@/lib/limits";
import { PLANS } from "@/lib/plans";
import { SEVERITY_ORDER } from "@/lib/scans";
import { getOrgContext } from "@/lib/session";

export default async function DashboardPage() {
  const { org } = await getOrgContext();
  const [usage, severityRows, recent] = await Promise.all([
    usageForOrg(org.id),
    db
      .select({ severity: findings.severity, n: count() })
      .from(findings)
      .where(
        and(
          eq(findings.orgId, org.id),
          eq(findings.status, "open"),
          sql`${findings.aiVerdict} is distinct from 'false_positive'`,
        ),
      )
      .groupBy(findings.severity),
    db
      .select({
        id: scans.id,
        kind: scans.kind,
        status: scans.status,
        createdAt: scans.createdAt,
        summary: scans.summary,
        repoName: repos.name,
        hostname: targets.hostname,
      })
      .from(scans)
      .leftJoin(repos, eq(repos.id, scans.repoId))
      .leftJoin(targets, eq(targets.id, scans.targetId))
      .where(eq(scans.orgId, org.id))
      .orderBy(desc(scans.createdAt))
      .limit(10),
  ]);
  const bySeverity = Object.fromEntries(severityRows.map((r) => [r.severity, r.n]));
  const limits = PLANS[org.plan];

  return (
    <>
      <PageHeader
        title="Overview"
        description={org.name}
        actions={
          <>
            <ButtonLink href="/repos" variant="secondary">
              Add repository
            </ButtonLink>
            <ButtonLink href="/targets">Add live target</ButtonLink>
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-5">
        {SEVERITY_ORDER.map((s) => (
          <Card key={s}>
            <Badge kind={s} />
            <p className="mt-3 text-3xl font-semibold">{bySeverity[s] ?? 0}</p>
            <p className="text-xs text-muted">open findings</p>
          </Card>
        ))}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">Scans this month</p>
          <p className="mt-1 text-xl font-semibold">
            {usage.scansThisMonth} / {limits.scansPerMonth}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Repositories</p>
          <p className="mt-1 text-xl font-semibold">
            {usage.repos} / {limits.repos}
          </p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Live targets</p>
          <p className="mt-1 text-xl font-semibold">
            {usage.targets} / {limits.liveTargets}
          </p>
        </Card>
      </div>

      <h2 className="mb-3 mt-10 text-lg font-semibold">Recent scans</h2>
      {recent.length === 0 ? (
        <EmptyState title="No scans yet">Connect a repository or verify a domain to run your first scan.</EmptyState>
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-5 py-3">Subject</th>
                <th className="px-5 py-3">Type</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Findings</th>
                <th className="px-5 py-3">Started</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-5 py-3">
                    <Link href={`/scans/${s.id}`} className="hover:text-accent">
                      {s.repoName ?? s.hostname}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-muted">{s.kind === "code" ? "Code" : "Live target"}</td>
                  <td className="px-5 py-3">
                    <Badge kind={s.status} />
                  </td>
                  <td className="px-5 py-3 text-muted">{s.summary ? s.summary.total ?? 0 : "—"}</td>
                  <td className="px-5 py-3 text-muted">{formatDate(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
