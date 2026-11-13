import { renderToStaticMarkup } from "react-dom/server";
import type Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { attestationStatement } from "@/lib/attestation";
import { LEGAL_DOCS, loadLegalDoc } from "@/lib/legal";
import { Markdown } from "@/lib/markdown";
import { planForPriceId, PLANS, subscriptionGrantsPlan } from "@/lib/plans";
import { planFromSubscription } from "@/lib/stripe";

const sub = (status: string, price: string) =>
  ({ status, items: { data: [{ price: { id: price } }] } }) as unknown as Stripe.Subscription;

describe("plans", () => {
  it("maps Stripe prices to plans", () => {
    expect(planForPriceId("price_pro")).toBe("pro");
    expect(planForPriceId("price_team")).toBe("team");
    expect(planForPriceId("price_unknown")).toBeNull();
    expect(planForPriceId(null)).toBeNull();
  });
  it("only paid statuses grant a plan", () => {
    expect(subscriptionGrantsPlan("active")).toBe(true);
    expect(subscriptionGrantsPlan("past_due")).toBe(true);
    expect(subscriptionGrantsPlan("canceled")).toBe(false);
    expect(subscriptionGrantsPlan("incomplete")).toBe(false);
    expect(planFromSubscription(sub("active", "price_team"))).toBe("team");
    expect(planFromSubscription(sub("canceled", "price_team"))).toBe("free");
    expect(planFromSubscription(sub("active", "price_other"))).toBe("free");
  });
  it("keeps live targets and active scans off the lower plans", () => {
    expect(PLANS.free.liveTargets).toBe(0);
    expect(PLANS.pro.activeWebScans).toBe(false);
    expect(PLANS.team.activeWebScans).toBe(true);
  });
});

describe("attestation", () => {
  it("names the host and organization", () => {
    const text = attestationStatement("active", "staging.acme.com", "Acme Inc.");
    expect(text).toContain("staging.acme.com");
    expect(text).toContain("Acme Inc.");
    expect(text).toContain("attack payloads");
    expect(attestationStatement("passive", "a.com", "B")).not.toContain("{host}");
  });
});

describe("markdown", () => {
  it("renders structure and never emits unsafe links or raw HTML", () => {
    const html = renderToStaticMarkup(
      <Markdown
        source={[
          "## Title",
          "Text with **bold**, `code`, [ok](https://example.com) and [bad](javascript:alert(1)).",
          "<img src=x onerror=alert(1)>",
          "- one",
          "- two",
          "| a | b |",
          "| --- | --- |",
          "| 1 | 2 |",
        ].join("\n")}
      />,
    );
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('href="https://example.com"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<td>1</td>");
  });
  it("loads every legal document with a title and a review banner", async () => {
    for (const doc of LEGAL_DOCS) {
      const { title, body } = await loadLegalDoc(doc);
      expect(title.length).toBeGreaterThan(3);
      expect(body).toContain("not yet reviewed by counsel");
    }
  });
});
