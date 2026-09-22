# Wibble v1 — Build Plan (Minimal Mirror)

**Engineering plan, 2026-06-16** (rev. 2026-06-17: corrected LibreLinkUp package to `@diakem/libre-link-up-api-client`, dropped trend.ts port since the client returns the trend arrow directly, T0 data-preflight verified)
Source spec: `PRD.md` (v2.0).
Goal: deploy a working app to her phone **tonight**.

---

## Architecture (all-Firebase, one scheduled function)

```
   ┌─────────────────────────────────────────────────────────┐
   │  HER PHONE — PWA (Firebase Hosting)                       │
   │   React + Vite, installed to home screen                 │
   │   - Google sign-in (Firebase Auth)                       │
   │   - reads readings + logs live from Firestore (onSnapshot)│
   │   - writes quick-log entries to Firestore                │
   │   - shows today's appreciation message (in-app, on open) │
   └───────────────▲─────────────────────┬───────────────────┘
        realtime read │                   │ write log entry
                       │                   ▼
   ┌───────────────────┴───────────────────────────────────────┐
   │  FIRESTORE                                                 │
   │   users/{uid}                                              │
   │   users/{uid}/readings/{readingId}                         │
   │   users/{uid}/logs/{logId}                                 │
   │   users/{uid}/appreciation/{yyyy-mm-dd}                    │
   │   Security rules: only request.auth.uid == uid can r/w     │
   └───────────────────▲───────────────────────────────────────┘
          writes readings │ (Admin SDK, bypasses rules)
   ┌───────────────────────┴───────────────────────────────────┐
   │  CLOUD FUNCTION (2nd gen) — onSchedule every 5 min         │
   │   pollGlucose():                                           │
   │     1. read LibreLinkUp creds from Secret Manager          │
   │     2. client.read() → login/JWT/region handled by lib     │
   │        returns { value, isHigh, isLow, trend, date }       │
   │     3. upsert reading → Firestore users/{uid}/readings     │
   │        (trend arrow comes straight from the API, no calc)  │
   └───────────────────────▲───────────────────────────────────┘
                  HTTPS s2s │ (no CORS — server to server)
   ┌───────────────────────┴───────────────────────────────────┐
   │  LibreLinkUp API (Abbott) ← her Libre app feeds this       │
   └────────────────────────────────────────────────────────────┘
```

**Why this shape:** browser cannot call LibreLinkUp (CORS + credential exposure + needs background polling). Cloud Functions + Cloud Scheduler is the built-in Firebase answer, so there is no separate backend to host. Decision accepted by user 2026-06-16.

## Stack

| Concern | Choice | Note |
|---------|--------|------|
| Frontend | React + Vite PWA | `vite-plugin-pwa` for installability/manifest |
| Hosting | Firebase Hosting | `firebase deploy` |
| Auth | Firebase Auth, Google provider only | |
| DB | Firestore | realtime `onSnapshot` for glucose + logs |
| Glucose poll | Cloud Functions 2nd gen + Cloud Scheduler | `onSchedule("every 5 minutes")` |
| LibreLinkUp | `@diakem/libre-link-up-api-client` (scoped pkg) | returns trend arrow directly; pass `clientVersion: "4.9.0"`; do NOT hand-roll the protocol |
| Secrets | Google Secret Manager | follower email + password |
| Plan | Blaze (pay-as-you-go) | free tier covers one user (~$0); card required |

## Data model (Firestore)

```
users/{uid}
  displayName: string
  glucoseConnectionId: string   // LibreLinkUp patient connection id (backend config)
  createdAt: timestamp

users/{uid}/readings/{readingId}     // readingId = reading epoch ms (idempotent upsert)
  valueMgdl: number                // SANITY-CHECK first reading is mg/dL (~80-180), not mmol/L
  trend: TrendType                 // from the LibreLinkUp API directly; map enum→arrow in the UI
  isHigh: boolean                  // from the API
  isLow: boolean                   // from the API
  measuredAt: timestamp            // reading.date from LibreLinkUp
  ingestedAt: timestamp            // server write time

users/{uid}/logs/{logId}
  note: string
  carbs: number | null
  insulinUnits: number | null
  loggedAt: timestamp

users/{uid}/appreciation/{yyyy-mm-dd}   // one per day, date-keyed for stability
  messageId: string
  text: string
  shownAt: timestamp | null
```

Reading doc id = measurement epoch ms → re-polling the same reading upserts instead of duplicating (idempotent, kills the duplicate-reading failure mode).

## Firestore security rules (must-do, P1)

```
match /users/{uid} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
  match /{sub=**} {
    allow read, write: if request.auth != null && request.auth.uid == uid;
  }
}
```

