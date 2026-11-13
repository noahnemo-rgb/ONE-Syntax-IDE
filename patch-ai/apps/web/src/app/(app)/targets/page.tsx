import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { targets } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { Badge, ButtonLink, Card, EmptyState, Notice, PageHeader, formatDate, inputClass } from "@/components/ui";
import { PLANS } from "@/lib/plans";
import { getOrgContext } from "@/lib/session";
import { isVerificationCurrent } from "@/lib/verification";
import { addTarget } from "../actions/targets";

export default async function TargetsPage() {
  const { org, role } = await getOrgContext();
  const list = await db.select().from(targets).where(eq(targets.orgId, org.id)).orderBy(desc(targets.createdAt));
  const limit = PLANS[org.plan].liveTargets;

  return (
    <>
      <PageHeader
        title="Live targets"
        description="Scan running web applications you own. Each domain must be verified and authorized before it can be scanned."
      />
      {limit === 0 ? (
        <Notice tone="warning">
          Live-target scanning is included in the Team plan.{" "}
          <ButtonLink href="/settings#billing" variant="ghost" className="px-1 py-0 underline">
            Upgrade
          </ButtonLink>
        </Notice>
      ) : (
        role !== "member" && (
          <Card className="mb-6">
            <h2 className="mb-3 font-semibold">Add a target</h2>
            <ActionForm action={addTarget} submitLabel="Add target" className="flex flex-wrap items-start gap-3">
              <input
                name="hostname"
                required
                placeholder="staging.example.com"
                className={`${inputClass} max-w-md`}
                autoComplete="off"
              />
            </ActionForm>
            <p className="mt-3 text-xs text-muted">
              {list.length} of {limit} targets used. Only add hosts you own or have written permission to test.
            </p>
          </Card>
        )
      )}

      {list.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No live targets yet" />
        </div>
      ) : (
        <Card className="mt-6 p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-5 py-3">Hostname</th>
                <th className="px-5 py-3">Ownership</th>
                <th className="px-5 py-3">Profile</th>
                <th className="px-5 py-3">Added</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id} className="border-t border-border">
                  <td className="px-5 py-3">
                    <Link href={`/targets/${t.id}`} className="font-mono hover:text-accent">
                      {t.hostname}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    {t.disabled ? (
                      <Badge kind="failed">disabled</Badge>
                    ) : (
                      <Badge kind={isVerificationCurrent(t) ? "verified" : "unverified"} />
                    )}
                  </td>
                  <td className="px-5 py-3 capitalize text-muted">{t.profile}</td>
                  <td className="px-5 py-3 text-muted">{formatDate(t.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
