---
title: Data Processing Agreement
updated: 2026-11-13
---

> **Template — not yet reviewed by counsel.** Have a qualified lawyer review this agreement, and attach the applicable Standard Contractual Clauses and U.K. addendum, before offering it to customers.

This Data Processing Agreement ("DPA") supplements the [Terms of Service](/legal/terms) between the customer ("Controller") and [COMPANY LEGAL NAME] ("Processor") where the Processor processes personal data on the Controller's behalf.

## 1. Scope and roles

1.1 The Controller determines the purposes of processing personal data contained in Customer Content (for example names or emails in source code, commit metadata, or data returned by a Live Target). The Processor processes it only to provide the service.

1.2 Subject matter: security analysis of source code and web applications. Duration: the term of the agreement plus the deletion period in section 7. Data subjects: the Controller's personnel, end users and other individuals whose data appears in Customer Content. Categories: identifiers and any other personal data incidentally present in Customer Content. No special-category data is intentionally processed.

## 2. Processor obligations

The Processor will: (a) process personal data only on documented instructions, including these Terms and the Controller's configuration of the service; (b) ensure personnel are bound by confidentiality; (c) implement the measures in Annex A; (d) assist the Controller with data subject requests and impact assessments, taking into account the nature of processing; and (e) inform the Controller if an instruction appears to infringe data protection law.

## 3. Subprocessors

The Controller authorizes the subprocessors listed in the [Privacy Policy](/legal/privacy). The Processor will give at least 30 days' notice of new subprocessors by email; the Controller may object on reasonable grounds and, if no resolution is reached, terminate the affected service and receive a pro-rata refund. The Processor remains liable for its subprocessors.

## 4. International transfers

Where personal data is transferred outside the EEA, U.K. or Switzerland to a country without an adequacy decision, the parties incorporate the EU Standard Contractual Clauses (Module 2 or 3 as applicable) and the U.K. International Data Transfer Addendum, which are attached as [ANNEX C].

## 5. Personal data breach

The Processor will notify the Controller without undue delay, and in any case within 72 hours, after becoming aware of a personal data breach affecting the Controller's data, with the information reasonably available.

## 6. Audits

The Processor will make available information necessary to demonstrate compliance, including third-party audit reports when available. On-site audits are limited to once per year, with 30 days' notice, at the Controller's cost, and subject to confidentiality.

## 7. Deletion

On termination the Processor deletes Customer Content within 30 days, except where retention is required by law. Scan findings are otherwise deleted according to the retention period configured by the Controller.

## Annex A — Technical and organizational measures

- Source code is scanned in single-use containers with no network access, a read-only filesystem, no Linux capabilities and resource limits; working copies are deleted after each scan.
- Uploaded archives are deleted as soon as they are extracted and in any case within 24 hours.
- Live-target scanner traffic passes through an egress proxy that only permits the verified host at an address pinned at the start of the scan.
- Secrets detected in code are redacted before storage and never sent to AI models; AI requests use zero-data-retention routing.
- Encryption in transit (TLS 1.2+) and at rest (provider-managed).
- Role-based access within workspaces; an append-only audit log of security-relevant actions.
- Platform kill switch able to halt all scanning within seconds.
- [ADD: employee access controls, background checks, incident response plan, backup policy.]

## Annex B — Contact

Processor data protection contact: [PRIVACY EMAIL].
