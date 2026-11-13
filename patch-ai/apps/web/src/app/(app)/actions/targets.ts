"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { attestations, targets } from "@/db/schema";
import { attestationStatement, ATTESTATION_VERSION } from "@/lib/attestation";
import { audit } from "@/lib/audit";
import { assertWithinLimit, LimitError } from "@/lib/limits";
import { normalizeHostname, resolvePublicAddresses } from "@/lib/net";
import { PLANS } from "@/lib/plans";
import { withinRateLimit } from "@/lib/rate-limit";
import { getOrgContext, requestMeta } from "@/lib/session";
import { newVerificationToken, VERIFICATION_TTL_DAYS, verifyOwnership } from "@/lib/verification";
import type { ActionState } from "./org";

async function ownTarget(orgId: string, targetId: string) {
  return db.query.targets.findFirst({ where: and(eq(targets.id, targetId), eq(targets.orgId, orgId)) });
}

export async function addTarget(_: ActionState, formData: FormData): Promise<ActionState> {
  const { user, org } = await getOrgContext("admin");
  const { ip } = await requestMeta();
  const hostname = normalizeHostname(String(formData.get("hostname") ?? ""));
  if (!hostname) {
    return { error: "Enter a public hostname such as app.example.com. IP addresses and internal names are not accepted." };
  }
  try {
    await assertWithinLimit(org.id, org.plan, "liveTargets");
  } catch (err) {
    if (err instanceof LimitError) return { error: err.message };
    throw err;
  }
  try {
    await resolvePublicAddresses(hostname);
  } catch (err) {
    return { error: (err as Error).message };
  }
  const existing = await db.query.targets.findFirst({
    where: and(eq(targets.orgId, org.id), eq(targets.hostname, hostname)),
  });
  if (existing) redirect(`/targets/${existing.id}`);

  const [target] = await db
    .insert(targets)
    .values({ orgId: org.id, hostname, verificationToken: newVerificationToken() })
    .returning();
  await audit({
    orgId: org.id,
    actorUserId: user.id,
    action: "target.created",
    subjectType: "target",
    subjectId: target.id,
    ipAddress: ip,
    metadata: { hostname },
  });
  redirect(`/targets/${target.id}`);
}

export async function verifyTarget(_: ActionState, formData: FormData): Promise<ActionState> {
  const { user, org } = await getOrgContext("admin");
  const { ip } = await requestMeta();
  const target = await ownTarget(org.id, String(formData.get("targetId") ?? ""));
  if (!target) return { error: "Target not found." };
  if (!(await withinRateLimit({ action: "target.verify_attempt", orgId: org.id, max: 20, windowSeconds: 600 }))) {
    return { error: "Too many verification attempts. Wait a few minutes and try again." };
  }
  await audit({
    orgId: org.id,
    actorUserId: user.id,
    action: "target.verify_attempt",
    subjectType: "target",
    subjectId: target.id,
    ipAddress: ip,
  });
  const result = await verifyOwnership(target.hostname, target.verificationToken);
  if (!result.ok) return { error: `Verification failed: ${result.reason}.` };

  const now = new Date();
  await db
    .update(targets)
    .set({
      verificationMethod: result.method,
      verifiedAt: now,
      verificationExpiresAt: new Date(now.getTime() + VERIFICATION_TTL_DAYS * 86_400_000),
    })
    .where(eq(targets.id, target.id));
  await audit({
    orgId: org.id,
    actorUserId: user.id,
    action: "target.verified",
    subjectType: "target",
    subjectId: target.id,
    ipAddress: ip,
    metadata: { hostname: target.hostname, method: result.method },
  });
  revalidatePath(`/targets/${target.id}`);
  return { ok: `Verified ${target.hostname} using ${result.method === "dns" ? "the DNS TXT record" : "the well-known file"}.` };
}

const attestSchema = z.object({
  targetId: z.string().uuid(),
  profile: z.enum(["passive", "active"]),
  signerName: z.string().trim().min(2).max(120),
  signerTitle: z.string().trim().max(120).optional(),
  agree: z.literal("on"),
});

export async function signAttestation(_: ActionState, formData: FormData): Promise<ActionState> {
  const { user, org } = await getOrgContext("admin");
  const { ip, userAgent } = await requestMeta();
  const parsed = attestSchema.safeParse({
    targetId: formData.get("targetId"),
    profile: formData.get("profile"),
    signerName: formData.get("signerName"),
    signerTitle: formData.get("signerTitle") || undefined,
    agree: formData.get("agree"),
  });
  if (!parsed.success) return { error: "Enter your full name and tick the confirmation box." };
  const { targetId, profile, signerName, signerTitle } = parsed.data;
  const target = await ownTarget(org.id, targetId);
  if (!target) return { error: "Target not found." };
  if (profile === "active" && !PLANS[org.plan].activeWebScans) {
    return { error: "Active scanning requires the Team plan or higher." };
  }
  const statement = attestationStatement(profile, target.hostname, org.name);
  const [row] = await db
    .insert(attestations)
    .values({
      orgId: org.id,
      targetId: target.id,
      userId: user.id,
      profile,
      statement: `[${ATTESTATION_VERSION}] ${statement}`,
      signerName,
      signerTitle,
      ipAddress: ip,
      userAgent,
    })
    .returning();
  await db.update(targets).set({ profile }).where(eq(targets.id, target.id));
  await audit({
    orgId: org.id,
    actorUserId: user.id,
    action: "target.attested",
    subjectType: "target",
    subjectId: target.id,
    ipAddress: ip,
    // The full statement is kept here too: the audit log outlives the target row.
    metadata: {
      profile,
      attestationId: row.id,
      hostname: target.hostname,
      statement: row.statement,
      signerName,
      signerTitle: signerTitle ?? null,
      userAgent,
    },
  });
  revalidatePath(`/targets/${target.id}`);
  return { ok: `Authorization recorded. ${profile === "active" ? "Active" : "Passive"} scans are now enabled.` };
}

export async function setTargetProfile(formData: FormData) {
  const { user, org } = await getOrgContext("admin");
  const target = await ownTarget(org.id, String(formData.get("targetId") ?? ""));
  const profile = formData.get("profile") === "active" ? "active" : "passive";
  if (!target) return;
  if (profile === "active" && !PLANS[org.plan].activeWebScans) return;
  await db.update(targets).set({ profile }).where(eq(targets.id, target.id));
  await audit({
    orgId: org.id,
    actorUserId: user.id,
    action: "target.profile_changed",
    subjectType: "target",
    subjectId: target.id,
    metadata: { profile },
  });
  revalidatePath(`/targets/${target.id}`);
}

export async function deleteTarget(formData: FormData) {
  const { user, org } = await getOrgContext("admin");
  const target = await ownTarget(org.id, String(formData.get("targetId") ?? ""));
  if (!target) return;
  await db.delete(targets).where(eq(targets.id, target.id));
  await audit({
    orgId: org.id,
    actorUserId: user.id,
    action: "target.deleted",
    subjectType: "target",
    subjectId: target.id,
    metadata: { hostname: target.hostname },
  });
  redirect("/targets");
}
