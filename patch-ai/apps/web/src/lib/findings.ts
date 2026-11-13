import { and, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { findings, repos, scans, targets } from "@/db/schema";
import { SEVERITY_ORDER } from "./scans";

export const CATEGORY_LABELS: Record<string, string> = {
  sast: "Code",
  dependency: "Dependency",
  secret: "Secret",
  iac: "Infrastructure",
  web: "Live target",
};

export interface FindingFilters {
  severity?: string;
  category?: string;
  verdict?: string;
  status?: string;
}

export function parseFilters(params: Record<string, string | string[] | undefined>): FindingFilters {
  const pick = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  return { severity: pick("severity"), category: pick("category"), verdict: pick("verdict"), status: pick("status") };
}

const severityRank = sql`array_position(ARRAY['critical','high','medium','low','info']::severity[], coalesce(${findings.aiSeverity}, ${findings.severity}))`;

export async function scanFindings(scanId: string, orgId: string, filters: FindingFilters = {}) {
  const conditions: SQL[] = [eq(findings.scanId, scanId), eq(findings.orgId, orgId)];
  if (filters.severity && (SEVERITY_ORDER as readonly string[]).includes(filters.severity)) {
    conditions.push(sql`coalesce(${findings.aiSeverity}, ${findings.severity}) = ${filters.severity}::severity`);
  }
  if (filters.category && filters.category in CATEGORY_LABELS) {
    conditions.push(sql`${findings.category} = ${filters.category}::finding_category`);
  }
  if (filters.verdict === "untriaged") conditions.push(sql`${findings.aiVerdict} is null`);
  else if (filters.verdict && ["true_positive", "false_positive", "needs_review"].includes(filters.verdict)) {
    conditions.push(sql`${findings.aiVerdict} = ${filters.verdict}::ai_verdict`);
  }
  if (filters.status && ["open", "dismissed", "fixed"].includes(filters.status)) {
    conditions.push(sql`${findings.status} = ${filters.status}::finding_status`);
  }
  return db
    .select()
    .from(findings)
    .where(and(...conditions))
    .orderBy(severityRank, findings.category, findings.filePath, findings.startLine);
}

export async function getScanWithSubject(scanId: string, orgId: string) {
  const [row] = await db
    .select({ scan: scans, repo: repos, target: targets })
    .from(scans)
    .leftJoin(repos, eq(repos.id, scans.repoId))
    .leftJoin(targets, eq(targets.id, scans.targetId))
    .where(and(eq(scans.id, scanId), eq(scans.orgId, orgId)));
  return row ?? null;
}

export function effectiveSeverity(f: { severity: string; aiSeverity: string | null }) {
  return f.aiSeverity ?? f.severity;
}

export function subjectName(row: NonNullable<Awaited<ReturnType<typeof getScanWithSubject>>>) {
  return row.repo?.name ?? row.target?.hostname ?? "Deleted subject";
}
