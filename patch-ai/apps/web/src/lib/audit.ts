import { db } from "@/db";
import { auditLog } from "@/db/schema";

export interface AuditEntry {
  orgId?: string | null;
  actorUserId?: string | null;
  action: string;
  subjectType?: string;
  subjectId?: string;
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
}

export async function audit(entry: AuditEntry) {
  await db.insert(auditLog).values({
    orgId: entry.orgId ?? null,
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    subjectType: entry.subjectType,
    subjectId: entry.subjectId,
    ipAddress: entry.ipAddress ?? null,
    metadata: entry.metadata,
  });
}
