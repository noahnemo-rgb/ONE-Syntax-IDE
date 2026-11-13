import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { repos, uploads } from "@/db/schema";
import { audit } from "@/lib/audit";
import { assertWithinLimit, LimitError } from "@/lib/limits";
import { enqueueCodeScan, ScanRequestError } from "@/lib/scans";
import { getApiOrgContext, HttpError, requestMeta } from "@/lib/session";
import { checkZipArchive, MAX_UPLOAD_BYTES, sanitizeProjectName } from "@/lib/uploads";

export async function POST(request: Request) {
  try {
    const { user, org } = await getApiOrgContext("member");
    const length = Number(request.headers.get("content-length") ?? 0);
    if (length > MAX_UPLOAD_BYTES + 64 * 1024) {
      return NextResponse.json({ error: "Archive too large." }, { status: 413 });
    }
    const form = await request.formData();
    const file = form.get("archive");
    if (!(file instanceof File)) return NextResponse.json({ error: "Attach a .zip file." }, { status: 400 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkZipArchive(bytes);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });

    const existingRepoId = form.get("repoId");
    let repoId: string;
    if (typeof existingRepoId === "string" && existingRepoId) {
      const repo = await db.query.repos.findFirst({
        where: and(eq(repos.id, existingRepoId), eq(repos.orgId, org.id), eq(repos.source, "upload")),
      });
      if (!repo) return NextResponse.json({ error: "Project not found." }, { status: 404 });
      repoId = repo.id;
    } else {
      await assertWithinLimit(org.id, org.plan, "repos");
      const name = sanitizeProjectName(String(form.get("name") ?? ""), file.name.replace(/\.zip$/i, ""));
      const [repo] = await db.insert(repos).values({ orgId: org.id, source: "upload", name }).returning();
      repoId = repo.id;
    }

    const buffer = Buffer.from(bytes);
    const [upload] = await db
      .insert(uploads)
      .values({
        orgId: org.id,
        repoId,
        filename: file.name.slice(0, 200),
        sizeBytes: buffer.length,
        sha256: createHash("sha256").update(buffer).digest("hex"),
        data: buffer,
      })
      .returning({ id: uploads.id });

    const { ip } = await requestMeta();
    await audit({
      orgId: org.id,
      actorUserId: user.id,
      action: "upload.created",
      subjectType: "upload",
      subjectId: upload.id,
      ipAddress: ip,
      metadata: { repoId, bytes: buffer.length },
    });

    const scan = await enqueueCodeScan({ org, userId: user.id, repoId, ip });
    return NextResponse.json({ repoId, scanId: scan.id });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof LimitError || err instanceof ScanRequestError) {
      return NextResponse.json({ error: err.message }, { status: 402 });
    }
    throw err;
  }
}
