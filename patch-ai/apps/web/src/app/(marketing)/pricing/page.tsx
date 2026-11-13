import type { Metadata } from "next";
import { ButtonLink, Card } from "@/components/ui";
import { PLANS, type Plan } from "@/lib/plans";

export const metadata: Metadata = { title: "Pricing" };

const order: Plan[] = ["free", "pro", "team", "enterprise"];

export default function PricingPage() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20">
      <h1 className="text-center text-4xl font-semibold">Pricing</h1>
      <p className="mt-3 text-center text-muted">Start free. Upgrade when you need more repos, seats or live targets.</p>
      <div className="mt-12 grid gap-4 md:grid-cols-4">
        {order.map((key) => {
          const p = PLANS[key];
          return (
            <Card key={key} className={key === "team" ? "border-accent" : undefined}>
              <h2 className="text-lg font-semibold">{p.label}</h2>
              <p className="mt-1 text-3xl font-semibold">{p.priceLabel}</p>
              <p className="mt-2 min-h-12 text-sm text-muted">{p.tagline}</p>
              <ul className="mt-4 space-y-2 text-sm">
                <li>{p.repos.toLocaleString()} repositories</li>
                <li>{p.scansPerMonth.toLocaleString()} scans per month</li>
                <li>{p.seats.toLocaleString()} {p.seats === 1 ? "seat" : "seats"}</li>
                <li>{p.liveTargets ? `${p.liveTargets} live web targets` : "No live web targets"}</li>
                <li>{p.activeWebScans ? "Passive and active web scans" : "—"}</li>
                <li>AI triage and suggested fixes</li>
              </ul>
              <ButtonLink
                href={key === "enterprise" ? "mailto:sales@patch.ai" : "/login"}
                variant={key === "team" ? "primary" : "secondary"}
                className="mt-6 w-full"
              >
                {key === "enterprise" ? "Contact sales" : key === "free" ? "Start free" : `Choose ${p.label}`}
              </ButtonLink>
            </Card>
          );
        })}
      </div>
      <p className="mt-10 text-center text-xs text-muted">
        Prices in USD, billed monthly through Stripe. Cancel any time from the billing portal.
      </p>
    </section>
  );
}
