"use server";

import { z } from "zod";
import { db } from "@/db";
import { abuseReports } from "@/db/schema";
import { audit } from "@/lib/audit";
import { withinRateLimit } from "@/lib/rate-limit";
import { requestMeta } from "@/lib/session";

type State = { error?: string; ok?: string } | undefined;

const schema = z.object({
  reporterEmail: z.email().max(200),
  affectedHost: z.string().trim().min(3).max(253),
  sourceIp: z.string().trim().max(100).optional(),
  observedAt: z.string().trim().max(100).optional(),
  description: z.string().trim().min(10).max(5000),
});

export async function submitAbuseReport(_: State, formData: FormData): Promise<State> {
  // Bots fill every field; people never see this one.
  if (formData.get("website")) return { ok: "Thanks, your report was received." };
  const { ip } = await requestMeta();
  if (!(await withinRateLimit({ action: "abuse.reported", ipAddress: ip ?? "unknown", max: 5, windowSeconds: 3600 }))) {
    return { error: "Too many reports from your network. Email us instead." };
  }
  const parsed = schema.safeParse({
    reporterEmail: String(formData.get("reporterEmail") ?? "").trim(),
    affectedHost: formData.get("affectedHost"),
    sourceIp: formData.get("sourceIp") || undefined,
    observedAt: formData.get("observedAt") || undefined,
    description: formData.get("description"),
  });
  if (!parsed.success) return { error: "Please include your email, the affected host and a short description." };
  const [row] = await db.insert(abuseReports).values(parsed.data).returning({ id: abuseReports.id });
  await audit({
    action: "abuse.reported",
    subjectType: "abuse_report",
    subjectId: row.id,
    ipAddress: ip ?? "unknown",
    metadata: { affectedHost: parsed.data.affectedHost },
  });
  return { ok: `Thanks, your report was received (reference ${row.id.slice(0, 8)}). We review reports within one business day.` };
}
