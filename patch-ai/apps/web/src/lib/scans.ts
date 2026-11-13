import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { attestations, orgs, repos, scans, targets, uploads } from "@/db/schema";
import { audit } from "./audit";
import { assertWithinLimit, LimitError, MAX_IN_FLIGHT_SCANS, usageForOrg } from "./limits";
import { PLANS } from "./plans";
import { scansPaused } from "./settings";
import { isVerificationCurrent } from "./verification";

type Org = typeof orgs.$inferSelect;

export class ScanRequestError extends Error {}

async function commonChecks(org: Org) {
  if (await scansPaused()) {
    throw new ScanRequestError("Scanning is temporarily paused by the platform operators.");
  }
  try {
    await assertWithinLimit(org.id, org.plan, "scansPerMonth");
  } catch (err) {
    if (err instanceof LimitError) throw new ScanRequestError(err.message);
    throw err;
  }
  const usage = await usageForOrg(org.id);
  if (usage.scansInFlight >= MAX_IN_FLIGHT_SCANS) {
    throw new ScanRequestError(
      `You already have ${usage.scansInFlight} scans queued or running. Wait for one to finish.`,
    );
  }
}

export async function enqueueCodeScan(opts: {
  org: Org;
  userId: string;
  repoId: string;
  ip: string | null;
}) {
  const { org, userId, repoId, ip } = opts;
  const repo = await db.query.repos.findFirst({
    where: and(eq(repos.id, repoId), eq(repos.orgId, org.id)),
  });
  if (!repo) throw new ScanRequestError("Repository not found.");
  await commonChecks(org);

  let uploadId: string | null = null;
  if (repo.source === "upload") {
    const latest = await db.query.uploads.findFirst({
      where: eq(uploads.repoId, repo.id),
      orderBy: desc(uploads.createdAt),
    });
    if (!latest?.data) {
      throw new ScanRequestError("Upload a new archive to scan this project again.");
    }
    uploadId = latest.id;
  }

  const [scan] = await db
    .insert(scans)
    .values({
      orgId: org.id,
      kind: "code",
      repoId: repo.id,
      uploadId,
      ref: repo.defaultBranch,
      requestedBy: userId,
    })
    .returning();
  await audit({
    orgId: org.id,
    actorUserId: userId,
    action: "scan.requested",
    subjectType: "scan",
    subjectId: scan.id,
    ipAddress: ip,
    metadata: { kind: "code", repo: repo.name },
  });
  return scan;
}

export async function enqueueWebScan(opts: {
  org: Org;
  userId: string;
  targetId: string;
  ip: string | null;
}) {
  const { org, userId, targetId, ip } = opts;
  const target = await db.query.targets.findFirst({
    where: and(eq(targets.id, targetId), eq(targets.orgId, org.id)),
  });
  if (!target) throw new ScanRequestError("Target not found.");
  if (target.disabled) throw new ScanRequestError("This target has been disabled.");
  if (!isVerificationCurrent(target)) {
    throw new ScanRequestError("Verify ownership of this domain before scanning it.");
  }
  if (target.profile === "active" && !PLANS[org.plan].activeWebScans) {
    throw new ScanRequestError("Active scanning requires the Team plan or higher.");
  }
  const attestation = await db.query.attestations.findFirst({
    where: and(eq(attestations.targetId, target.id), eq(attestations.profile, target.profile)),
    orderBy: desc(attestations.createdAt),
  });
  if (!attestation) {
    throw new ScanRequestError(
      `Sign the authorization attestation for ${target.profile} scanning before starting a scan.`,
    );
  }
  const running = await db.query.scans.findFirst({
    where: and(eq(scans.targetId, target.id), inArray(scans.status, ["queued", "running"])),
  });
  if (running) throw new ScanRequestError("A scan of this target is already in progress.");
  await commonChecks(org);

  const [scan] = await db
    .insert(scans)
    .values({
      orgId: org.id,
      kind: "web",
      targetId: target.id,
      profile: target.profile,
      requestedBy: userId,
    })
    .returning();
  await audit({
    orgId: org.id,
    actorUserId: userId,
    action: "scan.requested",
    subjectType: "scan",
    subjectId: scan.id,
    ipAddress: ip,
    metadata: {
      kind: "web",
      hostname: target.hostname,
      profile: target.profile,
      attestationId: attestation.id,
    },
  });
  return scan;
}

export const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];
