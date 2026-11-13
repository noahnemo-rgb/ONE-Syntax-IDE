# Patch AI

Security analysis as a service: scans customers' source code and, with proof of ownership and a signed authorization, their live web applications. Findings are triaged by an AI model through Vercel AI Gateway with zero data retention.

"Patch AI" is a working name. This directory is self-contained so it can move to its own repository (`git subtree split --prefix=patch-ai -b patch-ai`).

## Architecture

```
Browser ──► Next.js on Vercel (apps/web) ──► Postgres (Neon)
                │  GitHub App, Stripe webhooks        ▲
                │                                     │ claims scans (FOR UPDATE SKIP LOCKED)
                ▼                                     │
          GitHub / Stripe                  Scan worker on Fly.io (workers/scanner)
                                             ├─ code scans: one container per tool, --network none
                                             │    Opengrep (in-house rules), Bandit, Gitleaks,
                                             │    OSV-Scanner and Trivy with offline databases
                                             ├─ live scans: passive checks, Nuclei, ZAP
                                             │    on an internal network whose only exit is
                                             │    the egress guard (verified host + pinned IP, 80/443)
                                             └─ AI triage via AI Gateway (zero data retention)
```

| Path | What |
| --- | --- |
| `apps/web` | Next.js 16 app: marketing, auth (Auth.js + GitHub), workspaces, repos, targets, findings, billing, admin |
| `apps/web/drizzle` | SQL migrations (the audit log is append-only, enforced by triggers) |
| `apps/web/content/legal` | Terms, Acceptable Use, Privacy, DPA — **templates, need legal review** |
| `workers/scanner` | Python worker: queue, sandbox, scanners, normalization, egress guard, triage, retention |
| `workers/scanner/rules` | In-house Opengrep rules (the community rule repo's license forbids SaaS use) |
| `infra` | Worker and sandbox Dockerfiles, Fly config, egress firewall, scanner installer |

## Local development

Requirements: Node 22, Python 3.12, Postgres 16, and the scanners (`sudo infra/install-scanners.sh`).

```bash
# Web
cd apps/web
cp .env.example .env.local        # set AUTH_SECRET (npx auth secret) and AUTH_DEV_LOGIN=true
npm install
npm run db:migrate
npm run dev                       # http://localhost:3000 — sign in with any email via dev login

# Worker (separate terminal)
cd workers/scanner
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
export DATABASE_URL=postgres://patchai:patchai@localhost:5432/patchai
export SANDBOX_MODE=local VULNDB_DIR=/tmp/vulndb
.venv/bin/python -c "from patchai_worker import vulndb; from pathlib import Path; vulndb.refresh(Path('/tmp/vulndb'))"
.venv/bin/patchai-worker
```

`SANDBOX_MODE=local` runs tools as host processes (code scans inside `unshare -rn`, a namespace with no network). It is for development and CI only; production uses `docker`.

### Tests

```bash
cd apps/web && npm run lint && npm run typecheck && npm test
cd workers/scanner && .venv/bin/ruff check . && TEST_DATABASE_URL=$DATABASE_URL .venv/bin/pytest -q
```

Egress-guard tests bind port 80; on Linux allow it with `sudo sysctl -w net.ipv4.ip_unprivileged_port_start=80`.

### Live-scan smoke test on your machine

`workers/scanner/tests/fixtures/weakweb.py` is a deliberately misconfigured app. With `ALLOW_PRIVATE_TARGETS=true DEV_TARGET_SCHEME=http` (never set these in production) the worker will scan it at a hostname mapped to 127.0.0.1 in `/etc/hosts`; CI does not need these flags.

## Deploying

1. **Domain.** Pick and register the product domain (availability of `patch.ai` was not checked). Update `SCANNER_USER_AGENT`, the legal documents and `.env` values.
2. **Database.** Create a Neon Postgres database. Run `npm run db:migrate` with its `DATABASE_URL`.
3. **GitHub App.** Create an app with:
   - Repository permissions: *Contents: read*, *Metadata: read*. No write permissions.
   - Events: *Installation*, *Installation repositories*.
   - Setup URL: `https://<domain>/api/github/setup` (enable "Redirect on update").
   - Webhook URL: `https://<domain>/api/github/webhook` with a random secret.
   - Callback URL for user login: `https://<domain>/api/auth/callback/github`. Use the app's client ID and secret as `AUTH_GITHUB_ID` and `AUTH_GITHUB_SECRET`.
4. **Stripe.** Create Pro ($29/month) and Team ($149/month) recurring prices and a webhook to `https://<domain>/api/stripe/webhook` for `checkout.session.completed`, `customer.subscription.created|updated|deleted|paused|resumed` and `invoice.payment_failed`. Enable the customer portal (cancellation and payment-method updates).
5. **Vercel.** Import the repository with Root Directory `patch-ai/apps/web`. Set every variable in `.env.example` (`AUTH_DEV_LOGIN` must be false; it is ignored on production anyway). Create an AI Gateway API key for the worker.
6. **Worker.** From `patch-ai/`: `fly launch --no-deploy --config infra/fly.toml`, `fly volumes create patchai_data --size 40`, `fly secrets set DATABASE_URL=… GITHUB_APP_ID=… GITHUB_APP_PRIVATE_KEY=… AI_GATEWAY_API_KEY=…`, then `fly deploy . --config infra/fly.toml`. The worker runs its own Docker daemon, builds the sandbox image on first boot and pulls ZAP.
7. **Egress IP.** Allocate a static egress IP for the worker machine and set it as `SCANNER_EGRESS_IPS` on Vercel so `/security` publishes it.
8. **Smoke test.** Deploy OWASP Juice Shop on a subdomain you control, add it as a live target, verify it with the DNS record, sign the attestation, and run passive then active scans. Expect findings for missing headers, exposed files and (active) injection issues.

## Operating

- **Kill switch.** `/admin` → *Pause all scanning*, or set `PATCHAI_KILL_SWITCH=true` on both Vercel and the worker. Running scans stop and their traffic is dropped within about 10 seconds.
- **Abuse.** Reports arrive at `/admin`. *Disable a host* blocks it in every workspace and cancels its scans.
- **Audit log.** Append-only (`UPDATE`, `DELETE` and `TRUNCATE` are rejected by triggers). Signed attestations are copied into it.
- **Retention.** The worker deletes uploaded archives within 24 hours and scans after each workspace's retention period (default 90 days).
- **Databases.** The worker refreshes the OSV, Trivy and Nuclei databases every 12 hours; scans use the cached copy if a refresh fails.

## Launch checklist

- [ ] Lawyer review of `content/legal/*` and the attestation wording in `src/lib/attestation.ts`; fill in every `[PLACEHOLDER]`.
- [ ] Register the domain; set up `abuse@` and `security@` mailboxes.
- [ ] Confirm the hosting provider (Fly.io) permits security scanning from its network and notify it if required.
- [ ] Verify the ZAP container end to end on the Fly worker (it cannot run in CI without Docker-in-Docker).
- [ ] Juice Shop smoke test on a verified domain (step 8 above).
- [ ] Rotate any credentials used during development.
