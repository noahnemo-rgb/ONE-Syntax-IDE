import { getApiOrgContext, HttpError } from "@/lib/session";
import { appUrl, getStripe, stripeConfigured } from "@/lib/stripe";

export async function POST() {
  try {
    const { org } = await getApiOrgContext("owner");
    if (!stripeConfigured() || !org.stripeCustomerId) {
      return Response.redirect(`${appUrl()}/settings#billing`, 303);
    }
    const session = await getStripe().billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${appUrl()}/settings#billing`,
    });
    return Response.redirect(session.url, 303);
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
