# Changelog

What actually shipped to production after the June 2026 v1 “Minimal Mirror.”
Written so whoever picks this up next can do so without re-deriving product decisions.

**Live app:** https://wibble-b82d6.web.app
**Firebase project:** `wibble-b82d6`
**There is no git history in this folder.** Dates below are deploy dates, not commits.

Original product spec: `PRD.md` (v1, 2026-06-16). It does **not** describe IOB, TIR, basal tags, or yesterday logging. Prefer this file + the code for current behavior.

Household: one patient (Libre 2, MDI, Humalog). Owner uid can write logs; any signed-in account can read. Both phones in India; day boundaries use the **device local clock**.

Wibble is not a medical device and must never suggest a dose.

---

## Unreleased — repo hygiene (2026-09-23)

Not yet deployed. Prepared for publishing the repository.

### Changed

**Patient identity moved out of source.** `PATIENT_UID` / `PATIENT_NAME` now come from `VITE_PATIENT_UID` / `VITE_PATIENT_NAME` in `.env.local` (template: `.env.example`). The build fails loudly if they are missing.

**Firestore rules: household allowlist.** Previously any signed-in Google account could read the shared record, because sign-in is open to the world. Reads now require a `household/{uid}` document (`role: "patient" | "viewer"`), and the patient is identified by that role instead of a hardcoded uid. Deploy steps in `README.md` → *Deploying*. Create both household docs **before** deploying the rules or the app locks itself out.

## 2026-09-08 — Time in range + yesterday logging

**Hosting deploy only** (`firebase deploy --only hosting`). Poller unchanged.

### Added

**Time in range (TIR)** — percent of Libre readings with `70 ≤ mg/dL ≤ 180` (same band as `bandFor` in `src/glucose.ts`). Gaps are ignored: `inRangeCount / readingCount`. No readings → hide, do not show `0%`. Whole percent (`72%`).

Home card (under IOB, both accounts):

| Local clock | Visible? | Window | Caption |
|---|---|---|---|
| 08:00–23:59 | yes | today 00:00 → now | `today` |
| 00:00–01:59 | yes | **yesterday** 00:00 → now (~25–26h) | `since yesterday 12:00am` |
| 02:00–07:59 | no | — | — |

At 08:00 the card returns as the **new** today, already counting 00:00–08:00. It does **not** reset at midnight (that was the empty-day problem).

**Your day** chart is a **calendar day**: 00:00–24:00 of the selected date (or 00:00→now if that date is still today). At 1AM, home TIR (25h) will **not** match chart “Today” (1h) or “Yesterday” (24h). Intentional.

**Yesterday logging** — new Add-entry sheet: Today / Yesterday chips next to When. Yesterday + `11:30` stores last night so a forgotten 11:30 bolus still feeds IOB after midnight. Edit sheet has no chips (clock only, same calendar day). No dates older than yesterday. Future times still rejected.

### Files

- `src/tir.ts`, `src/tir.test.ts`
- `src/components/TirDisplay.tsx`
- `src/components/Today.tsx` — extra `readings` query (`measuredAt >= windowStart`, limit 2000). Do **not** reuse the 200-point sparkline query for TIR.
- `src/components/DayChart.tsx` — `N% in range` under the date
- `src/components/QuickLog.tsx` — Today / Yesterday chips on create
- `src/index.css`

### Tests

`npm test` — `src/tir.test.ts` (window edges, 70/180 inclusive, empty → null) plus existing IOB tests.

### Not in this round

Hours-in-range, in-range streak, weekly TIR, editable range, hardcoded `Asia/Kolkata`, logging older than yesterday.

---

## 2026-09-06 — Save-tap fix, 1-min glucose, IOB, basal tag, icon

**Hosting + functions deploy.**

### Fixed

**Save first tap eaten on iOS PWA.** Native time picker / keyboard consumed the first tap; `click` never fired. Symptom: Save looked tappable, needed a second tap / weird angle; the write never ran.

