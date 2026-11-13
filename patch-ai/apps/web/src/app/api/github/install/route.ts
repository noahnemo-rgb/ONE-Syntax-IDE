import { NextResponse } from "next/server";
import { githubAppConfigured, installUrl, signInstallState } from "@/lib/github-app";
import { getApiOrgContext, HttpError } from "@/lib/session";

export async function GET(request: Request) {
  try {
    const { user, org } = await getApiOrgContext("admin");
    if (!githubAppConfigured()) {
      return NextResponse.redirect(new URL("/repos?github=not_configured", request.url));
    }
    return NextResponse.redirect(installUrl(signInstallState(org.id, user.id)));
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
