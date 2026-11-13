"use server";

import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { memberships, orgs, users } from "@/db/schema";
import { audit } from "@/lib/audit";
import { assertWithinLimit, LimitError } from "@/lib/limits";
import { createOrg, getMembership } from "@/lib/orgs";
import { getOrgContext, ORG_COOKIE, requestMeta, requireUser } from "@/lib/session";

export type ActionState = { error?: string; ok?: string } | undefined;

export async function switchOrg(formData: FormData) {
  const user = await requireUser();
  const orgId = String(formData.get("orgId") ?? "");
  if (!(await getMembership(user.id, orgId))) return;
  (await cookies()).set(ORG_COOKIE, orgId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect("/dashboard");
}

export async function createOrgAction(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const name = z.string().trim().min(2).max(60).safeParse(formData.get("name"));
  if (!name.success) return { error: "Workspace names must be 2–60 characters." };
  const org = await createOrg(user.id, name.data);
  await audit({ orgId: org.id, actorUserId: user.id, action: "org.created", subjectType: "org", subjectId: org.id });
  (await cookies()).set(ORG_COOKIE, org.id, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/dashboard");
}

export async function updateOrgSettings(_: ActionState, formData: FormData): Promise<ActionState> {
  const { user, org } = await getOrgContext("admin");
  const parsed = z
    .object({
      name: z.string().trim().min(2).max(60),
      retentionDays: z.coerce.number().int().min(7).max(365),
      aiTriageEnabled: z.boolean(),
    })
    .safeParse({
      name: formData.get("name"),
      retentionDays: formData.get("retentionDays"),
      aiTriageEnabled: formData.get("aiTriageEnabled") === "on",
    });
  if (!parsed.success) return { error: "Check the values: retention must be 7–365 days." };
  await db.update(orgs).set(parsed.data).where(eq(orgs.id, org.id));
  const { ip } = await requestMeta();
  await audit({
    orgId: org.id,
    actorUserId: user.id,
    action: "org.settings_updated",
    subjectType: "org",
    subjectId: org.id,
    ipAddress: ip,
    metadata: parsed.data,
  });
  revalidatePath("/settings");
  return { ok: "Settings saved." };
}

export async function addMember(_: ActionState, formData: FormData): Promise<ActionState> {
  const { user, org } = await getOrgContext("admin");
  const email = z.email().safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  const role = z.enum(["member", "admin"]).safeParse(formData.get("role"));
  if (!email.success || !role.success) return { error: "Enter a valid email and role." };
  try {
    await assertWithinLimit(org.id, org.plan, "seats");
  } catch (err) {
    if (err instanceof LimitError) return { error: err.message };
    throw err;
  }
  const invitee = await db.query.users.findFirst({ where: eq(users.email, email.data) });
  if (!invitee) {
    return { error: "That person needs to sign in to Patch AI once before they can be added." };
  }
  if (await getMembership(invitee.id, org.id)) return { error: "They are already a member." };
  await db.insert(memberships).values({ orgId: org.id, userId: invitee.id, role: role.data });
  await audit({
    orgId: org.id,
    actorUserId: user.id,
    action: "member.added",
    subjectType: "user",
    subjectId: invitee.id,
    metadata: { role: role.data },
  });
  revalidatePath("/settings");
  return { ok: `${email.data} added.` };
}

export async function removeMember(formData: FormData) {
  const { user, org } = await getOrgContext("admin");
  const userId = String(formData.get("userId") ?? "");
  const target = await getMembership(userId, org.id);
  if (!target || target.role === "owner") return;
  await db.delete(memberships).where(and(eq(memberships.orgId, org.id), eq(memberships.userId, userId)));
  await audit({ orgId: org.id, actorUserId: user.id, action: "member.removed", subjectType: "user", subjectId: userId });
  revalidatePath("/settings");
}
