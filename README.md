# Wibble

A gentle daily companion for one person living with Type 1 diabetes.

Wibble is a mobile-first, installable PWA that mirrors a Freestyle Libre 2 glucose feed, makes logging a meal or a dose a two-tap affair, and opens every day with a short note of appreciation, because managing T1D is relentless and almost nothing acknowledges that. It was built for a real household, has been in daily use since June 2026, and grew from that use: insulin on board, time in range, basal tagging and a full-day chart all came from watching what was actually needed.

**Wibble is not a medical device.** It never suggests a dose, and the Libre app remains the primary, trusted alarm. Readings older than 15 minutes are shown as stale rather than current.

> "A tracker she wants to use, not need." — the user's own brief

---

## What it does

| Surface | Behaviour |
|---|---|
| **Glucose hero** | Current mg/dL, trend arrow, colour band (low / in range / high), "updated N min ago". Stale after 15 min. |
| **Insulin on board** | Display-only IOB using the Loop / OpenAPS exponential activity curve (peak 75 min, duration 300 min). Basal doses excluded. |
| **Time in range** | Percent of readings in 70–180 mg/dL for today, with a window that rolls sensibly through the night. |
| **Sparkline** | Last three hours with log markers. Tap to open the day chart. |
| **Your day** | Full calendar-day chart with colour zones, 3-hour ticks, log entries pinned on the time axis, zoom, and a date picker. |
| **Quick log** | Bottom sheet: note, carbs, insulin, optional basal tag, time (today or yesterday). Edit and delete. |
| **Daily message** | One warm sentence per day, chosen deterministically from the date so it stays the same all day. |
| **Household sharing** | The patient writes; an allow-listed viewer sees the same screen read-only. |

## Architecture

```
  Phone (installed PWA)                 Firebase
  ┌────────────────────────┐            ┌───────────────────────────────┐
  │ React + Vite + TS      │ onSnapshot │ Firestore                     │
  │ Google sign-in         │◄──────────►│  readings/{epochMs}           │
  │ Today / QuickLog /     │  add/update│  users/{uid}/logs/{logId}     │
  │ DayChart               │───────────►│  household/{uid}  (allowlist) │
  └────────────────────────┘            └──────────────▲────────────────┘
                                                       │ Admin SDK (batch upsert)
                                        ┌──────────────┴────────────────┐
  Abbott LibreLinkUp  ◄── poll / 1 min ─│ Cloud Function: pollGlucose   │
  (follower account)                    │ creds from Secret Manager     │
                                        └───────────────────────────────┘
```

- **Frontend** `src/`. React 18, Vite 6, TypeScript strict, `vite-plugin-pwa` for the service worker and manifest. No UI framework; plain CSS in `src/index.css`. Pure logic lives in small modules (`iob.ts`, `tir.ts`, `glucose.ts`, `logs.ts`, `appreciation.ts`) and is what the tests cover.
- **Ingestion** `functions/src/index.ts`. A scheduled 2nd-gen Cloud Function logs into LibreLinkUp with a follower account, pulls the current reading plus recent history, and upserts them into `readings` keyed by measurement time, so re-polling is idempotent. Credentials live in Google Secret Manager.
- **Access control** `firestore.rules`. Google sign-in is open, so signed-in is not enough. Membership is a `household/{uid}` allowlist with a `patient` or `viewer` role. Only the patient can write logs. Clients can never write readings.
- **Identity** The patient's uid and first name come from `.env.local`, not source.

## Running locally

Prerequisites: Node 20+, a Firebase project with Google sign-in enabled, and a LibreLinkUp follower account for the poller (only needed to deploy the function).

```bash
npm install
cp .env.example .env.local      # fill in VITE_PATIENT_UID and VITE_PATIENT_NAME
npm run dev                      # http://localhost:5173
```

The web app talks to the live Firebase project defined in `src/firebase.ts` (that config is public by design; security is enforced by the rules). To point at your own project, replace that config and `.firebaserc`.

## Tests and checks

```bash
npm run lint    # tsc --noEmit
npm test        # vitest: IOB curve against the spec tables, TIR windows and edges
```

Coverage is deliberately focused on the safety-relevant math. The poller and UI components are not unit-tested; see *Known gaps*.

## Deploying

```bash
npm run build && npx firebase deploy --only hosting        # UI
npx firebase deploy --only functions                        # poller
npx firebase deploy --only firestore:rules                  # access rules
```

**Before the first rules deploy**, create the allowlist in Firestore or the app will lock itself out:

```
household/<patient uid>   { role: "patient" }
household/<viewer uid>    { role: "viewer" }
```

Set the poller's secrets once with `firebase functions:secrets:set LLU_USERNAME` and `LLU_PASSWORD`. After a hosting deploy, installed PWAs pick up the new bundle via the in-app ↻ Refresh (tap twice), which unregisters the service worker.

## Repository guide

| Path | What |
|---|---|
| `PRD.md` | v1 product spec (June 2026). Deliberately minimal; later features are documented in the changelog, not here. |
| `CHANGELOG.md` | What actually shipped, when, and why. The best place to understand current behaviour. |
| `BUILD_PLAN.md` | The original one-night build plan and task list. Historical. |
| `docs/iob-calculation-spec.md` | Full IOB math spec, including UI that was intentionally not built. |
| `src/` | App. `components/` for UI, top-level modules for logic. |
| `functions/` | Cloud Function poller. |
| `firestore.rules` | Access model, commented. |

## Decisions worth knowing

- **Redirect sign-in, never popup.** Installed PWAs cannot open a real popup. Auth is same-origin (`web.app`) so the redirect round-trip completes reliably.
- **Service worker denylist for `/__/`.** Without it the SPA fallback swallows Firebase's auth handler and sign-in hangs.
- **Save fires on `pointerdown`.** iOS spends the first tap dismissing the keyboard, so `click` never arrived. An in-flight ref prevents double writes.
- **`loggedAt` is injection time.** There is no second timestamp. IOB is computed from it.
- **Polling every minute, not 30 s.** Cloud Scheduler's floor is one minute and Libre 2 produces roughly one value a minute anyway.
- **Day boundaries use the device clock.** Both household phones are in the same time zone; a fixed zone was considered and deferred.

## Known gaps

- No automated tests for the Cloud Function or the React components.
- The PRD describes a `GlucoseSource` interface; the function calls the LibreLinkUp client directly. The seam is one file if a second source ever appears.
- Multi-household, invites, push notifications and any dosing guidance are explicitly out of scope (PRD Appendix A).
- The repository was published from a working folder in September 2026, so the git history starts there. The changelog carries the dated history before that.
