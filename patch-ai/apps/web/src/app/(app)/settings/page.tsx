import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { memberships, subscriptions, users } from "@/db/schema";
import { ActionForm } from "@/components/action-form";
import { Button, Card, Field, Notice, PageHeader, formatDate, inputClass } from "@/components/ui";
import { usageForOrg } from "@/lib/limits";
import { PLANS, SELF_SERVE_PLANS } from "@/lib/plans";
import { getOrgContext } from "@/lib/session";
import { stripeConfigured } from "@/lib/stripe";
import { addMember, createOrgAction, removeMember, updateOrgSettings } from "../actions/org";

const BILLING_NOTICES: Record<string, { tone: "success" | "info" | "warning"; text: string }> = {
  success: { tone: "success", text: "Thanks! Your plan updates as soon as Stripe confirms the payment (usually a few seconds)." },
  cancelled: { tone: "info", text: "Checkout was cancelled; nothing was charged." },
  unconfigured: { tone: "warning", text: "Billing is not configured on this deployment yet." },
};

export default async function SettingsPage(props: PageProps<"/settings">) {
  const { billing } = await props.searchParams;
  const { org, role, user } = await getOrgContext();
  const isAdmin = role !== "member";
  const isOwner = role === "owner";
  const plan = PLANS[org.plan];
  const usage = await usageForOrg(org.id);
  const members = await db
    .select({ userId: users.id, email: users.email, name: users.name, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.orgId, org.id));
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.orgId, org.id))
    .orderBy(desc(subscriptions.updatedAt))
    .limit(1);
  const notice = typeof billing === "string" ? BILLING_NOTICES[billing] : undefined;

  const usageRows: [string, number, number][] = [
    ["Repositories", usage.repos, plan.repos],
    ["Scans this month", usage.scansThisMonth, plan.scansPerMonth],
    ["Live targets", usage.targets, plan.liveTargets],
    ["Seats", usage.seats, plan.seats],
  ];

  return (
    <>
      <PageHeader title="Settings" description={org.name} />

      <section id="billing" className="mb-8">
        <h2 className="mb-3 text-lg font-semibold">Plan and billing</h2>
        {notice && (
          <div className="mb-4">
            <Notice tone={notice.tone}>{notice.text}</Notice>
          </div>
        )}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <p className="text-sm text-muted">Current plan</p>
            <p className="mt-1 text-2xl font-semibold">
              {plan.label} <span className="text-base font-normal text-muted">{plan.priceLabel}</span>
            </p>
            {sub && (
              <p className="mt-2 text-sm text-muted">
                Subscription {sub.status.replace(/_/g, " ")}
                {sub.currentPeriodEnd &&
                  ` · ${sub.cancelAtPeriodEnd ? "ends" : "renews"} ${formatDate(sub.currentPeriodEnd)}`}
              </p>
            )}
            {sub?.status === "past_due" && (
              <div className="mt-3">
                <Notice tone="warning">Your last payment failed. Update your payment method to keep your plan.</Notice>
              </div>
            )}
            <table className="mt-4 w-full text-sm">
              <tbody>
                {usageRows.map(([label, used, limit]) => (
                  <tr key={label} className="border-t border-border">
                    <td className="py-2 text-muted">{label}</td>
                    <td className="py-2 text-right">
                      {used} / {limit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card>
            {!isOwner ? (
              <p className="text-sm text-muted">Only the workspace owner can change the plan.</p>
            ) : org.plan === "enterprise" ? (
              <p className="text-sm text-muted">Enterprise billing is handled by your account manager.</p>
            ) : (
              <div className="space-y-4">
                {!stripeConfigured() && (
                  <Notice tone="warning">Stripe keys are not configured on this deployment.</Notice>
                )}
                {SELF_SERVE_PLANS.filter((p) => p !== org.plan).map((p) => (
                  <form key={p} action="/api/stripe/checkout" method="post" className="flex items-center justify-between gap-4">
                    <input type="hidden" name="plan" value={p} />
                    <div>
                      <p className="font-medium">
                        {PLANS[p].label} · {PLANS[p].priceLabel}
                      </p>
                      <p className="text-xs text-muted">{PLANS[p].tagline}</p>
                    </div>
                    <Button type="submit" disabled={!stripeConfigured()}>
                      {sub && org.plan !== "free" ? "Switch" : "Upgrade"}
                    </Button>
                  </form>
                ))}
                {org.stripeCustomerId && (
                  <form action="/api/stripe/portal" method="post" className="border-t border-border pt-4">
                    <Button type="submit" variant="secondary" disabled={!stripeConfigured()}>
                      Manage billing, invoices and cancellation
                    </Button>
                  </form>
                )}
              </div>
            )}
          </Card>
        </div>
      </section>

      <section className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 font-semibold">Workspace</h2>
          {isAdmin ? (
            <ActionForm action={updateOrgSettings} submitLabel="Save">
              <Field label="Name">
                <input name="name" defaultValue={org.name} required className={inputClass} />
              </Field>
              <Field label="Keep scan results for (days)" hint="Scans older than this are deleted automatically. 7–365.">
                <input name="retentionDays" type="number" min={7} max={365} defaultValue={org.retentionDays} className={inputClass} />
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="aiTriageEnabled" defaultChecked={org.aiTriageEnabled} className="mt-1" />
                <span>
                  AI triage
                  <span className="block text-xs text-muted">
                    Sends code snippets around each finding to the model provider with zero data retention. Secrets are
                    never sent.
                  </span>
                </span>
              </label>
            </ActionForm>
          ) : (
            <p className="text-sm text-muted">Only admins can change workspace settings.</p>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 font-semibold">Members</h2>
          <table className="mb-4 w-full text-sm">
            <tbody>
              {members.map((m) => (
                <tr key={m.userId} className="border-t border-border first:border-t-0">
                  <td className="py-2">
                    {m.name ?? m.email}
                    {m.userId === user.id && <span className="text-muted"> (you)</span>}
                    <span className="block text-xs text-muted">{m.email}</span>
                  </td>
                  <td className="py-2 capitalize text-muted">{m.role}</td>
                  <td className="py-2 text-right">
                    {isAdmin && m.role !== "owner" && m.userId !== user.id && (
                      <form action={removeMember}>
                        <input type="hidden" name="userId" value={m.userId} />
                        <Button variant="ghost" type="submit" className="px-2 py-1 text-xs">
                          Remove
                        </Button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {isAdmin && (
            <ActionForm action={addMember} submitLabel="Add member" className="flex flex-wrap items-start gap-2">
              <input name="email" type="email" required placeholder="teammate@company.com" className={`${inputClass} max-w-xs`} />
              <select name="role" defaultValue="member" className={`${inputClass} w-28`}>
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </ActionForm>
          )}
        </Card>
      </section>

      <Card className="max-w-xl">
        <h2 className="mb-4 font-semibold">Create another workspace</h2>
        <ActionForm action={createOrgAction} submitLabel="Create workspace" className="flex flex-wrap items-start gap-2">
          <input name="name" required minLength={2} maxLength={60} placeholder="Acme Inc." className={`${inputClass} max-w-xs`} />
        </ActionForm>
      </Card>
    </>
  );
}