Fix: fire Save / Cancel / Delete on `pointerdown` (blur focused field first), ignore the leftover `click`, `inFlight` ref so pointerdown+click cannot double-write, sticky sheet actions, `touch-action: manipulation`. Finite-number guard on carbs/insulin (NaN used to fail Firestore with a vague error).

### Changed

**Libre poll: every 5 minutes → every 1 minute.** Cloud Scheduler cannot do 30s; Libre 2 only produces a new value ~once a minute. Job: `firebase-schedule-pollGlucose-us-central1`, schedule `every 1 minutes (UTC)`, ENABLED. Frontend still live-updates via `onSnapshot`. Stale window still 15 minutes.

### Added

**Insulin on board (IOB)** — display-only. Exponential curve from Loop/OpenAPS (not linear). Defaults: Humalog, peak 75 min, duration 300 min. Settings are **visible, not editable**.

- One decimal, `X.X u`, never `-0.0`. `0.0 u` when nothing in range.
- Last non-basal dose in 24h: `Last dose 6 u · 1 h 50 min ago`.
- Disclaimer: informational only, not a dosing recommendation.
- Under the glucose number in the hero. Shown on the viewer account too.
- Recompute every 60s and when logs change. Glucose is **not** an input.
- `loggedAt` **is** injection time. Do not add a second timestamp.

Math spec (full, including UI we did **not** build): `docs/iob-calculation-spec.md`. Implementation: `src/iob.ts`. Keep a **single** `fractionRemaining` in the repo for a future ISF feature.

**Basal tag** — optional `tag: 'basal' | null` on `users/{uid}/logs`. Missing tag = bolus. Chip **Basal (long-acting)** when Insulin (u) is filled. Manual only (basal units unknown; night time is a 12:30–2:00 AM window, too wide to auto-tag). Basal doses are excluded from IOB. `logParts` shows `18u basal` vs `6u insulin`.

**Home-screen / tab icon** — dog PNG from `docs/Wibble-Icon-1024.png` → `public/pwa-192x192.png`, `pwa-512x512.png`, `apple-touch-icon.png` (180), `favicon.png`. In-app wordmark stays the text “wibble”. iOS springboard icon only updates after **delete icon + Add to Home Screen** from Safari; in-app ↻ Refresh does not replace it.

### Files

- `src/components/QuickLog.tsx`, `src/index.css`
- `src/logs.ts` — `tag` on `LogEntry`; `logToDose` / `logsToDoses` / `normalizeLog`
- `src/iob.ts`, `src/iob.test.ts`
- `src/components/IobDisplay.tsx`, `GlucoseHero.tsx` (children slot), `Today.tsx`, `DayChart.tsx`
- `functions/src/index.ts` — `schedule: "every 1 minutes"`
- `public/*` icons, `index.html`, `vite.config.ts`
- `package.json` — `vitest`, `"test": "vitest run"`
- `vitest.config.ts`

### Tests

`npm test` — `src/iob.test.ts` (spec tables ±0.001, basal excluded, formatting).

### Not in this round

True 30s Libre polling. IOB curve on the graph, carbs on board, suggested dose, expandable dose breakdown, editable peak/duration, basal auto-tag, large-dose confirm, replacing the in-app wordmark, theme-color shift.

---

## How to deploy

```bash
# UI only (TIR / logging / IOB frontend)
npx -y firebase-tools@latest deploy --only hosting --project wibble-b82d6 --non-interactive

# Poller schedule / function code
npx -y firebase-tools@latest deploy --only functions --project wibble-b82d6 --non-interactive
```

After hosting: user taps **↻ Refresh** twice in the PWA (unregisters the service worker).

---

## Current data model (logs)

```
users/{uid}/logs/{logId}
  note: string
  carbs: number | null
  insulinUnits: number | null
  loggedAt: timestamp    // when the moment happened (injection time)
  tag: 'basal' | null    // added 2026-09-06; omit on old docs = bolus
```

Glucose: top-level `readings/{epochMs}` written by `pollGlucose`.
