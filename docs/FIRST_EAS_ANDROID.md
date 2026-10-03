# First EAS Android build (Syntax IDE)

**Goal:** Install a real Syntax IDE APK on your Android phone — **without Expo Go**.

Do these steps **on your laptop**, in order. Check a box only after you see the expected result.

> iOS needs an Apple Developer account ($99/year). Start with **Android** even if your daily phone is iPhone — you can use an Android emulator, a cheap test phone, or borrow a device. For iPhone-only, jump to the iOS note at the end after you finish the Expo project link steps.

---

## Before you start

- [ ] Free account at [expo.dev](https://expo.dev) (sign up / log in in the browser once)
- [ ] Node 20+ and Yarn on the laptop
- [ ] Repo on `main`, latest code:

```bash
cd /path/to/ONE-Syntax-IDE   # or drag-code-app
git checkout main
git pull origin main
cd frontend
yarn install
```

- [ ] Optional but smart: prove the app in the browser first:

```bash
yarn start
# press w
```

If web works, your project is healthy.

---

## Part A — One-time Expo project link (10 minutes)

```bash
cd frontend
yarn eas:login
```

- [ ] Browser login succeeds; terminal shows you are logged in

```bash
yarn eas:init
```

- [ ] Prompts ask to create/link a project — accept defaults for **Syntax IDE** / `syntax-ide` if offered

```bash
yarn eas:configure
```

- [ ] Open `frontend/app.json`
- [ ] There is **no** `REPLACE_WITH_EAS_PROJECT_ID` left
- [ ] There is **no** `REPLACE_WITH_EXPO_USERNAME` left

Commit and push (use a branch + PR if you prefer review-first):

```bash
cd ..
git add frontend/app.json
git commit -m "Link Expo EAS project for Syntax IDE"
git push
```

---

## Part B — Tell the phone build where your API is

The installed app **cannot** use `http://localhost:8000` on a real phone.

Pick **one**:

### Option 1 — Laptop API + same Wi‑Fi (fine for first test)

1. Find laptop LAN IP (example `192.168.1.42`)
2. Backend running: `uvicorn server:app --reload --host 0.0.0.0 --port 8000`
3. Set EAS secret:

```bash
cd frontend
npx eas-cli secret:create --name EXPO_PUBLIC_BACKEND_URL --value http://192.168.1.42:8000 --scope project
```

### Option 2 — No API yet (UI-only first install)

Skip the secret. Local editor still works; cloud sync / Run / login need an API later.

### Option 3 — Deployed HTTPS API (best long-term)

```bash
npx eas-cli secret:create --name EXPO_PUBLIC_BACKEND_URL --value https://YOUR-API-HOST --scope project
```

- [ ] You chose Option 1, 2, or 3

---

## Part C — Build the Android APK (cloud build)

```bash
cd frontend
npx eas-cli build --profile preview --platform android
```

- [ ] CLI asks a few questions the first time (Android credentials) — choose **Generate new** / Expo-managed if unsure
- [ ] Terminal prints a build URL on [expo.dev](https://expo.dev)
- [ ] Wait until status is **finished** (often 10–20 minutes)

---

## Part D — Install on the phone

1. Open the build page on expo.dev (from the link in the terminal)
2. Scan the QR / tap **Install** / download the `.apk`
3. On Android, allow install from browser if prompted
4. Open **Syntax IDE** (not Expo Go)

- [ ] App launches to the dark amber editor

### Smoke test on the APK

| # | Action | Expected |
|---|--------|----------|
| 1 | Create / open a file | Editor works |
| 2 | Drawer → Local sync | Projects persist on device |
| 3 | Auth → Register (if API reachable) | Login works |
| 4 | Run `print(2+2)` (if API reachable) | Console shows `4` |
| 5 | AI → gear → OpenRouter key → send | Reply streams |

- [ ] Core UI works even if API steps are skipped for now

---

## Part E — After you change JS later (no new APK)

Only after this first APK exists:

```bash
cd frontend
yarn eas:update:preview -- --message "Describe what changed"
```

- [ ] Force-quit Syntax IDE and reopen — update appears  
  (Never works inside Expo Go)

---

## iPhone note

After Part A is done:

```bash
npx eas-cli build --profile preview --platform ios
```

Requires Apple Developer Program. Install via the Expo dashboard / TestFlight flow Expo guides you through.

---

## Stuck? Common fixes

| Symptom | Fix |
|---------|-----|
| `REPLACE_WITH_…` still in `app.json` | Re-run `yarn eas:init` and `yarn eas:configure` |
| Build fails on credentials | Re-run build; pick “Generate new keystore” managed by Expo |
| App opens but login/run fail | API URL wrong — use LAN IP or HTTPS; not `localhost` |
| “Project not found” | You are logged into a different Expo account than the one that owns the project |
| Want zero phone pain today | `yarn start` → press `w` and keep building on web |

---

## Progress

```
Part A — Link Expo project ........... [ ]
Part B — Backend URL for the build .... [ ]
Part C — Android preview build ........ [ ]
Part D — Install + smoke test ......... [ ]
Part E — OTA updates (later) .......... [ ]
```

**Done for “over the hump”:** Parts A–D. You now have a real phone app, independent of Expo Go.
