# On Par Entertainment — Facilities Checklist

Maintenance issue reporting for floor staff and a MaintainX-style manager dashboard with **real-time** updates.

Active employees sign in at `/login` by choosing their name and entering their
7shifts Punch ID. Facilities delegates verification to ShiftFlow and never
stores raw Punch IDs. A separate email/PIN sign-in remains available for admin
accounts.

## Quick start

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In **SQL Editor**, run in order:
   - `supabase/migrations/001_issues.sql`
   - `supabase/migrations/002_realtime_rls_storage.sql`
3. In **Database → Replication**, confirm `issues` is enabled for Realtime (the migration adds it to `supabase_realtime`).
4. Copy **Project URL**, **anon key**, and **service_role key** from Settings → API.

### 2. Environment variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Fill in:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key (submit + live dashboard) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only (manager complete/recall) |
| `MANAGER_PIN` | Shared PIN for `/lead` |

Add the same variables in **Vercel** → Project → Settings → Environment Variables.

### 3. Run locally

```bash
npm install
npm run dev
```

- **Report issue:** http://localhost:3000/submit  
- **Manager dashboard:** http://localhost:3000/lead (enter `MANAGER_PIN`)

New submissions appear on the dashboard **immediately** via Supabase Realtime.

## Deploy (Vercel)

**Production:** https://facilities-checklist.vercel.app

Set env vars in the Vercel dashboard (Production): Supabase URL/keys + `MANAGER_PIN`.

Redeploy only when you change code:

```bash
npx vercel --prod
```

Or push to GitHub if the repo is connected to Vercel (auto-deploy).

## Mobile apps

| Platform | Status | Guide |
|----------|--------|--------|
| **Android** (team internal) | Active now | [android/INTERNAL_TESTING.md](android/INTERNAL_TESTING.md) |
| **iOS** TestFlight internal | Paused — Apple account verification | [NOTES-DISTRIBUTION.md](NOTES-DISTRIBUTION.md), [ios/TESTFLIGHT.md](ios/TESTFLIGHT.md) |

Production web URL for both apps: **https://facilities-checklist.vercel.app**

## GitHub

```bash
git remote add origin https://github.com/Derekonpar/FacilitiesChecklist.git
git push -u origin main
```
