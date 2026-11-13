import type Stripe from "stripe";
import { getStripe, syncSubscription } from "@/lib/stripe";

const SUBSCRIPTION_EVENTS = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
]);

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers.get("stripe-signature");
  if (!secret || !signature) return new Response("Webhook not configured", { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    if (session.mode === "subscription" && session.subscription) {
      await syncSubscription(typeof session.subscription === "string" ? session.subscription : session.subscription.id);
    }
  } else if (SUBSCRIPTION_EVENTS.has(event.type)) {
    await syncSubscription((event.data.object as Stripe.Subscription).id);
  } else if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object;
    const sub = invoice.parent?.subscription_details?.subscription;
    if (sub) await syncSubscription(typeof sub === "string" ? sub : sub.id);
  }
  return Response.json({ received: true });
}
