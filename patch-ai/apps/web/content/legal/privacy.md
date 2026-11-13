---
title: Privacy Policy
updated: 2026-11-13
---

> **Template — not yet reviewed by counsel.** Replace every [BRACKETED] placeholder and have a qualified lawyer review this document before launch. Confirm the subprocessor list matches your actual vendors and regions.

This policy describes how [COMPANY LEGAL NAME] ("Patch AI") handles personal data and customer content.

## What we collect

| Data | Source | Why |
| --- | --- | --- |
| Name, email, GitHub username and avatar | GitHub sign-in | Account and workspace membership |
| GitHub OAuth tokens | GitHub sign-in | Confirm which GitHub App installations you can access |
| Workspace settings, members, plan | You | Provide the service |
| Billing details | Stripe (we never see full card numbers) | Billing |
| IP address and user agent | Your browser | Security, audit log, attestation records |
| Source code | GitHub App or upload | Scanning |
| Live-target responses | Scanners | Scanning |
| Scan findings and logs | Scanners | Show you results |

## How customer content is handled

- **Source code** is downloaded into an isolated worker, scanned in containers that have no network access, and deleted from the worker when the scan ends. Uploaded archives are deleted as soon as they are extracted and in any case within 24 hours.
- **Findings** contain short code excerpts around each issue. They are kept for the retention period your workspace chooses (default 90 days, 7–365) and then deleted automatically. Detected secrets are stored redacted.
- **AI triage** (optional, on by default, can be disabled per workspace) sends the excerpt around a finding to an AI model through Vercel AI Gateway with zero-data-retention routing: the provider does not store or train on it. Code around secret findings is never sent.
- We do not sell personal data or use customer content to train models.

## Subprocessors

| Vendor | Purpose | Location |
| --- | --- | --- |
| Vercel | Web hosting, AI Gateway | [REGION] |
| Neon | Database | [REGION] |
| Fly.io | Scan workers | [REGION] |
| Stripe | Payments | United States |
| AI model providers via AI Gateway (zero data retention) | Finding triage | [REGION] |
| GitHub | Sign-in and repository access | United States |

## Cookies

We use strictly necessary cookies only: a session cookie and a cookie remembering your selected workspace. No advertising or third-party analytics cookies.

## Retention

Account data is kept while your account is active and deleted within 30 days of account deletion, except billing records (kept as required by tax law) and the security audit log, which is append-only and kept for [AUDIT RETENTION PERIOD] to investigate abuse.

## Your rights

Depending on where you live you may have rights to access, correct, delete, or export your personal data, and to object to or restrict processing. Contact [PRIVACY EMAIL]. You may also complain to your data protection authority. For data we process on behalf of a customer (for example findings in a company workspace), contact that customer first.

## Security

See our [security page](/security). Report vulnerabilities in Patch AI to [SECURITY EMAIL].

## Contact

[COMPANY LEGAL NAME], [POSTAL ADDRESS], [PRIVACY EMAIL]. EU/UK representative: [IF REQUIRED].
