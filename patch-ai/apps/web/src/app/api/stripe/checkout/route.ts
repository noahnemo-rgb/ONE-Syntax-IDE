import { audit } from "@/lib/audit";
import { priceIdForPlan, SELF_SERVE_PLANS, type SelfServePlan } from "@/lib/plans";
import { getApiOrgContext, HttpError } from "@/lib/session";
import { appUrl, ensureCustomer, getStripe, stripeConfigured } from "@/lib/stripe";

export async function POST(req: Request) {
  try {
    const { user, org } = await getApiOrgContext("owner");
    const form = await req.formData();
    const plan = String(form.get("plan") ?? "") as SelfServePlan;
    if (!SELF_SERVE_PLANS.includes(plan)) return Response.json({ error: "Unknown plan" }, { status: 400 });
    if (!stripeConfigured()) {
      return Response.redirect(`${appUrl()}/settings?billing=unconfigured#billing`, 303);
    }
    const customer = await ensureCustomer(org, user.email);
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: org.id,
      line_items: [{ price: priceIdForPlan(plan)!, quantity: 1 }],
      subscription_data: { metadata: { orgId: org.id } },
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      automatic_tax: { enabled: process.env.STRIPE_AUTOMATIC_TAX === "true" },
      customer_update: { address: "auto", name: "auto" },
      success_url: `${appUrl()}/settings?billing=success#billing`,
      cancel_url: `${appUrl()}/settings?billing=cancelled#billing`,
    });
    await audit({ orgId: org.id, actorUserId: user.id, action: "billing.checkout_started", metadata: { plan } });
    return Response.redirect(session.url!, 303);
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
