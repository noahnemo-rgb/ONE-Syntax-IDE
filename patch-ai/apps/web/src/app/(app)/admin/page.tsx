import { desc, eq, inArray } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { abuseReports, auditLog, orgs, scans, targets } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { Badge, Button, Card, Notice, PageHeader, formatDate, inputClass } from "@/components/ui";
import { isPlatformAdmin, requireUser } from "@/lib/session";
import { scansPaused } from "@/lib/settings";
import { disableHost, setAbuseStatus, toggleKillSwitch } from "../actions/admin";

export default async function AdminPage() {
  const user = await requireUser();
  if (!isPlatformAdmin(user.email)) notFound();

  const paused = await scansPaused();
  const envPaused = process.env.PATCHAI_KILL_SWITCH === "true";
  const inFlight = await db
    .select({ scan: scans, orgName: orgs.name, hostname: targets.hostname })
    .from(scans)
    .innerJoin(orgs, eq(orgs.id, scans.orgId))
    .leftJoin(targets, eq(targets.id, scans.targetId))
    .where(inArray(scans.status, ["queued", "running"]))
    .orderBy(desc(scans.createdAt))
    .limit(50);
  const reports = await db.select().from(abuseReports).orderBy(desc(abuseReports.createdAt)).limit(50);
  const events = await db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(100);

  return (
    <>
      <PageHeader title="Platform admin" description="Emergency controls, abuse reports and the audit trail." />

      <Card className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Kill switch</h2>
          <Badge kind={paused ? "failed" : "succeeded"}>{paused ? "scanning paused" : "scanning enabled"}</Badge>
        </div>
        <p className="mb-4 text-sm text-muted">
          Pausing stops workers from claiming new scans and makes running scans stop and drop their network traffic
          within about 10 seconds. New scan requests are refused while paused.
        </p>
        {envPaused && (
          <div className="mb-4">
            <Notice tone="warning">PATCHAI_KILL_SWITCH is set in the environment; scanning stays paused until it is removed.</Notice>
          </div>
        )}
        <form action={toggleKillSwitch} className="flex flex-wrap items-center gap-4">
          <input type="hidden" name="paused" value={paused ? "false" : "true"} />
          {!paused && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="cancelInFlight" /> Also cancel queued and running scans
            </label>
          )}
          <Button variant={paused ? "primary" : "danger"} type="submit">
            {paused ? "Resume scanning" : "Pause all scanning"}
          </Button>
        </form>
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-semibold">Disable a host</h2>
          <p className="mb-3 text-sm text-muted">
            Blocks scans of a hostname in every workspace and cancels its in-flight scans. Use when a third party
            reports unwanted scanning.
          </p>
          <ActionForm action={disableHost} submitLabel="Apply" variant="danger" className="space-y-3">
            <input name="hostname" required placeholder="victim.example.com" className={inputClass} />
            <select name="mode" className={inputClass} defaultValue="disable">
              <option value="disable">Disable</option>
              <option value="enable">Re-enable</option>
            </select>
          </ActionForm>
        </Card>
        <Card className="p-0">
          <h2 className="px-5 pt-5 font-semibold">In-flight scans ({inFlight.length})</h2>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {inFlight.map(({ scan, orgName, hostname }) => (
                <tr key={scan.id} className="border-t border-border">
                  <td className="px-5 py-2">{orgName}</td>
                  <td className="px-5 py-2 font-mono text-xs">{hostname ?? scan.kind}</td>
                  <td className="px-5 py-2">
                    <Badge kind={scan.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <h2 className="mb-3 text-lg font-semibold">Abuse reports</h2>
      <Card className="mb-6 p-0">
        {reports.length === 0 ? (
          <p className="p-5 text-sm text-muted">No reports.</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className="border-t border-border align-top first:border-t-0">
                  <td className="px-5 py-3 text-xs text-muted">{formatDate(r.createdAt)}</td>
                  <td className="px-5 py-3">
                    <p className="font-mono text-xs">{r.affectedHost}</p>
                    <p className="text-xs text-muted">
                      from {r.reporterEmail}
                      {r.sourceIp && ` · source IP ${r.sourceIp}`}
                      {r.observedAt && ` · seen ${r.observedAt}`}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap">{r.description}</p>
                  </td>
                  <td className="px-5 py-3">
                    <form action={setAbuseStatus} className="flex gap-1">
                      <input type="hidden" name="id" value={r.id} />
                      {["new", "investigating", "resolved"].map((s) => (
                        <Button key={s} name="status" value={s} variant={r.status === s ? "primary" : "ghost"} className="px-2 py-1 text-xs capitalize">
                          {s}
                        </Button>
                      ))}
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <h2 className="mb-3 text-lg font-semibold">Audit log (latest 100)</h2>
      <Card className="p-0">
        <table className="w-full text-xs">
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="border-t border-border align-top first:border-t-0">
                <td className="whitespace-nowrap px-4 py-2 text-muted">{formatDate(e.createdAt)}</td>
                <td className="px-4 py-2 font-mono">{e.action}</td>
                <td className="px-4 py-2 text-muted">
                  {e.subjectType && `${e.subjectType} ${e.subjectId?.slice(0, 8) ?? ""}`}
                </td>
                <td className="px-4 py-2 text-muted">{e.ipAddress}</td>
                <td className="max-w-md truncate px-4 py-2 font-mono text-muted">
                  {e.metadata ? JSON.stringify(e.metadata) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
