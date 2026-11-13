"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { githubInstallations, repos, scans } from "@/db/schema";
import { audit } from "@/lib/audit";
import { listInstallationRepos } from "@/lib/github-app";
import { assertWithinLimit, LimitError } from "@/lib/limits";
import { enqueueCodeScan, enqueueWebScan, ScanRequestError } from "@/lib/scans";
import { getOrgContext, requestMeta } from "@/lib/session";
import type { ActionState } from "./org";

export async function importGithubRepo(_: ActionState, formData: FormData): Promise<ActionState> {
  const { user, org } = await getOrgContext("admin");
  const installationId = Number(formData.get("installationId"));
  const githubRepoId = Number(formData.get("githubRepoId"));
  const installation = await db.query.githubInstallations.findFirst({
    where: and(
      eq(githubInstallations.installationId, installationId),
      eq(githubInstallations.orgId, org.id),
    ),
  });
  if (!installation) return { error: "That GitHub installation is not linked to this workspace." };
  if (installation.suspended) return { error: "That GitHub installation is suspended." };

  const available = await listInstallationRepos(installationId);
  const repo = available.find((r) => r.id === githubRepoId);
  if (!repo) return { error: "The GitHub App does not have access to that repository." };

  try {
    await assertWithinLimit(org.id, org.plan, "repos");
  } catch (err) {
    if (err instanceof LimitError) return { error: err.message };
    throw err;
  }
  const [row] = await db
    .insert(repos)
    .values({
      orgId: org.id,
      source: "github",
      name: repo.fullName,
      githubInstallationId: installationId,
      githubRepoId: repo.id,
      defaultBranch: repo.defaultBranch,
      isPrivate: repo.isPrivate,
    })
    .onConflictDoNothing()
    .returning();
  if (row) {
    await audit({
      orgId: org.id,
      actorUserId: user.id,
      action: "repo.imported",
      subjectType: "repo",
      subjectId: row.id,
      metadata: { fullName: repo.fullName },
    });
  }
  revalidatePath("/repos");
  return { ok: `${repo.fullName} imported.` };
}

export async function deleteRepo(formData: FormData) {
  const { user, org } = await getOrgContext("admin");
  const repoId = String(formData.get("repoId") ?? "");
  const deleted = await db
    .delete(repos)
    .where(and(eq(repos.id, repoId), eq(repos.orgId, org.id)))
    .returning({ id: repos.id, name: repos.name });
  if (deleted.length) {
    await audit({
      orgId: org.id,
      actorUserId: user.id,
      action: "repo.deleted",
      subjectType: "repo",
      subjectId: repoId,
      metadata: { name: deleted[0].name },
    });
  }
  redirect("/repos");
}

export async function startCodeScan(_: ActionState, formData: FormData): Promise<ActionState> {
  const { user, org } = await getOrgContext("member");
  const { ip } = await requestMeta();
  let scanId: string;
  try {
    const scan = await enqueueCodeScan({ org, userId: user.id, repoId: String(formData.get("repoId")), ip });
    scanId = scan.id;
  } catch (err) {
    if (err instanceof ScanRequestError) return { error: err.message };
    throw err;
  }
  redirect(`/scans/${scanId}`);
}

export async function startWebScan(_: ActionState, formData: FormData): Promise<ActionState> {
  const { user, org } = await getOrgContext("member");
  const { ip } = await requestMeta();
  let scanId: string;
  try {
    const scan = await enqueueWebScan({ org, userId: user.id, targetId: String(formData.get("targetId")), ip });
    scanId = scan.id;
  } catch (err) {
    if (err instanceof ScanRequestError) return { error: err.message };
    throw err;
  }
  redirect(`/scans/${scanId}`);
}

export async function cancelScan(formData: FormData) {
  const { user, org } = await getOrgContext("member");
  const scanId = String(formData.get("scanId") ?? "");
  const updated = await db
    .update(scans)
    .set({ status: "cancelled", finishedAt: new Date(), error: "Cancelled by user" })
    .where(and(eq(scans.id, scanId), eq(scans.orgId, org.id), inArray(scans.status, ["queued", "running"])))
    .returning({ id: scans.id });
  if (updated.length) {
    await audit({ orgId: org.id, actorUserId: user.id, action: "scan.cancelled", subjectType: "scan", subjectId: scanId });
  }
  revalidatePath(`/scans/${scanId}`);
}
