import { eq } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";

/** Platform-wide emergency stop. The env var wins so ops can stop scans without DB access. */
export async function scansPaused(): Promise<boolean> {
  if (process.env.PATCHAI_KILL_SWITCH === "true") return true;
  const row = await db.query.systemSettings.findFirst({
    where: eq(systemSettings.key, "scans_paused"),
  });
  return row?.value === true;
}

export async function setScansPaused(paused: boolean, userId: string) {
  await db
    .insert(systemSettings)
    .values({ key: "scans_paused", value: paused, updatedBy: userId })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: paused, updatedBy: userId, updatedAt: new Date() },
    });
}
