import { ButtonLink, Card } from "@/components/ui";

const features = [
  {
    title: "Source code analysis",
    body: "Static analysis for injection, auth, crypto and deserialization flaws across Python, JavaScript, TypeScript, Go and Java.",
  },
  {
    title: "Vulnerable dependencies",
    body: "Lockfiles are checked against the OSV and Trivy vulnerability databases, with the version that fixes each issue.",
  },
  {
    title: "Leaked secrets",
    body: "API keys, tokens and private keys committed to your code are detected and shown redacted, never stored in full.",
  },
  {
    title: "Live web targets",
    body: "Passive checks of your verified domains for missing headers, weak TLS, exposed files and known misconfigurations. Active testing is opt-in.",
  },
  {
    title: "AI triage",
    body: "Each finding is reviewed by an LLM with zero data retention: real or false positive, a plain-English explanation and a suggested patch.",
  },
  {
    title: "Built to be safe",
    body: "Scans run in throwaway sandboxes. Code scans have no network access, and live scans can only reach domains you've proven you own.",
  },
];

const steps = [
  ["Connect", "Install the GitHub App on the repos you choose, or upload a zip."],
  ["Verify", "Prove ownership of a domain with a DNS record or a well-known file."],
  ["Scan", "Opengrep, Bandit, OSV-Scanner, Trivy, Gitleaks, ZAP and Nuclei run in isolation."],
  ["Fix", "Review AI-triaged findings, apply suggested patches and export a report."],
];

export default function LandingPage() {
  return (
    <>
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-24 text-center">
        <p className="mb-4 inline-block rounded-full border border-border px-3 py-1 text-xs text-muted">
          Security analysis for developers, startups and enterprises
        </p>
        <h1 className="mx-auto max-w-3xl text-5xl font-semibold leading-tight tracking-tight">
          Find the vulnerabilities attackers would find, <span className="text-accent">before they do.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-muted">
          Patch AI scans your source code, dependencies and live web apps, filters out the noise with AI, and
          hands you a fix for every real issue.
        </p>
        <div className="mt-10 flex justify-center gap-3">
          <ButtonLink href="/login">Start free</ButtonLink>
          <ButtonLink href="/pricing" variant="secondary">
            See pricing
          </ButtonLink>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-20 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <Card key={f.title}>
            <h3 className="font-medium">{f.title}</h3>
            <p className="mt-2 text-sm leading-6 text-muted">{f.body}</p>
          </Card>
        ))}
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-16 sm:grid-cols-4">
          {steps.map(([title, body], i) => (
            <div key={title}>
              <div className="font-mono text-sm text-accent">0{i + 1}</div>
              <h3 className="mt-2 font-medium">{title}</h3>
              <p className="mt-1 text-sm text-muted">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-6 py-20 text-center">
        <h2 className="text-2xl font-semibold">You can only scan what you own</h2>
        <p className="mt-4 text-muted">
          Patch AI is for defending your own software. Repository access comes from your GitHub App installation,
          and every live target must pass domain verification and a signed authorization before we send a single
          request. Every scan is recorded in an append-only audit log.
        </p>
      </section>
    </>
  );
}
