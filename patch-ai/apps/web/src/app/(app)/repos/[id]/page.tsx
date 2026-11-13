import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { repos, scans } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { UploadForm } from "@/components/upload-form";
import { Badge, Button, Card, EmptyState, PageHeader, formatDate } from "@/components/ui";
import { getOrgContext } from "@/lib/session";
import { deleteRepo, startCodeScan } from "../../actions/repos";

export default async function RepoPage(props: PageProps<"/repos/[id]">) {
  const { id } = await props.params;
  const { org, role } = await getOrgContext();
  const repo = await db.query.repos.findFirst({ where: and(eq(repos.id, id), eq(repos.orgId, org.id)) });
  if (!repo) notFound();
  const history = await db
    .select()
    .from(scans)
    .where(eq(scans.repoId, repo.id))
    .orderBy(desc(scans.createdAt))
    .limit(25);

  return (
    <>
      <PageHeader
        title={repo.name}
        description={repo.source === "github" ? `GitHub · ${repo.defaultBranch ?? "default branch"}` : "Zip upload"}
        actions={
          repo.source === "github" ? (
            <ActionForm action={startCodeScan} submitLabel="Scan now" className="flex items-start gap-2">
              <input type="hidden" name="repoId" value={repo.id} />
            </ActionForm>
          ) : undefined
        }
      />
      {repo.source === "upload" && (
        <Card className="mb-6">
          <h2 className="mb-4 font-semibold">Upload a new version</h2>
          <UploadForm repoId={repo.id} />
        </Card>
      )}

      <h2 className="mb-3 text-lg font-semibold">Scan history</h2>
      {history.length === 0 ? (
        <EmptyState title="No scans yet" />
      ) : (
        <Card className="p-0">
          <table className="w-full text-sm">
            <tbody>
              {history.map((s) => (
                <tr key={s.id} className="border-t border-border first:border-t-0">
                  <td className="px-5 py-3">
                    <Link href={`/scans/${s.id}`} className="hover:text-accent">
                      {formatDate(s.createdAt)}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <Badge kind={s.status} />
                  </td>
                  <td className="px-5 py-3 text-muted">{s.commitSha?.slice(0, 10) ?? ""}</td>
                  <td className="px-5 py-3 text-muted">{s.summary ? `${s.summary.total ?? 0} findings` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {role !== "member" && (
        <form action={deleteRepo} className="mt-10">
          <input type="hidden" name="repoId" value={repo.id} />
          <Button variant="danger" type="submit">
            Remove repository and its scan history
          </Button>
        </form>
      )}
    </>
  );
}
