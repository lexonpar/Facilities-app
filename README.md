# On Par Entertainment — Facilities Checklist

Maintenance issue reporting for floor staff and a MaintainX-style manager dashboard with **real-time** updates.

Active employees sign in at `/login` by choosing their name and entering their
7shifts Punch ID. Facilities delegates verification to ShiftFlow and never
stores raw Punch IDs. New roster accounts start as Staff; Facilities Admins can
promote specific people from Team permissions.

The Staff Tools owner uses a separate signed SSO handoff and explicit owner
mapping. That account is not part of the employee roster, cannot be deactivated
by roster sync, and is deliberately initialized as Facilities Admin. Roster
employees are never promoted by this flow.

### Shared devices and Staff Tools transitions

The new Staff Tools employee-launch/logout protocol is **disabled by default**.
Facilities must be deployed and tested first; only then enable the matching
Staff Tools sender. Set `STAFF_TOOLS_SESSION_TRANSITION_ENABLED=true` in
Facilities to accept the protocol. Leaving the flag unset returns 404 from its
new routes and keeps existing sign-in and owner SSO working.

The sender uses a 45-second Ed25519 assertion with a separate session-transition
audience and purpose. The browser posts it to `/api/auth/staff-tools/start`,
visits `/auth/staff-tools/continue` to receive existing SameSite=Lax cookies,
and submits a same-origin form to `/api/auth/staff-tools/complete`. Assertions
never appear in URLs, and this protocol cannot create a Supabase session or
promote anyone. It preserves a session only if its active roster identity
matches `(shiftflow, on-par, Staff Tools employeeId)`, its browser profile
binding matches, and it is not an owner account. Otherwise it clears Facilities
auth and requires normal sign-in. Existing sessions without a browser binding
sign in once when they first use the enabled transition.

`STAFF_TOOLS_ORIGIN` overrides the exact trusted Staff Tools origin (default
`https://on-par.vercel.app`). The earlier `STAFF_TOOLS_SESSION_TRANSITION_ORIGIN`
alias remains supported; conflicting values are rejected. Back-to-apps and
owner navigation use local `/staff-tools` and `/staff-tools/owner` redirects,
so they follow the same server configuration. HTTPS is required; explicit
development/test environments may use a loopback HTTP origin.
`STAFF_TOOLS_SESSION_TRANSITION_PUBLIC_KEY` optionally overrides the Ed25519
SPKI DER public key encoded as base64; it otherwise uses
`STAFF_TOOLS_OWNER_PUBLIC_KEY`, then the existing production public key outside
isolated mode. Keep private signing keys exclusively in Staff Tools. For isolated
tests, use a generated key pair and a separate test Supabase database.

Successful employee and owner authentication sets an HttpOnly browser profile
binding. A reset blocks that binding; a subsequent explicit sign-in binds it
to the new profile. Web routing and secure API authorization reject a delayed
old-profile refresh even if it rewrites an auth cookie. Reset completion also
notifies other open Facilities tabs to stop refreshing and reload. This cannot
withdraw responses already received by another tab or instantly revoke an
already-issued Supabase access JWT; remote session revocation is limited to the
current session (`scope: local`). An unavailable auth service never prevents
local cookie cleanup, and completion shows a warning with a fixed Continue
link when remote revocation could not be confirmed.

Offline tests can be run from this nested repository using the parent project's
installed Vitest: `node ../node_modules/vitest/vitest.mjs run --config vitest.config.mts`.
Tests generate synthetic keys and mock all session operations; they do not call
the deployed apps or change database records.

Verification of the shared-device change: all 41 original offline tests passed, the complete
repository ESLint check passed, and a full Next.js production build passed in
an isolated source copy with its own cloned dependencies and no environment
files or Supabase credentials. The build fetched only its public Google Fonts;
the initial sandboxed attempt failed at that font download and succeeded when
network access was available. TypeScript and static-page generation completed,
including all three new transition routes. Tests are excluded from production
compilation because the nested repository currently uses the parent test
runner; source and tests were also typechecked together separately. This
verification does not establish live Supabase revocation or production rollout
behavior; verify those using isolated test accounts before enabling the sender.

### Isolated staging

