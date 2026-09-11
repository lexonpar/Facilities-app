# TestFlight — FacilitiesChecklist iOS

Native shell app that loads your live web app:

**https://on-par-checklists.vercel.app**

## Before you archive

### 1. Production website (Vercel) — already live?

Your app URL is already set. Open it in Safari on your phone:

**https://on-par-checklists.vercel.app**

- If **submit** and **manager login** work there, you do **not** need `npx vercel --prod` right now.
- If something fails (blank page, Supabase errors), fix **Vercel env vars** (step 2 below), then redeploy.

#### What is `npx vercel --prod`? (only when you change code)

That command uploads a **new build** from your Mac to Vercel **production**. Use it when:

- You changed the Next.js app on your computer and want those changes live, **or**
- You never connected GitHub and need a first deploy from the terminal.

**You usually skip it** if:

- The site already works at https://on-par-checklists.vercel.app, and
- You deploy by **pushing to GitHub** (Vercel auto-deploys on push).

From the repo root, if you do need a manual deploy:

```bash
cd /Users/derekpethel/Desktop/FacilitiesChecklist
npx vercel --prod
```

(Log in to Vercel if prompted. This updates production to match your local folder.)

### 2. Vercel environment variables (important)

In [Vercel Dashboard](https://vercel.com) → **on-par-checklists** → **Settings → Environment Variables**, set for **Production**:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public key (or anon key) |

After adding or changing vars, click **Redeploy** on the latest deployment (or run `pnpm dlx vercel --prod` once).

### 3. iOS app URL — already configured

**`ios/Config/Release.xcconfig`** is set to:

```
WEB_APP_URL = https:/$()/on-par-checklists.vercel.app
```

Rebuild/archive in Xcode after any change to this file. (Keep `/$()/` — it escapes `//` in xcconfig files.)

### 4. App icon (required for App Store Connect)

In Xcode: **FacilitiesChecklist → Assets → AppIcon** → drag a **1024×1024** PNG.

---

## Xcode setup (one time)

1. Open **`ios/FacilitiesChecklist.xcodeproj`** (inside the **`ios`** folder on Desktop).
2. **FacilitiesChecklist** target → **Signing & Capabilities** → set **Team**.
3. Bundle ID: `com.onparentertainment.facilitieschecklist` (change if taken).
4. Run on your **iPhone** once — you should see the same site as in Safari.

---

## App Store Connect (one time)

1. [App Store Connect](https://appstoreconnect.apple.com) → **Apps** → **+** → **New App**.
2. **Platform:** iOS  
3. **Name:** On Par Facilities  
4. **Bundle ID:** `com.onparentertainment.facilitieschecklist`  
5. **SKU:** `facilities-checklist`

---

## Upload to TestFlight

1. In Xcode, destination: **Any iOS Device (arm64)**.
2. **Product → Archive**.
3. **Distribute App** → **App Store Connect** → **Upload**.
4. Export compliance: **No** (standard HTTPS only).

Processing in TestFlight: about **5–30 minutes**.

---

## Internal only (your team — not public)

**Important:** **Distribute App → App Store Connect → Upload** only sends the build to Apple’s servers. It does **not** put the app on the public App Store. Nobody can download it from the App Store unless you later submit for **App Store Review** and **release** it yourself.

For **coworkers only**, use **Internal Testing** only:

### After upload (App Store Connect)

1. Go to [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → your app → **TestFlight**.
2. Wait until the build shows **Ready to Test** (not “Processing”).
3. Open the **Internal Testing** section (left sidebar under TestFlight).
4. Create or use the default group **“App Store Connect Users”** (or a custom internal group).
5. Click **+** next to **Testers** and add people by email.

### Who can be internal testers?

- They must be invited under **Users and Access** in App Store Connect with a role (e.g. Developer, Marketing, Admin), **or**
- They appear automatically if they’re already on your App Store Connect team.

Internal testing allows up to **100** testers. No public App Store listing. No “anyone with a link” unless you turn on **External Testing** (don’t use that if you want team-only).

### What to avoid (stays private)

| Don’t do this | Why |
|---------------|-----|
| **External Testing** + public link | Anyone with the link can join (after beta review) |
| **App Store** tab → **Add for Review** / **Release** | That’s the real public launch |

### Coworker steps

1. Install **TestFlight** from the App Store on their iPhone.
2. They get an **email invite** (or see the app in TestFlight if they’re on your team).
3. Accept → install **On Par Facilities**.

No App Store search. No public listing.

---

## Troubleshooting

| Problem | Fix |
|--------|-----|
| White screen in iOS app | Confirm https://on-par-checklists.vercel.app works in Safari |
| Submit works on web, not app | Same URL — clear app and reinstall; check Release build |
| Manager can’t complete issues | Add `SUPABASE_SERVICE_ROLE_KEY` on Vercel, redeploy |
| Archive signing error | Set **Team** under Signing & Capabilities |
