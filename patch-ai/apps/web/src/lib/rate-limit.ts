import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";

/**
 * Fixed-window limit counted from the append-only audit log, so every limited
 * action is also recorded. Callers must audit the action after it is allowed.
 */
export async function withinRateLimit(opts: {
  action: string;
  orgId?: string | null;
  ipAddress?: string | null;
  max: number;
  windowSeconds: number;
}): Promise<boolean> {
  const since = new Date(Date.now() - opts.windowSeconds * 1000);
  const conditions = [eq(auditLog.action, opts.action), gte(auditLog.createdAt, since)];
  if (opts.orgId) conditions.push(eq(auditLog.orgId, opts.orgId));
  if (opts.ipAddress) conditions.push(eq(auditLog.ipAddress, opts.ipAddress));
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(and(...conditions));
  return (row?.n ?? 0) < opts.max;
}
