import "server-only";
import { App } from "@octokit/app";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts } from "@/db/schema";

export function githubAppConfigured(): boolean {
  return Boolean(
    process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY && process.env.GITHUB_APP_SLUG,
  );
}

let app: App | undefined;
export function getGithubApp(): App {
  if (!githubAppConfigured()) throw new Error("GitHub App is not configured");
  app ??= new App({
    appId: process.env.GITHUB_APP_ID!,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n"),
    webhooks: { secret: process.env.GITHUB_APP_WEBHOOK_SECRET ?? "unset" },
  });
  return app;
}

export { signInstallState, verifyInstallState } from "./signatures";

export function installUrl(state: string): string {
  return `https://github.com/apps/${process.env.GITHUB_APP_SLUG}/installations/new?state=${encodeURIComponent(state)}`;
}

/**
 * GitHub's setup redirect can be forged, so we only trust an installation ID
 * that appears in the signed-in user's own installation list.
 */
export async function userCanAccessInstallation(userId: string, installationId: number): Promise<boolean> {
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.userId, userId), eq(accounts.provider, "github")),
  });
  if (!account?.access_token) return false;
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(`https://api.github.com/user/installations?per_page=100&page=${page}`, {
      headers: {
        authorization: `Bearer ${account.access_token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { installations: { id: number }[] };
    if (body.installations.some((i) => i.id === installationId)) return true;
    if (body.installations.length < 100) return false;
  }
  return false;
}

export async function getInstallationAccount(installationId: number) {
  const { data } = await getGithubApp().octokit.request("GET /app/installations/{installation_id}", {
    installation_id: installationId,
  });
  const account = data.account as { login?: string; slug?: string } | null;
  return { login: account?.login ?? account?.slug ?? "unknown", suspended: Boolean(data.suspended_at) };
}

export interface InstallationRepo {
  id: number;
  fullName: string;
  defaultBranch: string;
  isPrivate: boolean;
}

export async function listInstallationRepos(installationId: number): Promise<InstallationRepo[]> {
  const octokit = await getGithubApp().getInstallationOctokit(installationId);
  const repos: InstallationRepo[] = [];
  for (let page = 1; page <= 10; page++) {
    const { data } = await octokit.request("GET /installation/repositories", { per_page: 100, page });
    for (const r of data.repositories) {
      repos.push({ id: Number(r.id), fullName: r.full_name, defaultBranch: r.default_branch, isPrivate: r.private });
    }
    if (data.repositories.length < 100) break;
  }
  return repos;
}
