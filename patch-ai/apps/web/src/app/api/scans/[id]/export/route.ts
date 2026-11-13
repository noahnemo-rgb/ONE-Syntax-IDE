import { getScanWithSubject, scanFindings, subjectName } from "@/lib/findings";
import { HttpError, getApiOrgContext } from "@/lib/session";

export async function GET(_req: Request, ctx: RouteContext<"/api/scans/[id]/export">) {
  try {
    const { id } = await ctx.params;
    const { org } = await getApiOrgContext();
    const row = await getScanWithSubject(id, org.id);
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });
    const list = await scanFindings(id, org.id);
    const { scan } = row;
    const body = {
      schema: "patchai.scan.v1",
      scan: {
        id: scan.id,
        kind: scan.kind,
        profile: scan.profile,
        status: scan.status,
        subject: subjectName(row),
        commitSha: scan.commitSha,
        createdAt: scan.createdAt,
        startedAt: scan.startedAt,
        finishedAt: scan.finishedAt,
        summary: scan.summary,
      },
      findings: list.map((f) => ({
        id: f.id,
        fingerprint: f.fingerprint,
        title: f.title,
        ruleId: f.ruleId,
        tools: f.tools,
        category: f.category,
        severity: f.severity,
        cwe: f.cwe,
        filePath: f.filePath,
        startLine: f.startLine,
        endLine: f.endLine,
        url: f.url,
        packageName: f.packageName,
        installedVersion: f.installedVersion,
        fixedVersion: f.fixedVersion,
        description: f.description,
        status: f.status,
        ai: f.aiVerdict
          ? {
              verdict: f.aiVerdict,
              confidence: f.aiConfidence,
              severity: f.aiSeverity,
              explanation: f.aiExplanation,
              fixDiff: f.aiFixDiff,
            }
          : null,
      })),
    };
    return new Response(JSON.stringify(body, null, 2), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="patchai-scan-${scan.id}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
