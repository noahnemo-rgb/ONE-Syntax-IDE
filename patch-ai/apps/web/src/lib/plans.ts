export type Plan = "free" | "pro" | "team" | "enterprise";

export interface PlanLimits {
  label: string;
  priceLabel: string;
  tagline: string;
  repos: number;
  scansPerMonth: number;
  liveTargets: number;
  activeWebScans: boolean;
  seats: number;
  aiTriage: boolean;
}

export const PLANS: Record<Plan, PlanLimits> = {
  free: {
    label: "Free",
    priceLabel: "$0",
    tagline: "Try it on one repository.",
    repos: 1,
    scansPerMonth: 4,
    liveTargets: 0,
    activeWebScans: false,
    seats: 1,
    aiTriage: true,
  },
  pro: {
    label: "Pro",
    priceLabel: "$29/mo",
    tagline: "For solo developers shipping real products.",
    repos: 10,
    scansPerMonth: 100,
    liveTargets: 0,
    activeWebScans: false,
    seats: 1,
    aiTriage: true,
  },
  team: {
    label: "Team",
    priceLabel: "$149/mo",
    tagline: "For startups: seats, live targets and active scanning.",
    repos: 50,
    scansPerMonth: 500,
    liveTargets: 10,
    activeWebScans: true,
    seats: 10,
    aiTriage: true,
  },
  enterprise: {
    label: "Enterprise",
    priceLabel: "Contact us",
    tagline: "Custom limits, DPA, SSO and dedicated scanner IPs.",
    repos: 1000,
    scansPerMonth: 10000,
    liveTargets: 200,
    activeWebScans: true,
    seats: 500,
    aiTriage: true,
  },
};

export const SELF_SERVE_PLANS = ["pro", "team"] as const;
export type SelfServePlan = (typeof SELF_SERVE_PLANS)[number];

export function priceIdForPlan(plan: SelfServePlan): string | undefined {
  return plan === "pro" ? process.env.STRIPE_PRICE_PRO : process.env.STRIPE_PRICE_TEAM;
}

export function planForPriceId(priceId: string | null | undefined): Plan | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_TEAM) return "team";
  return null;
}

/** Subscription statuses that grant the paid plan. */
export function subscriptionGrantsPlan(status: string): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}
