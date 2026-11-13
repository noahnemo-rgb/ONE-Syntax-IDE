import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/db";
import { githubInstallations, repos } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { UploadForm } from "@/components/upload-form";
import { Badge, ButtonLink, Card, EmptyState, Notice, PageHeader, formatDate } from "@/components/ui";
import { githubAppConfigured, listInstallationRepos, type InstallationRepo } from "@/lib/github-app";
import { getOrgContext } from "@/lib/session";
import { importGithubRepo } from "../actions/repos";

export const metadata: Metadata = { title: "Repositories" };

const githubMessages: Record<string, { tone: "success" | "error" | "warning"; text: string }> = {
  linked: { tone: "success", text: "GitHub installation linked. Import the repositories you want to scan below." },
  not_configured: { tone: "warning", text: "The GitHub App is not configured on this deployment yet. Zip upload still works." },
  invalid: { tone: "error", text: "GitHub returned an invalid installation." },
  invalid_state: { tone: "error", text: "That install link expired or belongs to another session. Try again." },
  forbidden: { tone: "error", text: "Only workspace owners and admins can link GitHub installations." },
  not_yours: { tone: "error", text: "Your GitHub account does not have access to that installation." },
  linked_elsewhere: { tone: "error", text: "That GitHub installation is already linked to a different workspace." },
};

export default async function ReposPage(props: PageProps<"/repos">) {
  const { org } = await getOrgContext();
  const { github } = await props.searchParams;
  const message = typeof github === "string" ? githubMessages[github] : undefined;

  const [rows, installations] = await Promise.all([
    db.select().from(repos).where(eq(repos.orgId, org.id)).orderBy(desc(repos.createdAt)),
    db.select().from(githubInstallations).where(eq(githubInstallations.orgId, org.id)),
  ]);
  const imported = new Set(rows.map((r) => r.githubRepoId).filter(Boolean));

  const available: { installationId: number; account: string; repos: InstallationRepo[]; error?: string }[] = [];
  if (githubAppConfigured()) {
    for (const inst of installations) {
      try {
        const list = await listInstallationRepos(inst.installationId);
        available.push({
          installationId: inst.installationId,
          account: inst.accountLogin,
          repos: list.filter((r) => !imported.has(r.id)),
        });
      } catch (err) {
        available.push({
          installationId: inst.installationId,
          account: inst.accountLogin,
          repos: [],
          error: (err as Error).message,
        });
      }
    }
  }

  return (
    <>
      <PageHeader
        title="Repositories"
        description="Source code you've authorized Patch AI to scan."
        actions={
          <ButtonLink href="/api/github/install" prefetch={false}>
            Connect GitHub
          </ButtonLink>
        }
      />
      {message && (
        <div className="mb-6">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState title="No repositories yet">
          Install the GitHub App on the repositories you choose, or upload a zip of your source code.
        </EmptyState>
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Source</th>
                <th className="px-5 py-3">Added</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-5 py-3">
                    <Link href={`/repos/${r.id}`} className="hover:text-accent">
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <Badge kind="source">{r.source === "github" ? "GitHub" : "Zip upload"}</Badge>
                  </td>
                  <td className="px-5 py-3 text-muted">{formatDate(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">Import from GitHub</h2>
          {available.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              Click <strong>Connect GitHub</strong> and choose which repositories the Patch AI app can read. Access is
              read-only, and you can revoke it from GitHub at any time.
            </p>
          ) : (
            available.map((inst) => (
              <div key={inst.installationId} className="mt-4">
                <p className="text-sm text-muted">@{inst.account}</p>
                {inst.error && <Notice tone="error">Could not list repositories: {inst.error}</Notice>}
                {inst.repos.length === 0 && !inst.error && (
                  <p className="mt-1 text-sm text-muted">All accessible repositories are imported.</p>
                )}
                <ul className="mt-2 space-y-2">
                  {inst.repos.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                      <span className="text-sm">{r.fullName}</span>
                      <ActionForm action={importGithubRepo} submitLabel="Import" variant="secondary" className="flex items-center gap-2">
                        <input type="hidden" name="installationId" value={inst.installationId} />
                        <input type="hidden" name="githubRepoId" value={r.id} />
                      </ActionForm>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </Card>
        <Card>
          <h2 className="mb-4 font-semibold">Upload a zip</h2>
          <UploadForm />
        </Card>
      </div>
    </>
  );
}
