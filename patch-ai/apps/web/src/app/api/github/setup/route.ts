import { NextResponse } from "next/server";
import { db } from "@/db";
import { githubInstallations } from "@/db/schema";
import { audit } from "@/lib/audit";
import {
  getInstallationAccount,
  userCanAccessInstallation,
  verifyInstallState,
} from "@/lib/github-app";
import { getMembership, roleAtLeast } from "@/lib/orgs";
import { getUser, requestMeta } from "@/lib/session";

/** GitHub redirects here ("Setup URL") after the app is installed or its repo selection changes. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (status: string) => NextResponse.redirect(new URL(`/repos?github=${status}`, request.url));

  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const installationId = Number(url.searchParams.get("installation_id"));
  const state = verifyInstallState(url.searchParams.get("state") ?? "");
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return back("invalid");
  if (!state || state.userId !== user.id) return back("invalid_state");

  const membership = await getMembership(user.id, state.orgId);
  if (!membership || !roleAtLeast(membership.role, "admin")) return back("forbidden");
  if (!(await userCanAccessInstallation(user.id, installationId))) return back("not_yours");

  const existing = await db.query.githubInstallations.findFirst({
    where: (t, { eq }) => eq(t.installationId, installationId),
  });
  if (existing && existing.orgId !== state.orgId) return back("linked_elsewhere");

  const account = await getInstallationAccount(installationId);
  await db
    .insert(githubInstallations)
    .values({
      installationId,
      orgId: state.orgId,
      accountLogin: account.login,
      suspended: account.suspended,
    })
    .onConflictDoUpdate({
      target: githubInstallations.installationId,
      set: { accountLogin: account.login, suspended: account.suspended },
    });

  const { ip } = await requestMeta();
  await audit({
    orgId: state.orgId,
    actorUserId: user.id,
    action: "github.installation_linked",
    subjectType: "github_installation",
    subjectId: String(installationId),
    ipAddress: ip,
    metadata: { account: account.login },
  });
  return back("linked");
}
