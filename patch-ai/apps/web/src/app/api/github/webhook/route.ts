import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { githubInstallations, repos } from "@/db/schema";
import { audit } from "@/lib/audit";
import { verifyGithubSignature } from "@/lib/signatures";

interface InstallationPayload {
  action: string;
  installation: { id: number };
  repositories_removed?: { id: number }[];
}

export async function POST(request: Request) {
  const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook secret not configured" }, { status: 503 });
  const body = await request.text();
  if (!verifyGithubSignature(body, request.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const event = request.headers.get("x-github-event");
  const payload = JSON.parse(body) as InstallationPayload;
  const installationId = payload.installation?.id;
  if (!installationId) return NextResponse.json({ ok: true });
  const installation = await db.query.githubInstallations.findFirst({
    where: eq(githubInstallations.installationId, installationId),
  });
  if (!installation) return NextResponse.json({ ok: true });

  if (event === "installation" && payload.action === "deleted") {
    await db.delete(githubInstallations).where(eq(githubInstallations.installationId, installationId));
  } else if (event === "installation" && (payload.action === "suspend" || payload.action === "unsuspend")) {
    await db
      .update(githubInstallations)
      .set({ suspended: payload.action === "suspend" })
      .where(eq(githubInstallations.installationId, installationId));
  } else if (event === "installation_repositories" && payload.repositories_removed?.length) {
    await db.delete(repos).where(
      and(
        eq(repos.githubInstallationId, installationId),
        inArray(
          repos.githubRepoId,
          payload.repositories_removed.map((r) => r.id),
        ),
      ),
    );
  } else {
    return NextResponse.json({ ok: true });
  }

  await audit({
    orgId: installation.orgId,
    action: `github.${event}.${payload.action}`,
    subjectType: "github_installation",
    subjectId: String(installationId),
  });
  return NextResponse.json({ ok: true });
}
