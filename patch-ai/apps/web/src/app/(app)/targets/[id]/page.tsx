import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { attestations, scans, targets } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { Badge, Button, Card, EmptyState, Field, Notice, PageHeader, formatDate, inputClass } from "@/components/ui";
import { attestationStatement } from "@/lib/attestation";
import { PLANS } from "@/lib/plans";
import { getOrgContext } from "@/lib/session";
import {
  dnsRecordName,
  expectedRecordValue,
  isVerificationCurrent,
  WELL_KNOWN_PATH,
} from "@/lib/verification";
import { startWebScan } from "../../actions/repos";
import { deleteTarget, setTargetProfile, signAttestation, verifyTarget } from "../../actions/targets";

export default async function TargetPage(props: PageProps<"/targets/[id]">) {
  const { id } = await props.params;
  const { org, role } = await getOrgContext();
  const target = await db.query.targets.findFirst({ where: and(eq(targets.id, id), eq(targets.orgId, org.id)) });
  if (!target) notFound();
  const canManage = role !== "member";
  const verified = isVerificationCurrent(target);
  const signed = await db
    .select()
    .from(attestations)
    .where(eq(attestations.targetId, target.id))
    .orderBy(desc(attestations.createdAt));
  const current = signed.find((a) => a.profile === target.profile);
  const history = await db
    .select()
    .from(scans)
    .where(eq(scans.targetId, target.id))
    .orderBy(desc(scans.createdAt))
    .limit(25);
  const activeAllowed = PLANS[org.plan].activeWebScans;
  const record = expectedRecordValue(target.verificationToken);

  return (
    <>
      <PageHeader
        title={target.hostname}
        description={
          <>
            {target.profile === "active" ? "Active" : "Passive"} profile ·{" "}
            {verified ? `verified until ${formatDate(target.verificationExpiresAt)}` : "ownership not verified"}
          </>
        }
        actions={
          verified && current && !target.disabled ? (
            <ActionForm action={startWebScan} submitLabel={`Start ${target.profile} scan`} className="flex items-start gap-2">
              <input type="hidden" name="targetId" value={target.id} />
            </ActionForm>
          ) : undefined
        }
      />
      {target.disabled && (
        <div className="mb-6">
          <Notice tone="error">This target was disabled by Patch AI. Contact support to re-enable it.</Notice>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">1. Verify ownership</h2>
            <Badge kind={verified ? "verified" : "unverified"} />
          </div>
          <p className="mb-3 text-sm text-muted">
            Use either method. Verification lasts 30 days and is checked again by the scanner before every scan; if
            the record is removed, scanning stops.
          </p>
          <p className="text-sm font-medium">DNS TXT record</p>
          <dl className="mb-4 mt-1 grid grid-cols-[5rem_1fr] gap-1 rounded-md border border-border bg-background p-3 font-mono text-xs">
            <dt className="text-muted">Name</dt>
            <dd className="break-all">{dnsRecordName(target.hostname)}</dd>
            <dt className="text-muted">Value</dt>
            <dd className="break-all">{record}</dd>
          </dl>
          <p className="text-sm font-medium">Or a file served over HTTPS</p>
          <p className="mb-1 mt-1 break-all font-mono text-xs text-muted">
            https://{target.hostname}
            {WELL_KNOWN_PATH}
          </p>
          <pre className="mb-4 overflow-x-auto rounded-md border border-border bg-background p-3 font-mono text-xs">
            {record}
          </pre>
          {canManage && (
            <ActionForm action={verifyTarget} submitLabel={verified ? "Re-check now" : "Verify"} variant="secondary">
              <input type="hidden" name="targetId" value={target.id} />
            </ActionForm>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">2. Authorize scanning</h2>
            {current ? <Badge kind="verified">signed</Badge> : <Badge kind="unverified">not signed</Badge>}
          </div>
          {canManage && (
            <form action={setTargetProfile} className="mb-4 flex gap-2">
              <input type="hidden" name="targetId" value={target.id} />
              <Button
                name="profile"
                value="passive"
                variant={target.profile === "passive" ? "primary" : "secondary"}
                type="submit"
              >
                Passive
              </Button>
              <Button
                name="profile"
                value="active"
                variant={target.profile === "active" ? "primary" : "secondary"}
                type="submit"
                disabled={!activeAllowed}
                title={activeAllowed ? undefined : "Requires the Team plan"}
              >
                Active
              </Button>
            </form>
          )}
          <p className="mb-3 text-sm text-muted">
            {target.profile === "passive"
              ? "Passive scans read headers, cookies, TLS settings and public pages. They send no attack payloads."
              : "Active scans send attack payloads such as SQL injection and XSS probes. Run them against staging."}
          </p>
          {current ? (
            <p className="text-sm">
              Signed by {current.signerName}
              {current.signerTitle && `, ${current.signerTitle}`} on {formatDate(current.createdAt)}.
            </p>
          ) : canManage ? (
            <ActionForm action={signAttestation} submitLabel="Sign authorization">
              <input type="hidden" name="targetId" value={target.id} />
              <input type="hidden" name="profile" value={target.profile} />
              <blockquote className="rounded-md border border-border bg-background p-3 text-xs leading-5 text-muted">
                {attestationStatement(target.profile, target.hostname, org.name)}
              </blockquote>
              <Field label="Full name">
                <input name="signerName" required minLength={2} maxLength={120} className={inputClass} />
              </Field>
              <Field label="Title (optional)">
                <input name="signerTitle" maxLength={120} className={inputClass} />
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="agree" required className="mt-1" />I have read and agree to the statement
                above.
              </label>
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">An owner or admin must sign the authorization.</p>
          )}
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Scan history</h2>
      {history.length === 0 ? (
        <EmptyState title="No scans yet" />
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <tbody>
              {history.map((s) => (
                <tr key={s.id} className="border-t border-border first:border-t-0">
                  <td className="px-5 py-3">
                    <Link href={`/scans/${s.id}`} className="hover:text-accent">
                      {formatDate(s.createdAt)}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <Badge kind={s.status} />
                  </td>
                  <td className="px-5 py-3 capitalize text-muted">{s.profile}</td>
                  <td className="px-5 py-3 text-muted">{s.summary ? `${s.summary.total ?? 0} findings` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {canManage && (
        <form action={deleteTarget} className="mt-10">
          <input type="hidden" name="targetId" value={target.id} />
          <Button variant="danger" type="submit">
            Remove target and its scan history
          </Button>
        </form>
      )}
    </>
  );
}
