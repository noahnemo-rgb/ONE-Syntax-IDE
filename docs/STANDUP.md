# Syntax IDE — Stand-up punch list (novice-friendly)

Follow this **in order**. Check each box only after you see the expected result.
Do **not** skip ahead — later steps depend on earlier ones.

**Goal of Part A–B:** app runs on your laptop (Expo Go / browser).  
**Goal of Part C:** installable app on your phone.  
**Goal of Part D:** works without your laptop running (deployed API).  
**Goal of Part E:** production-ready (billing, hardening) — optional later.

Related docs: [EAS.md](./EAS.md) · [LAPTOP_CHECKLIST.md](./LAPTOP_CHECKLIST.md)

---

## Before you start — what you need

- [ ] A computer (Mac or Windows/Linux) with internet
- [ ] [Node.js 20+](https://nodejs.org/) installed (`node -v` shows `v20` or higher)
- [ ] [Yarn 1.x](https://classic.yarnpkg.com/en/docs/install) (`yarn -v` shows `1.x`)
- [ ] [Python 3.11+](https://www.python.org/downloads/) (`python3 --version`)
- [ ] [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and **running** (whale icon / Docker engine up)
- [ ] Git + this repo cloned:
  ```bash
  git clone https://github.com/noahnemo-rgb/drag-code-app.git
  cd drag-code-app
  git checkout main
  git pull origin main
  ```
- [ ] (Phone later) Free [Expo](https://expo.dev) account
- [ ] (Phone AI later) Free [OpenRouter](https://openrouter.ai/keys) API key — optional for web AI (Puter)

**Tip:** Keep two terminal windows open: one for the **backend**, one for the **frontend**.

---

## Part A — Stand up the backend (API + database)

### A1. Create backend config

```bash
cd /path/to/drag-code-app
cp backend/.env.example backend/.env
```

- [ ] File `backend/.env` exists

Open `backend/.env` in any editor and set at least:

```bash
JWT_SECRET=pick-a-long-random-phrase-you-will-not-share
REQUIRE_AUTH=true
MONGO_URL=mongodb://127.0.0.1:27017
DB_NAME=syntax_ide
SANDBOX_USE_DOCKER=false
```

- [ ] You changed `JWT_SECRET` from the example value  
  (leave `OPENROUTER_API_KEY` empty for now — phone/web AI is configured in the app)

### A2. Start MongoDB

```bash
cd /path/to/drag-code-app
docker compose up -d mongo
```

- [ ] Command finishes without error
- [ ] Check: `docker compose ps` shows `mongo` as healthy / running

**If Docker fails:** start Docker Desktop, wait until it says “running,” then retry.

### A3. Install Python packages + start the API

```bash
cd /path/to/drag-code-app/backend
python3 -m venv .venv
```

**Mac/Linux:**

```bash
source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

**Windows (PowerShell):**

```powershell
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

- [ ] Terminal shows something like `Uvicorn running on http://0.0.0.0:8000`
- [ ] Leave this terminal running (do not close it)

### A4. Prove the API is alive

In a **browser** open:

`http://localhost:8000/api/`

- [ ] You see JSON including `"message": "Syntax Mobile IDE API"` and `"auth_required": true`

**If this fails:** the API is not running, wrong port, or firewall blocked — fix A3 first.

---

## Part B — Stand up the app on your laptop (Expo)

### B1. Create frontend config

Open a **second** terminal:

```bash
cd /path/to/drag-code-app
cp frontend/.env.example frontend/.env
```

Edit `frontend/.env`:

```bash
EXPO_PUBLIC_BACKEND_URL=http://localhost:8000
```

- [ ] No trailing slash on the URL
- [ ] Backend from Part A is still running

### B2. Install app dependencies + start Expo

```bash
cd /path/to/drag-code-app/frontend
yarn install
yarn start
```

- [ ] Metro / Expo menu appears (QR code + options)
- [ ] Press `w` to open **web**, **or** scan QR with **Expo Go** on your phone (same Wi‑Fi)

**Physical phone note:** `localhost` on the phone means *the phone itself*, not your laptop.  
If Expo Go on phone cannot load data:

1. Find your laptop’s LAN IP (Mac: System Settings → Network; or `ipconfig getifaddr en0`)
2. Set `EXPO_PUBLIC_BACKEND_URL=http://YOUR.LAN.IP:8000` (example: `http://192.168.1.42:8000`)
3. Stop Expo (`Ctrl+C`), run `yarn start` again

### B3. First-run smoke test (do all of these)

In the app:

| # | Action | Expected |
|---|--------|----------|
| 1 | Editor opens with a file / blank project | Dark amber UI, editor visible |
| 2 | Open drawer → create a project + file | File appears |
| 3 | Tap account / go to Auth → **Register** | Succeeds; you stay logged in |
| 4 | Drawer → switch sync to **Cloud** | After login (and Pro toggle if prompted), cloud mode sticks |
| 5 | Write `print(2+2)` in a Python file → **Run** | Console shows `4` |
| 6 | Open **AI** | Chat UI loads |
| 7 | Web AI: send a message (Puter sign-in if asked) | Reply streams back |
| 8 | Phone AI: gear icon → paste OpenRouter key → send | Reply streams back |
| 9 | Open **Snippets** → publish a small snippet | Appears in feed / Mine |

- [ ] All smoke rows that apply to your platform passed

**You are now operational on laptop / Expo Go.** Parts C–E make it “real phone app” and production-ready.

---

## Part C — Installable phone app (EAS Build)

> Expo Go is fine for learning. For a real Syntax install on your phone (and OTA updates), do this part.

### C1. Create / log into Expo

```bash
cd /path/to/drag-code-app/frontend
yarn eas:login
```

- [ ] Browser login succeeds; terminal shows you are logged in

### C2. Link this project to Expo

```bash
yarn eas:init
yarn eas:configure
```

- [ ] `frontend/app.json` no longer contains `REPLACE_WITH_EAS_PROJECT_ID`
- [ ] `frontend/app.json` no longer contains `REPLACE_WITH_EXPO_USERNAME`

Commit the change:

```bash
cd /path/to/drag-code-app
git add frontend/app.json
git commit -m "Link Expo EAS project"
git push origin main
```

(Use a branch + PR if you prefer not to push straight to `main`.)

### C3. Point the **phone build** at a reachable API

The phone **cannot** use `http://localhost:8000` unless you only test on a simulator on the same machine.

Pick one:

**Option 1 — Laptop API + same Wi‑Fi (quick test)**

```bash
# example — use YOUR laptop LAN IP
npx eas-cli secret:create --name EXPO_PUBLIC_BACKEND_URL --value http://192.168.1.42:8000 --scope project
```

**Option 2 — Deployed API (recommended for real use)** — finish Part D first, then:

```bash
npx eas-cli secret:create --name EXPO_PUBLIC_BACKEND_URL --value https://YOUR-API-HOST --scope project
```

- [ ] Secret created (or set under the `preview` profile `env` in `eas.json` — see [EAS.md](./EAS.md))

### C4. Build a preview app

> Step-by-step Android-first walkthrough: **[FIRST_EAS_ANDROID.md](./FIRST_EAS_ANDROID.md)**

**Android (easiest):**

```bash
cd /path/to/drag-code-app/frontend
npx eas-cli build --profile preview --platform android
```

**iOS (needs Apple Developer account):**

```bash
npx eas-cli build --profile preview --platform ios
```

- [ ] Build finishes on [expo.dev](https://expo.dev) dashboard
- [ ] You install the APK / IPA / TestFlight link on your phone
- [ ] App opens (not Expo Go)

### C5. Smoke test on the installable app

Repeat Part B3 smoke tests on the EAS build.

- [ ] Register / login works against your API URL
- [ ] Run works
- [ ] AI works with OpenRouter key (mobile)

### C6. (Optional) Push a JS-only update later

After you change only JS/TS screens:

```bash
cd /path/to/drag-code-app/frontend
yarn eas:update:preview -- --message "Describe what changed"
```

- [ ] Force-quit and reopen the **EAS-built** app; update appears  
  (This never applies inside Expo Go.)

---

## Part D — Deploy the API so the phone works without your laptop

Without this, cloud sync / run / snippets die when you close your laptop.

### D1. Choose a host

Examples: a small VPS, Railway, Fly.io, Render, or any Docker host. You need:

- MongoDB reachable by the API
- HTTPS URL for the API (best practice)
- Ability to set environment variables from `backend/.env.example`

### D2. Set production environment on the host

Minimum:

```bash
MONGO_URL=...your mongo connection string...
DB_NAME=syntax_ide
JWT_SECRET=...long random secret different from laptop...
REQUIRE_AUTH=true
CORS_ORIGINS=https://your-frontend-origin,exp://*
SANDBOX_USE_DOCKER=true
REQUIRE_DOCKER=true
RUNNER_URL=http://runner:8001
# optional:
# RUNNER_API_KEY=...
# OPENROUTER_API_KEY=...   # only if you want server /api/chat/stream
```

- [ ] API health URL returns JSON: `https://YOUR-API-HOST/api/`

### D3. Prefer Docker runner in production

Use `docker compose up -d` (mongo + api + runner) on the host, or equivalent.

- [ ] `/api/run` works while logged in
- [ ] Process-sandbox fallback is **not** your only protection on a public internet host

### D4. Point the app at production

- [ ] Update `frontend/.env` locally if needed
- [ ] Update EAS secret `EXPO_PUBLIC_BACKEND_URL` to `https://YOUR-API-HOST`
- [ ] Rebuild preview **or** ship an EAS Update if only JS changed and runtime matches

---

## Part E — “Fully operational” product checklist (after it runs)

Do these when you want a real product, not just a working personal install.

### Accounts & security

- [ ] Strong unique `JWT_SECRET` in production
- [ ] HTTPS only for API
- [ ] Move JWT from AsyncStorage → SecureStore on native (code improvement)
- [ ] Password reset / email verification (not built yet)
- [ ] Rate-limit `/auth` and `/run` (not built yet)

### Plans & billing

- [ ] Stop trusting client `X-Tier` header alone
- [ ] Store plan on the user in Mongo
- [ ] Wire Stripe or RevenueCat; remove Plan & usage “dev toggle”

### AI

- [ ] Document clearly: web = Puter, mobile = OpenRouter BYOK
- [ ] Decide whether to keep unused server `/api/chat/stream` or wire the UI to it

### Search & snippets

- [ ] Keyword search is enough for v1 — OR —
- [ ] Implement real vector search (`docs/VECTOR_SEARCH.md` Phase 2+)

### Stores & CI

- [ ] Apple Developer + Play Console accounts
- [ ] Production EAS profile build + store submit
- [ ] GitHub `EXPO_TOKEN` secret + green EAS Update workflow
- [ ] Privacy policy / terms if distributing publicly

---

## Daily loop (once standing)

| Goal | Commands |
|------|----------|
| Code on laptop | Terminal 1: API (`uvicorn…`). Terminal 2: `cd frontend && yarn start` |
| Pull latest | `git pull origin main` then `cd frontend && yarn install` |
| Phone testers (EAS app) | `yarn eas:update:preview -- --message "…"` |
| New native modules / SDK bump | New `eas build` (OTA cannot ship native changes) |

---

## Troubleshooting cheat sheet

| Symptom | Fix |
|---------|-----|
| `uvicorn: command not found` | Activate `.venv` first (`source .venv/bin/activate`) |
| API JSON page won’t load | Is Docker mongo up? Is uvicorn running on 8000? |
| App says auth / network error | Check `EXPO_PUBLIC_BACKEND_URL`; phone needs LAN IP or deployed HTTPS URL, not `localhost` |
| Cloud sync blocked | Register/login first; open drawer → Plan & usage → toggle Pro (dev) |
| Run fails / exit ≠ 0 | Check API logs; locally set `SANDBOX_USE_DOCKER=false` |
| AI does nothing on phone | Gear → paste OpenRouter key; key stays on device |
| AI on web asks for Puter | Sign in when prompted — expected |
| EAS build complains about projectId | Finish C2; placeholders must be gone from `app.json` |
| OTA update never appears | Must be EAS-built app, not Expo Go; force-quit and reopen |
| `docker compose` errors | Start Docker Desktop; retry |

---

## Progress tracker (print / copy)

```
Part A — Backend API + Mongo .............. [ ]
Part B — Expo on laptop + smoke tests .... [ ]
Part C — EAS phone install + smoke ....... [ ]
Part D — Deployed API + app pointed at it  [ ]
Part E — Production hardening / billing .. [ ]  (later)
```

**Definition of “fully operational” for a personal install:** Parts **A + B + C**, with the phone talking to either your laptop LAN API or (better) Part **D**.