Use a separate Supabase project, separate test signing keys, and a ShiftFlow
staging service containing synthetic employees. A Vercel preview URL alone
does not isolate authentication, issue records, photos, or Realtime. The
production project was identified as `rzwjremunktgceiojnup.supabase.co` from the
[deployed login page’s public client configuration](https://on-par-checklists.vercel.app/login).
Its display name in an account dashboard is not proof of which app uses it.

| Setting | Facilities website | Separate Supabase auth broker |
| --- | --- | --- |
| `FACILITIES_ISOLATED_STAGING` | `true` | `true` |
| `FACILITIES_PRODUCTION_SUPABASE_HOSTNAME` | Verified production hostname | Same verified production hostname |
| `SHIFTFLOW_ORIGIN` | Explicit staging origin | Same staging origin |
| `SHIFTFLOW_STAGING_API_TOKEN` | Optional private Sites access token, server only | Same private staging token |
| `STAFF_TOOLS_ORIGIN` | Explicit Staff Tools staging origin | Not needed by the broker |
| `STAFF_TOOLS_OWNER_PUBLIC_KEY` | Test Ed25519 SPKI DER key, base64 | Same test public key |
| `NEXT_PUBLIC_SUPABASE_URL` | Separate project URL | Not used |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Separate project publishable key | Not used |
| `SUPABASE_URL` and built-in auth keys | Do not add service-role keys to the website | Supplied by the separate Supabase project |

The website validates this configuration before building because public
Supabase settings are embedded in browser code. Runtime validation also runs
before web and broker service calls. Both reject known production application
hosts, the verified production database hostname, and the operator-supplied
production hostname, including case/trailing-dot variations. Production
signing keys are rejected in isolated mode. These checks cannot prove that an
unknown alias or reverse proxy uses a separate database; verify the actual
project identity before testing writes. Credential-bearing HTTP requests reject
redirects instead of forwarding credentials to a different service.

For a private Sites staging service, configure `SHIFTFLOW_STAGING_API_TOKEN` in
the website server and separate auth broker, then redeploy both with this code.
Only isolated staging sends `OAI-Sites-Authorization: Bearer <token>` to the
explicit HTTPS ShiftFlow origin's `/api/shiftflow` endpoint. Roster loading,
Punch verification, and temporary-session cleanup use it. It is ignored in
production mode, never sent to Supabase hosts or browser navigation, and never
forwarded through redirects. The token opens the private hosting gate; normal
Punch ID and owner authentication still apply. Leave it unset for public or
local staging services; never create a `NEXT_PUBLIC` variant.

Apply the existing migrations and deploy `facilities-auth` to the separate
project with JWT verification disabled, using the same staging origin and
public-key settings as the website. The broker still verifies Punch IDs and
owner assertions itself; no authentication bypass is added. Its existing
owner identity can be a test fixture in this separate database. The existing
`issue-photos` bucket, RLS policies, and Realtime publications come from the
migrations. Realtime, uploads, photo URLs, auth, and broker calls all use the
configured Supabase project. Do not copy production Auth users, live photos,
or private issue records into test fixtures.

The broker defaults to production HTTPS rules; local function tests may set
`NODE_ENV=development` or `test` with an explicit loopback HTTP origin. Website
and broker staging flags default off for compatibility. Configuration failures
return unavailable responses instead of silently selecting production. Explicit
local sign-out still clears browser cookies when a service or configuration
check fails. Enabling these settings does not provision or deploy any resources.

Staging-readiness validation: 78 offline tests passed, including the actual
Edge handler running with synthetic Deno globals and mocked network/database
clients. Full website lint, explicit shared-config/broker lint, website/test
TypeScript, and separate broker TypeScript checks passed. A fresh production
build also passed with isolated mode enabled, generated test public-key data,
synthetic service URLs, and no real credentials or environment files. Its
rendered pages include the test-environment banner. This validates local code
and build behavior, not a deployed Supabase function or a live staging database.

Use the web staging URLs for this test round. The Android app still points its
webview at production, and the iOS configuration defaults to production unless
its app URL is explicitly overridden. Native test-build configuration remains
a separate step; the website's staging flag does not change installed apps.

## Quick start

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Apply every file in `supabase/migrations/` in filename order.
3. Deploy `supabase/functions/facilities-auth` with JWT verification disabled.
   The function verifies the Punch credential before a Supabase JWT exists.
   The same broker verifies Staff Tools owner assertions with its configured
   Ed25519 public key and stores only hashed, 60-second, single-use tickets.
4. Confirm `issues`, `maintenance_items`, and `profiles` are enabled for
   Realtime (the migrations add them).
5. Copy the Project URL and publishable key from Settings → API.

### 2. Environment variables

Copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Fill in:

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser/server publishable key |

The deployed Vercel app does not receive a Supabase service-role key. The
Supabase Edge Function uses its built-in server credentials.

No shared owner secret is configured in Facilities or Supabase. Only the Staff
Tools Vercel project holds the matching Ed25519 private key in the server-only
`FACILITIES_OWNER_SIGNING_KEY` variable.

### 3. Run locally

```bash
pnpm install
pnpm dev
```

- **Report issue:** http://localhost:3000/submit  
- **Manager dashboard:** http://localhost:3000/lead

New submissions appear on the dashboard **immediately** via Supabase Realtime.

## Deploy (Vercel)

**Production:** https://on-par-checklists.vercel.app

Configure each environment separately. Production uses its production project;
Preview and Development tests use the isolated-staging settings and a separate
project. Do not copy production database settings into a test deployment.

Rebuild after code or environment changes, especially `NEXT_PUBLIC_` settings
which are embedded in the browser bundle:

```bash
pnpm dlx vercel --prod
```

Or push to GitHub if the repo is connected to Vercel (auto-deploy).

## Mobile apps

| Platform | Status | Guide |
|----------|--------|--------|
| **Android** (team internal) | Active now | [android/INTERNAL_TESTING.md](android/INTERNAL_TESTING.md) |
| **iOS** TestFlight internal | Paused — Apple account verification | [NOTES-DISTRIBUTION.md](NOTES-DISTRIBUTION.md), [ios/TESTFLIGHT.md](ios/TESTFLIGHT.md) |

Production web URL for both apps: **https://on-par-checklists.vercel.app**

## GitHub

```bash
git remote add origin https://github.com/Derekonpar/FacilitiesChecklist.git
git push -u origin main
```
