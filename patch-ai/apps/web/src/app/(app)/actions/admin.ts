"use server";

import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { abuseReports, scans, targets } from "@/db/schema";
import { audit } from "@/lib/audit";
import { normalizeHostname } from "@/lib/net";
import { isPlatformAdmin, requestMeta, requireUser } from "@/lib/session";
import { setScansPaused } from "@/lib/settings";
import type { ActionState } from "./org";

async function requirePlatformAdmin() {
  const user = await requireUser();
  if (!isPlatformAdmin(user.email)) notFound();
  return user;
}

export async function toggleKillSwitch(formData: FormData) {
  const user = await requirePlatformAdmin();
  const { ip } = await requestMeta();
  const paused = formData.get("paused") === "true";
  await setScansPaused(paused, user.id);
  let cancelled = 0;
  if (paused && formData.get("cancelInFlight") === "on") {
    const rows = await db
      .update(scans)
      .set({ status: "cancelled", finishedAt: new Date(), error: "Stopped by the platform kill switch." })
      .where(inArray(scans.status, ["queued", "running"]))
      .returning({ id: scans.id });
    cancelled = rows.length;
  }
  await audit({
    actorUserId: user.id,
    action: paused ? "platform.scans_paused" : "platform.scans_resumed",
    ipAddress: ip,
    metadata: { cancelled },
  });
  revalidatePath("/admin");
}

export async function disableHost(_: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requirePlatformAdmin();
  const { ip } = await requestMeta();
  const hostname = normalizeHostname(String(formData.get("hostname") ?? ""));
  if (!hostname) return { error: "Enter a valid hostname." };
  const disable = formData.get("mode") !== "enable";
  const rows = await db
    .update(targets)
    .set({ disabled: disable })
    .where(eq(targets.hostname, hostname))
    .returning({ id: targets.id, orgId: targets.orgId });
  if (disable && rows.length) {
    await db
      .update(scans)
      .set({ status: "cancelled", finishedAt: new Date(), error: "Target disabled by Patch AI." })
      .where(inArray(scans.targetId, rows.map((r) => r.id)));
  }
  await audit({
    actorUserId: user.id,
    action: disable ? "platform.target_disabled" : "platform.target_enabled",
    ipAddress: ip,
    metadata: { hostname, targets: rows.map((r) => r.id), orgs: [...new Set(rows.map((r) => r.orgId))] },
  });
  revalidatePath("/admin");
  return {
    ok: rows.length
      ? `${disable ? "Disabled" : "Re-enabled"} ${hostname} in ${rows.length} workspace(s).`
      : `${hostname} is not registered as a target in any workspace.`,
  };
}

export async function setAbuseStatus(formData: FormData) {
  const user = await requirePlatformAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!["new", "investigating", "resolved"].includes(status)) return;
  await db.update(abuseReports).set({ status }).where(eq(abuseReports.id, id));
  await audit({ actorUserId: user.id, action: "abuse.status_changed", subjectType: "abuse_report", subjectId: id, metadata: { status } });
  revalidatePath("/admin");
}
