"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { findings } from "@/db/schema";
import { audit } from "@/lib/audit";
import { getOrgContext } from "@/lib/session";

const STATUSES = ["open", "dismissed", "fixed"] as const;

export async function setFindingStatus(formData: FormData) {
  const { user, org } = await getOrgContext("member");
  const findingId = String(formData.get("findingId") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) return;
  const updated = await db
    .update(findings)
    .set({ status: status as (typeof STATUSES)[number] })
    .where(and(eq(findings.id, findingId), eq(findings.orgId, org.id)))
    .returning({ id: findings.id, scanId: findings.scanId });
  if (!updated.length) return;
  await audit({
    orgId: org.id,
    actorUserId: user.id,
    action: `finding.${status}`,
    subjectType: "finding",
    subjectId: findingId,
  });
  revalidatePath(`/findings/${findingId}`);
  revalidatePath(`/scans/${updated[0].scanId}`);
}
