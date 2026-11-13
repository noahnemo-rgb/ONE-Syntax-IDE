import "server-only";
import { eq } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { orgs, users } from "@/db/schema";
import { auth } from "./auth";
import { listUserOrgs, roleAtLeast, type Role } from "./orgs";

export const ORG_COOKIE = "patchai_org";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getUser() {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;
  return (await db.query.users.findFirst({ where: eq(users.id, id) })) ?? null;
}

export async function requireUser() {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Resolves the active organization from the org cookie, falling back to the
 * user's first membership. Membership is always re-checked against the DB.
 */
export async function getOrgContext(minRole: Role = "member") {
  const user = await requireUser();
  const memberships = await listUserOrgs(user.id);
  if (memberships.length === 0) redirect("/login");
  const wanted = (await cookies()).get(ORG_COOKIE)?.value;
  const current = memberships.find((m) => m.id === wanted) ?? memberships[0];
  if (!roleAtLeast(current.role, minRole)) {
    throw new HttpError(403, `This action requires the ${minRole} role.`);
  }
  const org = (await db.query.orgs.findFirst({ where: eq(orgs.id, current.id) }))!;
  return { user, org, role: current.role as Role, memberships };
}

/** Same as getOrgContext but returns null instead of redirecting (for route handlers). */
export async function getApiOrgContext(minRole: Role = "member") {
  const session = await auth();
  if (!session?.user?.id) throw new HttpError(401, "Sign in required.");
  return getOrgContext(minRole);
}

export async function requestMeta() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: forwarded || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent"),
  };
}

export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  const admins = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(email.toLowerCase());
}
