# Distribution notes — On Par Facilities

## 📌 PINNED: iOS / TestFlight (waiting on Apple account)

**Status:** Paused while **Apple / App Store Connect account verification** completes.

**Already done:**
- iOS app project: `ios/FacilitiesChecklist.xcodeproj`
- Bundle ID: `com.onparentertainment.facilitieschecklist`
- Production URL wired: https://on-par-checklists.vercel.app
- Archive built with valid bundle identifier (see Xcode Organizer, Jun 1 2026)

**When verification is approved — resume here:**
1. Xcode → **Window → Organizer** → latest archive (or **Product → Archive** again).
2. **Distribute App** → **App Store Connect** → **Upload** (upload only — **not** a public App Store release).
3. App Store Connect → **TestFlight** → **Internal Testing** only (team members, up to 100).
4. **Do not** enable External Testing or submit **App Store Review / Release** until we want a public launch.

Full checklist: `ios/TESTFLIGHT.md`

---

## ✅ ACTIVE NOW: Android — internal team install

**Status:** Use Android while iOS is pinned.

**App project:** `android/` (WebView shell → same Vercel site + Supabase backend).

**Team install options (internal only):**
1. **Google Play Console → Internal testing** (recommended once Play developer account is ready) — see `android/INTERNAL_TESTING.md`
2. **Share release APK** directly (fastest today) — build in Android Studio, send file to coworkers, they enable “Install unknown apps” for that source

**Production web app (all platforms):** https://on-par-checklists.vercel.app

---

## Shared config (all platforms)

| Item | Value |
|------|--------|
| Vercel URL | https://on-par-checklists.vercel.app |
| Sign-in | Employees: 7shifts Punch ID; owner: signed Staff Tools handoff |
| Supabase | Migrations in `supabase/migrations/` |
