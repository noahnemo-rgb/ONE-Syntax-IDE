# First EAS iOS build (Syntax IDE) — your iPhone

**Goal:** Install a real Syntax IDE app on **your iPhone** — **without Expo Go**.

Do these on your **laptop** (Mac, Windows, or Linux all work — the build runs in Expo’s cloud).  
Check a box only after you see the expected result.

> **Money note:** Apple Developer Program is about **US $99 / year**. Required for a real install on your iPhone and for App Store monetization later.

Related: [EAS.md](./EAS.md) · [STANDUP.md](./STANDUP.md) · Android twin: [FIRST_EAS_ANDROID.md](./FIRST_EAS_ANDROID.md) (if present / PR merged)

---

## Before you start

- [ ] iPhone + cable or Wi‑Fi (for install / TestFlight)
- [ ] Free [expo.dev](https://expo.dev) account (same one you’ll use every time)
- [ ] Node 20+ and Yarn on the laptop
- [ ] Latest Syntax code:

```bash
cd /path/to/ONE-Syntax-IDE
git checkout main
git pull origin main
cd frontend
yarn install
```

- [ ] Optional sanity check (no phone needed):

```bash
yarn start
# press w — editor should open in the browser
```

---

## Part A — Enroll in Apple Developer Program

1. On a computer, open [developer.apple.com/programs](https://developer.apple.com/programs/)
2. Click **Enroll** / **Start Your Enrollment**
3. Sign in with the **Apple ID you use on your iPhone** (strongly recommended)
4. Choose **Individual** (unless you already have a company/legal entity)
5. Pay the fee and complete identity verification

- [ ] Enrollment status is **Active** at [developer.apple.com/account](https://developer.apple.com/account)

**If status is Pending:** wait for Apple email (sometimes same day, sometimes 1–2 days).  
Do **Part B** while you wait — you can link Expo without finishing Apple yet.  
**Part C+ need Active status.**

### Agree to agreements

- [ ] In Apple Developer / App Store Connect, accept any **Paid Apps** / latest license agreements if prompted  
  ([appstoreconnect.apple.com](https://appstoreconnect.apple.com))

---

## Part B — One-time Expo project link

```bash
cd frontend
yarn eas:login
yarn eas:init
yarn eas:configure
```

- [ ] Logged into Expo in the terminal
- [ ] `frontend/app.json` has **no** `REPLACE_WITH_EAS_PROJECT_ID`
- [ ] `frontend/app.json` has **no** `REPLACE_WITH_EXPO_USERNAME`

Commit:

```bash
cd ..
git add frontend/app.json
git commit -m "Link Expo EAS project for Syntax IDE"
git push
```

(Use a branch + draft PR if you want to review before `main`.)

---

## Part C — Connect Expo to Apple (credentials)

EAS will create/manage iOS certificates and provisioning for you. Easiest path: **let Expo manage credentials**.

```bash
cd frontend
npx eas-cli credentials
```

Or just start a build (Part E) and answer the prompts:

- [ ] When asked about iOS credentials → **Expo handles credentials** / **Generate new** (recommended for novices)
- [ ] Sign in with your **Apple ID** (Developer account) when the CLI opens a browser / asks for password + 2FA

You may be asked for an **App Store Connect API key** later for TestFlight submit; for a first **preview install** you often only need Apple login + device registration.

---

## Part D — Register your iPhone for internal/preview installs

Internal iOS builds are tied to device UDIDs until you use TestFlight.

### Option 1 — Expo device registration (common with `distribution: "internal"`)

1. On the iPhone, open Safari and follow Expo’s device registration link when the CLI prints it, **or** run:

```bash
cd frontend
npx eas-cli device:create
```

2. Scan the QR / open the link **on the iPhone**
3. Follow prompts to install a profile / allow registration
4. Confirm the device appears in the list

- [ ] Your iPhone is registered with EAS for this Expo account

### Option 2 — Skip to TestFlight (Part F)

If you prefer not to register a UDID, build for store and use **TestFlight** (Part F). Slightly more App Store Connect clicking; very reliable for personal use.

---

## Part E — Point the build at a reachable API

The iPhone **cannot** use `http://localhost:8000`.

| Choice | When | Command / action |
|--------|------|------------------|
| **A. UI only** | First install; cloud/Run later | Skip secret for now |
| **B. Laptop API** | Same Wi‑Fi testing | Secret → `http://YOUR.LAN.IP:8000` + API with `--host 0.0.0.0` |
| **C. Deployed API** | Real daily use | Secret → `https://YOUR-API-HOST` |

```bash
cd frontend
# Example for laptop LAN — replace IP:
npx eas-cli secret:create --name EXPO_PUBLIC_BACKEND_URL --value http://192.168.1.42:8000 --scope project
```

- [ ] Chose A, B, or C

Local editor still works with A. Login / cloud / Run need B or C.

---

## Part F — Build the iOS preview

Your repo’s `eas.json` already has a `preview` profile (`distribution: "internal"`).

```bash
cd frontend
npx eas-cli build --profile preview --platform ios
```

- [ ] CLI finishes uploading; you get a build URL on [expo.dev](https://expo.dev)
- [ ] Build status becomes **finished** (often 15–30 minutes the first time)

**If the build fails on provisioning / device:**  
re-run `npx eas-cli device:create`, confirm the iPhone is selected for the ad hoc profile, rebuild.

### Alternate: TestFlight path (store distribution)

If internal install is painful, use store + TestFlight:

1. Temporarily use production-like submit, **or** add a profile (advanced) with `"distribution": "store"` for a `preview-testflight` profile  
2. Build iOS  
3. `npx eas-cli submit --platform ios` (follow prompts; may create app in App Store Connect)  
4. Install **TestFlight** from the App Store on your iPhone  
5. Accept the internal testing invite / open the build in TestFlight  

For a first personal build, **internal + device:create** is usually enough.

---

## Part G — Install on your iPhone

### If you used internal / ad hoc (Part F default)

1. Open the finished build page on expo.dev (phone or laptop)
2. Install from the QR / link **on the iPhone**
3. If iOS blocks the app: **Settings → General → VPN & Device Management** → trust the developer certificate
4. Open **Syntax IDE** (home screen icon — **not** Expo Go)

### If you used TestFlight

1. Open **TestFlight** → Syntax IDE → **Install**
2. Open Syntax IDE from the home screen

- [ ] Syntax IDE launches to the dark amber editor

### Smoke test

| # | Action | Expected |
|---|--------|----------|
| 1 | Type in the editor / create a file | Works offline (local) |
| 2 | Drawer → projects | Local sync works |
| 3 | Account → Register (API reachable) | Login succeeds |
| 4 | Run `print(2+2)` (API reachable) | Console shows `4` |
| 5 | AI → gear → paste OpenRouter key → send | Reply streams |

- [ ] Personal daily use is viable (at least local editor + AI BYOK)

---

## Part H — Later: monetize (both stores)

Not required for your first install. When ready:

1. Google Play Console (~$25 one-time) + Android EAS production build  
2. App Store Connect listing (screenshots, privacy policy, age rating)  
3. Replace Free/Pro **dev toggle** with real IAP (e.g. RevenueCat)  
4. Store **Pro** on the user in your API — don’t trust client `X-Tier` alone  
5. Production EAS builds:  
   `npx eas-cli build --profile production --platform all`

---

## Day-to-day after the first iOS build

| Goal | What to do |
|------|------------|
| Change JS/UI only | `yarn eas:update:preview -- --message "…"` then force-quit & reopen Syntax |
| Change native modules / SDK / plugins | New `eas build --profile preview --platform ios` |
| Laptop coding | Still use `yarn start` + web (`w`) or Expo Go for quick UI |
| Daily driver | Use the **EAS-built** Syntax icon on the phone |

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Apple enrollment pending | Wait for Active; finish Part B meanwhile |
| `Authentication with Apple Developer Portal failed` | App-specific password / 2FA; retry `eas build`; use Expo-managed credentials |
| No devices / provisioning error | `npx eas-cli device:create` on the iPhone link; rebuild |
| Untrusted developer | Settings → General → VPN & Device Management → Trust |
| App opens, login/run fail | `EXPO_PUBLIC_BACKEND_URL` is `localhost` or wrong IP — use LAN IP or HTTPS |
| Expo Go still opens | You’re launching the wrong icon — use **Syntax IDE** from the EAS/TestFlight install |
| `REPLACE_WITH_…` in app.json | Re-run `yarn eas:init` and `yarn eas:configure` |
| Build free tier limits | Wait or upgrade Expo plan; retry later |

---

## Progress tracker

```
Part A — Apple Developer Active .......... [ ]
Part B — Expo project linked ............. [ ]
Part C — Apple credentials via EAS ....... [ ]
Part D — iPhone registered (or TestFlight) [ ]
Part E — API URL strategy chosen ......... [ ]
Part F — iOS preview build finished ...... [ ]
Part G — Installed + smoke test .......... [ ]
Part H — Monetize both stores (later) .... [ ]
```

**“Over the hump” for you:** Parts **A–G**.  
You then have a personal iPhone Syntax IDE independent of Expo Go, on the same codebase you’ll ship to Android later.
