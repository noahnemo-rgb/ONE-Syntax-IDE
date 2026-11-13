---
title: Acceptable Use Policy
updated: 2026-11-13
---

> **Template — not yet reviewed by counsel.** Replace every [BRACKETED] placeholder and have a qualified lawyer review this document before launch.

This policy explains what you may and may not do with Patch AI. It is part of our [Terms of Service](/legal/terms). Security testing without permission is illegal in most countries (for example under the U.S. Computer Fraud and Abuse Act and the U.K. Computer Misuse Act); this policy exists to keep every scan authorized.

## You may

- Scan source code you own or are licensed to analyze.
- Scan web applications you own, or that you are authorized **in writing** by their owner to test at the intensity you select.
- Share reports with people who are entitled to see the results.

## You must not

1. Register, verify or scan any host you are not authorized to test, including by placing a verification record on a domain whose owner has not agreed to testing.
2. Sign an attestation you know or suspect is untrue.
3. Use the service to attack, disrupt or gain unauthorized access to any system, or to perform denial-of-service, credential stuffing, brute-force, spam or social-engineering activity.
4. Attempt to circumvent domain verification, plan limits, rate limits, network restrictions or other safeguards, including by DNS tricks, redirects, or pointing a verified name at someone else's infrastructure.
5. Scan shared infrastructure (for example a hosting provider's control panel or a SaaS vendor's domain) unless that provider's own testing policy allows it.
6. Use findings about systems you do not own to exploit them or to sell vulnerability information.
7. Upload malware intended to infect our systems, or content you have no right to share.
8. Probe, scan or test the Patch AI service itself outside our published [security policy](/security).

## Scanner behaviour you can expect

- Scans come from the addresses listed on our [security page](/security) and identify themselves with the `PatchAI-Scanner` user agent.
- Passive scans make a small number of ordinary requests. Active scans are rate-limited and exclude denial-of-service, brute-force and default-credential tests.
- Scanner traffic can only reach the single verified host and address resolved at the start of each scan.

## Enforcement

We may pause a scan, disable a target, suspend an account, preserve relevant logs, and cooperate with affected parties and law enforcement when we believe this policy has been breached. Report suspected misuse at [/abuse](/abuse) or [ABUSE EMAIL]; we aim to act on credible reports within one business day and can stop a target's scans immediately.
