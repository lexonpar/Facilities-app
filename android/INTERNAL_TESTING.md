# Android — internal team install (Google Play)

Same app as iOS: loads **https://on-par-checklists.vercel.app** (Punch-ID issue submission and manager dashboard).

**Not public** — only people you add to the **Internal testing** track can install from Play Store.

---

## Option A — Google Play Internal testing (best for ongoing updates)

### 1. Open the project

1. Install [Android Studio](https://developer.android.com/studio).
2. **File → Open** → choose the **`android`** folder inside `FacilitiesChecklist` on Desktop.
3. Wait for **Gradle sync** to finish.

### 2. Create the app in Play Console (one time)

1. [Google Play Console](https://play.google.com/console) — same Google account as your developer registration.
2. **Create app** → name: **On Par Facilities** → default language → app/game → free.
3. Complete required **Dashboard** tasks (privacy policy URL can be your Vercel site for now; content rating questionnaire; etc.).

### 3. Build a signed release bundle (AAB)

In Android Studio:

1. **Build → Generate Signed App Bundle / APK…**
2. **Android App Bundle** → Next.
3. Create or choose a **keystore** (save passwords somewhere safe).
4. **release** → Finish.

Output: `android/app/release/app-release.aab` (path shown when done).

### 4. Upload to Internal testing

1. Play Console → your app → **Testing → Internal testing**.
2. **Create new release** → upload the **AAB**.
3. **Save** → **Review release** → **Start rollout to Internal testing**.

### 5. Add coworkers (internal only)

1. **Testers** tab → create email list (Gmail addresses they use on their phones).
2. Copy the **opt-in link** and send it to your team.
3. They open the link on their Android phone → accept → install from Play Store (test version).

Only people on that list can install. This is **not** production/open to the world.

---

## Option B — Share APK today (no Play Console wait)

Fastest if Play account is still setting up:

1. Android Studio → **Build → Build Bundle(s) / APK(s) → Build APK(s)** (debug or signed release).
2. Find APK: `android/app/build/outputs/apk/release/app-release.apk` (or `debug`).
3. AirDrop / email / Drive the file to coworkers.
4. On each phone: allow install from that source → open APK → install.

Same app; updates require sending a new APK manually.

---

## App details

| Field | Value |
|-------|--------|
| Application ID | `com.onparentertainment.facilitieschecklist` |
| Web URL | https://on-par-checklists.vercel.app |
| Min Android | 8.0 (API 26) |

To change URL later: edit `WEB_APP_URL` in `android/app/build.gradle.kts` and rebuild.

---

## iOS reminder

iOS TestFlight **internal** is paused until Apple account verification — see **`NOTES-DISTRIBUTION.md`** at repo root.
