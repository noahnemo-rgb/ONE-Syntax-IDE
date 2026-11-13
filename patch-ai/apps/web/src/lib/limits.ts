import { and, count, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/db";
import { memberships, repos, scans, targets } from "@/db/schema";
import { PLANS, type Plan } from "./plans";

export function startOfMonthUtc(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function usageForOrg(orgId: string) {
  const [[repoCount], [targetCount], [seatCount], [scanCount], [inFlight]] = await Promise.all([
    db.select({ n: count() }).from(repos).where(eq(repos.orgId, orgId)),
    db.select({ n: count() }).from(targets).where(eq(targets.orgId, orgId)),
    db.select({ n: count() }).from(memberships).where(eq(memberships.orgId, orgId)),
    db
      .select({ n: count() })
      .from(scans)
      .where(and(eq(scans.orgId, orgId), gte(scans.createdAt, startOfMonthUtc()))),
    db
      .select({ n: count() })
      .from(scans)
      .where(and(eq(scans.orgId, orgId), inArray(scans.status, ["queued", "running"]))),
  ]);
  return {
    repos: repoCount.n,
    targets: targetCount.n,
    seats: seatCount.n,
    scansThisMonth: scanCount.n,
    scansInFlight: inFlight.n,
  };
}

export type LimitKey = "repos" | "liveTargets" | "seats" | "scansPerMonth";

export class LimitError extends Error {}

export async function assertWithinLimit(orgId: string, plan: Plan, key: LimitKey) {
  const limits = PLANS[plan];
  const usage = await usageForOrg(orgId);
  const used = {
    repos: usage.repos,
    liveTargets: usage.targets,
    seats: usage.seats,
    scansPerMonth: usage.scansThisMonth,
  }[key];
  const limit = limits[key];
  if (used >= limit) {
    const what = {
      repos: "repositories",
      liveTargets: "live targets",
      seats: "seats",
      scansPerMonth: "scans this month",
    }[key];
    throw new LimitError(
      limit === 0
        ? `The ${limits.label} plan does not include ${what}. Upgrade to continue.`
        : `The ${limits.label} plan allows ${limit} ${what}. Upgrade to continue.`,
    );
  }
}

/** Per-org cap on queued+running scans so one customer cannot monopolize workers. */
export const MAX_IN_FLIGHT_SCANS = 3;