Cloud Function writes via Admin SDK and bypasses these rules. Client never writes `readings` (only the function does); client writes `logs` and reads everything for its own uid.

---

## Test coverage plan

```
CODE PATHS                                          TESTS
(no trend.ts — the LibreLinkUp client returns the trend arrow directly)

[+] functions/src/index.ts → pollGlucose
  ├── [GAP] happy: read() → upserted reading written to Firestore
  ├── [GAP] read() returns null/undefined → warn, no write       [→failure]
  ├── [GAP] read() throws (API down / bad clientVersion) → catch, log, no partial write  [→failure]
  └── [GAP] same reading.date re-polled → upsert by id, no dup    [→regression-guard]
  (login/JWT/region are handled INSIDE the lib — not our code to test;
   mock the lib's read() in unit tests)

USER FLOWS                                          TESTS
[+] First open / sign in
  ├── [GAP] Google sign-in success → Today screen     [→E2E]
  └── [GAP] no readings yet → empty state, not error
[+] Glance at glucose
  ├── [GAP] fresh reading → number + arrow + color
  └── [GAP] stale (>15min) → "updated Xm ago" stale UI [→E2E, safety-critical]
[+] Quick log
  ├── [GAP] note only / note+carbs / note+insulin save
  └── [GAP] empty submit → no-op or validation
[+] Appreciation
  └── [GAP] one message per day, stable across reopens

COVERAGE TARGET: trend.ts ported with its tests; libreClient + pollGlucose
unit-tested with mocked HTTP/Firestore; 2 E2E (sign-in→Today, stale-glucose UI).
```

**Framework:** none exists yet. Set up **Vitest** (unit, matches Vite) + **Playwright** (the 2 E2E flows). Mock the LibreLinkUp client's `read()` in the `pollGlucose` unit tests.

## Failure modes (each must be handled, not silent)

| Codepath | Failure | Test? | Error handling | User sees |
|----------|---------|-------|----------------|-----------|
| pollGlucose | LibreLinkUp API down | yes | try/catch per cycle, keep last reading | stale-data UI, "updated Xm ago" |
| pollGlucose | stale `clientVersion` rejected by API | yes | catch + log; bump version & redeploy | stale UI until fixed |
| lib (internal) | JWT expired / wrong region | n/a | handled inside the client lib | nothing (transparent) |
| pollGlucose | her phone offline (no new data) | yes | readings just stop updating | **stale UI past 15min — CRITICAL it's not shown as current** |
| client | Firestore read fails | yes | error boundary | "can't load right now, retry" |
| quick-log | double-submit | yes | disable button on submit | single entry |

**Critical gap guard:** the stale-glucose path is the one that can mislead a T1D user. It MUST have both a test and a visible stale state. Flagged as the top test priority.

---

## NOT in scope (deferred, with reason)

- **Push notifications (FCM + iOS PWA permission/service worker)** — slowest, flakiest piece on iOS; cut from tonight per user decision. Appreciation renders in-app on open instead. Fast-follow after real-device test.
- **Best-effort low/high nudge** — depends on push; deferred with it.
- **AI food parsing, calories, insulin brands/types, bolus calc** — Appendix A; quick-log stays free-text + 2 optional numbers.
- **Multi-user / caregiver sharing** — single user (his wife) in v1.
- **History feed / weekly time-in-range** — not v1.
- **Per-user LibreLinkUp onboarding UI** — v1 wires one account (hers) by backend config; the self-serve credential flow is the Product-Hunt-path work, not tonight.

## What already exists

| Asset | Reuse |
|-------|-------|
| `T1D-bot/.../glucose/poller.ts` | Copy the poll-loop pattern (per-cycle try/catch, swallow errors keep last reading). Body changes to LibreLinkUp + Firestore. |
| `@diakem/libre-link-up-api-client` (npm) | Use for login/JWT/region/fetch AND the trend arrow. Do not hand-roll. |
| ~~`T1D-bot/.../glucose/trend.ts`~~ | **No longer needed** — the LibreLinkUp client returns the trend directly. Dropped from scope. |

---

## Implementation Tasks
Synthesized from this review. Checkbox as you ship. Ordered for a tonight deploy.

- [x] **T0 — DATA PREFLIGHT** — ALREADY VERIFIED: follower account works (used to run on Nightscout) and her readings are visible in the LibreLinkUp app. Data flows. ✓
- [x] **T1 — project** — DONE. Firebase project `wibble-b82d6` on Blaze; Functions/Firestore/Hosting initialized. (Vite React PWA scaffold still TODO with the frontend.)
  - **Tonight risk:** first-time Cloud Functions 2nd-gen setup (Blaze, Secret Manager, Cloud Scheduler, IAM) is the most likely time-sink tonight. **Escape hatch if it fights you past ~1 deploy attempt:** run the poller (T5) as a local `node` script with `setInterval` + Admin SDK tonight, migrate to the Cloud Function tomorrow. Same poll logic, only the host changes.
  - Verify: `firebase emulators:start` runs; app loads locally.
