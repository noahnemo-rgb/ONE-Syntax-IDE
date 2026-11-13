import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, orgs } from "@/db/schema";

export type Role = "owner" | "admin" | "member";
const ROLE_RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 };

export function roleAtLeast(role: Role, required: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "workspace";
}

export async function createOrg(userId: string, name: string) {
  const slug = `${slugify(name)}-${crypto.randomUUID().slice(0, 6)}`;
  return db.transaction(async (tx) => {
    const [org] = await tx.insert(orgs).values({ name, slug }).returning();
    await tx.insert(memberships).values({ orgId: org.id, userId, role: "owner" });
    return org;
  });
}

/** Every user gets a personal workspace on first sign-in. */
export async function ensurePersonalOrg(userId: string, displayName: string) {
  const existing = await db.query.memberships.findFirst({
    where: eq(memberships.userId, userId),
  });
  if (existing) return;
  await createOrg(userId, `${displayName}'s workspace`);
}

export async function listUserOrgs(userId: string) {
  return db
    .select({ id: orgs.id, name: orgs.name, slug: orgs.slug, plan: orgs.plan, role: memberships.role })
    .from(memberships)
    .innerJoin(orgs, eq(orgs.id, memberships.orgId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt));
}

export async function getMembership(userId: string, orgId: string) {
  return db.query.memberships.findFirst({
    where: and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)),
  });
}
