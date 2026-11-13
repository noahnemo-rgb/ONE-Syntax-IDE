import "server-only";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { db } from "@/db";
import { orgs, subscriptions } from "@/db/schema";
import { audit } from "./audit";
import { planForPriceId, subscriptionGrantsPlan, type Plan } from "./plans";

const PLAN_RANK: Record<Plan, number> = { free: 0, pro: 1, team: 2, enterprise: 3 };

let client: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PRICE_PRO && process.env.STRIPE_PRICE_TEAM);
}

export function getStripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not set");
  client ??= new Stripe(process.env.STRIPE_SECRET_KEY, { appInfo: { name: "Patch AI" } });
  return client;
}

export { appUrl } from "./app-url";

type Org = typeof orgs.$inferSelect;

export async function ensureCustomer(org: Org, email: string | null | undefined): Promise<string> {
  if (org.stripeCustomerId) return org.stripeCustomerId;
  const customer = await getStripe().customers.create(
    { name: org.name, email: email ?? undefined, metadata: { orgId: org.id } },
    { idempotencyKey: `customer-${org.id}` },
  );
  await db.update(orgs).set({ stripeCustomerId: customer.id }).where(eq(orgs.id, org.id));
  return customer.id;
}

/** The plan a subscription entitles its org to; non-granting statuses fall back to free. */
export function planFromSubscription(sub: Stripe.Subscription): Plan {
  if (!subscriptionGrantsPlan(sub.status)) return "free";
  for (const item of sub.items.data) {
    const plan = planForPriceId(item.price.id);
    if (plan) return plan;
  }
  return "free";
}

/**
 * Re-reads the subscription from Stripe and applies it. Webhooks can arrive
 * late, duplicated or out of order; reading the current state makes every
 * delivery idempotent.
 */
export async function syncSubscription(subscriptionId: string): Promise<void> {
  const sub = await getStripe().subscriptions.retrieve(subscriptionId);
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const org =
    (sub.metadata?.orgId && (await db.query.orgs.findFirst({ where: eq(orgs.id, sub.metadata.orgId) }))) ||
    (await db.query.orgs.findFirst({ where: eq(orgs.stripeCustomerId, customerId) }));
  if (!org) {
    console.warn(`stripe: no org for subscription ${sub.id} (customer ${customerId})`);
    return;
  }
  const item = sub.items.data[0];
  const plan = planFromSubscription(sub);
  const values = {
    orgId: org.id,
    status: sub.status,
    plan,
    priceId: item?.price.id ?? null,
    currentPeriodEnd: item ? new Date(item.current_period_end * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    updatedAt: new Date(),
  };
  await db
    .insert(subscriptions)
    .values({ id: sub.id, ...values })
    .onConflictDoUpdate({ target: subscriptions.id, set: values });

  // Enterprise plans are contracted outside self-serve billing and never changed here.
  if (org.plan === "enterprise") return;
  const all = await db.query.subscriptions.findMany({ where: eq(subscriptions.orgId, org.id) });
  const best = all
    .filter((s) => subscriptionGrantsPlan(s.status))
    .map((s) => s.plan)
    .reduce<Plan>((a, b) => (PLAN_RANK[b] > PLAN_RANK[a] ? b : a), "free");
  if (org.plan !== best) {
    await db
      .update(orgs)
      .set({ plan: best, stripeCustomerId: org.stripeCustomerId ?? customerId })
      .where(eq(orgs.id, org.id));
    await audit({
      orgId: org.id,
      action: "billing.plan_changed",
      subjectType: "subscription",
      subjectId: sub.id,
      metadata: { from: org.plan, to: best, status: sub.status },
    });
  }
}