- [x] **T2 — auth — BUILT (2026-06-17).** Google sign-in (`signInWithPopup`), app gated in `App.tsx`, `users/{uid}` upserted on login (`src/useAuth.ts`). **Blocked on verify:** Google provider not yet enabled in Firebase Auth console (API path needs a hand-minted OAuth client). One-click console toggle, then sign-in works.
- [ ] ~~**T3** — Port trend.ts~~ **DROPPED** — LibreLinkUp client returns the trend arrow; no calc needed.
- [x] **T4 — functions deps + secrets** — DONE. `@diakem/libre-link-up-api-client` installed; `@babel/runtime` pinned to 7.26.10; `LLU_USERNAME`/`LLU_PASSWORD` in Secret Manager; function granted access. Local `read()` returned her real value.
- [x] **T5 — pollGlucose function** — DONE & DEPLOYED. Writes to top-level `readings` collection (id = `reading.date` ms, idempotent), `clientVersion: "4.16.0"`, errors swallowed per cycle. **Verified: real readings (186-201 mg/dL, Flat) in Firestore, mg/dL confirmed.** Runs every 5 min. File: `functions/src/index.ts`.
- [x] **T6 — frontend Today/glucose hero — BUILT (2026-06-17).** `src/components/Today.tsx` subscribes to the top-level `readings` collection (`onSnapshot`, newest-first). `GlucoseHero.tsx`: number + trend arrow + color band (red <70 / green 70-180 / amber >180), "updated Xm ago" (re-renders every 30s), **stale state past 15m** (`glucose.ts STALE_AFTER_MS`) with "data may be out of date" + "check your Libre app". Empty + error states present. `Sparkline.tsx`: 3h SVG sparkline with in-range guide band. **Verify on device after auth+deploy.**
- [x] **T7 — frontend quick-log — BUILT (2026-06-17).** `src/components/QuickLog.tsx` bottom sheet: free-text note + optional carbs + optional insulin → `users/{uid}/logs` via `addDoc`; Save disabled while empty/saving (double-submit guard). **Verify on device after auth+deploy.**
- [x] **T8 — frontend appreciation — BUILT (2026-06-17).** `src/appreciation.ts` 10-message bank, deterministic per local date (date-keyed, stable across reopens, new message next day), addressed by first name from the Google profile. `AppreciationCard.tsx` renders it at the top of Today. **Verify on device after auth+deploy.**
- [x] **T9 — security rules — DONE & DEPLOYED (2026-06-17).** `firestore.rules`: `readings` readable by any authed user (client never writes — poller uses Admin SDK), `users/{uid}/**` owner-only. Compiled clean, released to cloud.firestore. ✓
- [x] **T10 — deploy — LIVE (2026-06-17).** Google sign-in enabled; `npm run build && firebase deploy --only hosting` released. Live at **https://wibble-b82d6.web.app** (HTTP 200, app shell + manifest + bundle verified). **Remaining (on her phone, human):** open the URL on her iPhone → Share → Add to Home Screen; sign in with Google; she accepts the one-time LibreLinkUp follower invite. Then glucose renders live.
- [ ] **T11 (P2, ~30m)** — test — Vitest unit on `pollGlucose` (mock the lib's `read()`: happy / null / throws / dup-id) + 2 Playwright E2E: sign-in→Today, stale-glucose UI.
- [ ] **T12 (P3, follow-up)** — push — FCM web push + iOS PWA permission + service worker; appreciation + best-effort nudge as notifications. After real-device test.

## Worktree parallelization

| Step | Modules | Depends on |
|------|---------|-----------|
| T1 scaffold | root | — |
| T4/T5 poller | `functions/` | T1 |
| T6/T7/T8 UI | `src/` | T1, T2 |
| T9 rules | `firestore.rules` | T1 |

```
Lane A (functions/):  T4 → T5        (sequential, shared module)
Lane B (src/ UI):     T6 ∥ T7 ∥ T8   (after T2; mostly independent components)
Lane C (rules):       T9             (independent)
```
Launch Lane A and Lane B in parallel after T1+T2. T9 anytime. Converge for T10 deploy. The poller (Lane A) and UI (Lane B) only meet at the Firestore schema, which is fixed above — low conflict risk.
