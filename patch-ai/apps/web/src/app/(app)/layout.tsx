import Link from "next/link";
import { Logo } from "@/components/logo";
import { signOut } from "@/lib/auth";
import { getOrgContext, isPlatformAdmin } from "@/lib/session";
import { PLANS } from "@/lib/plans";
import { switchOrg } from "./actions/org";

const nav = [
  ["/dashboard", "Overview"],
  ["/repos", "Repositories"],
  ["/targets", "Live targets"],
  ["/settings", "Settings"],
] as const;

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { user, org, memberships } = await getOrgContext();

  async function logout() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <div className="flex min-h-screen">
      <aside className="no-print flex w-60 shrink-0 flex-col border-r border-border bg-surface px-4 py-5">
        <Logo href="/dashboard" />
        <form action={switchOrg} className="mt-6">
          <label className="text-xs uppercase tracking-wide text-muted" htmlFor="org">
            Workspace
          </label>
          <select
            id="org"
            name="orgId"
            defaultValue={org.id}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            {memberships.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {memberships.length > 1 && (
            <button type="submit" className="mt-1 text-xs text-muted hover:text-foreground">
              Switch
            </button>
          )}
        </form>
        <p className="mt-2 text-xs text-muted">
          Plan: <span className="text-foreground">{PLANS[org.plan].label}</span>
        </p>
        <nav className="mt-6 flex flex-col gap-1 text-sm">
          {nav.map(([href, label]) => (
            <Link key={href} href={href} className="rounded-md px-3 py-2 text-muted hover:bg-surface-2 hover:text-foreground">
              {label}
            </Link>
          ))}
          {isPlatformAdmin(user.email) && (
            <Link href="/admin" className="rounded-md px-3 py-2 text-muted hover:bg-surface-2 hover:text-foreground">
              Platform admin
            </Link>
          )}
        </nav>
        <div className="mt-auto border-t border-border pt-4 text-xs text-muted">
          <p className="truncate">{user.email ?? user.name}</p>
          <form action={logout}>
            <button className="mt-2 hover:text-foreground">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
