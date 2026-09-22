# Wibble — v1 Product Requirements Document

**Version:** 2.0 (Minimal Mirror)
**Date:** 2026-06-16
**Status:** Approved — v1 scope
**Supersedes:** v1.0 (full five-pillar PRD, retained as the "someday" backlog in Appendix A)

---

## 1. What Wibble Is

Wibble is a mobile-first Progressive Web App (PWA) that acts as a humane daily companion for a person living with Type 1 Diabetes (T1D). It is built first for one real user — the builder's wife, who manages T1D with a Freestyle Libre 2 sensor — with the intent to release publicly on Product Hunt if it earns daily use.

Wibble is **not** a medical device and **not** a glucose alarm system. The user's existing Freestyle Libre app remains her primary, trusted alarm at all times. Wibble's job is to be the app she *wants* to open: it mirrors her glucose for a quick glance, makes logging effortless, and — the part nothing else does — acknowledges that T1D is hard and tells her she's doing well.

### North star (the user's own words)

> **"A tracker she wants to use, not need."**

This is the primary user's stated requirement, in her own words. She wants Wibble to feel **less like a chore and more like something she's doing that genuinely helps her**. Every feature decision is measured against it: does this make Wibble something she *wants* to open, or a chore she *has* to do? If it's the latter, it does not ship. (Notably, the appreciation feature — see §5.1.B — was **her idea**, not the builder's. The emotional core of v1 is validated by the actual user.)

The longer-term direction, also from her: she wants Wibble to eventually help her **get back in range** — turning daily engagement into real glucose regulation. That is explicitly a **future iteration (v2)**, not v1. v1 earns the daily habit; v2 turns the habit into an outcome.

### The v1 thesis

The builder lives with the real user. The fastest way to build the right product is to ship the smallest real thing, put it on her phone, and watch her use it for a week. Her behavior, not guesses, decides what gets built next. So v1 is deliberately minimal: one screen, one daily kindness, one quick log. Everything else (AI food logging, insulin types, multi-user, history, achievements) is deferred to Appendix A until her usage justifies it.

---

## 2. Users

- **Primary user (owner):** The builder's wife. Has T1D, uses a Freestyle Libre 2. Single user in v1 — no caregiver/multi-user features yet.
- **Builder/operator:** Sets up the glucose data pipe (see §4) on the backend. The only thing the primary user ever does to enable glucose is accept one LibreLinkUp follower invite during initial setup.

---

## 3. Platform

Progressive Web App (PWA), mobile-first, installable to the iOS and Android home screen. No native app in v1. All UI is designed for one-handed phone use. Desktop must not break but is not a design target.

---

## 4. Glucose Data Source (backend plumbing — invisible to the user)

Glucose comes from **LibreLinkUp**, Abbott's official follower-sharing service. **No Nightscout.**

Flow:
1. The user's main Libre app uploads readings to Abbott's cloud (sharing enabled).
2. She sends a one-time LibreLinkUp **follower invite** to an account the builder controls. She taps accept once. This is the only glucose-related action she ever takes.
3. Wibble's backend logs in with the follower account credentials and **polls the LibreLinkUp API** for recent readings on a server-side schedule.
4. Readings are stored in Wibble's database with timestamps and surfaced on the home screen.

**Engineering constraints:**
- Wrap ingestion in a thin `GlucoseSource` interface with a single method, `getRecentReadings()`. v1 ships a `LibreLinkUpSource` implementation. This keeps the data source swappable and keeps the productization path open (each future public user supplies their own LibreLinkUp follower credentials).
- Lean on a maintained open-source LibreLinkUp client rather than hand-rolling the protocol. The API is unofficial and can change; isolating it behind the interface contains the blast radius.
- Handle the LibreLinkUp **JWT token refresh** so polling doesn't silently die when the token expires.
- Handle **EU/US region redirection** based on the account's region.
- The Wibble UI never exposes any of this. No "connection" screen for the end user.

---

## 5. v1 Scope — The Minimal Mirror

### 5.1 Home screen ("Today") — the entire app

A single primary screen with three elements, top to bottom:

**A. Glucose hero**
- Current reading (large, high-contrast) + trend arrow (↑↑ / ↑ / → / ↓ / ↓↓ from the LibreLinkUp trend field).
- Color-coded number: red below 70 mg/dL, green 70–180, amber above 180.
- "Last updated X min ago."
- A small 3-hour sparkline underneath for context (no time-window switcher in v1).
- Empty state if glucose isn't flowing yet ("Glucose will show up here once setup is done").
- Units: **mg/dL**.

**B. Daily appreciation card**
- One warm, human, one-sentence message addressed to the user by first name.
- One scheduled message per day (default: morning).
- Drawn from a rotating bank of hand-written messages.
- Tone: warm, brief, never clinical, never patronizing. This is the soul of v1.
- **This feature was the primary user's own idea.** It is validated, not speculative — prioritize getting the tone right.

**C. One quick-log button**
- A single tap opens a fast log sheet.
- The sheet has: a free-text note field + an optional carbs number + an optional insulin units number. Saved with a timestamp.
- **No AI parsing, no separate food/insulin flows, no insulin brand/type selection in v1.** The point is to learn whether and how she logs before investing in either direction.
- Saved entries are stored; a minimal "recent entries" list may appear under the button (last few), but no full history/analytics screen.

### 5.2 Settings (minimal, end-user facing)
- **Appreciation:** on/off toggle + morning delivery time.
- **Best-effort glucose nudge:** on/off, with a permanent one-line disclaimer: *"Keep your Libre alarms on — these are extra."*
- **Account:** Google sign-in identity, sign out.

That's the whole settings surface. No glucose-source configuration (that's backend, §4).

### 5.3 Auth
- **Google SSO only.** No email/password.

### 5.4 Best-effort glucose nudge (explicitly NOT a safety alarm)
- Optional push notification when a new reading crosses a low or high threshold.
- Delivered via Web Push. Treated as a **bonus**, never as a safety device.
- The product must **never** suggest disabling the Libre app's alarms. Onboarding and the nudge setting both state that the Libre app stays primary.
- If real-device testing shows iOS Web Push is too unreliable to be even a useful bonus, dropping the nudge from v1 is acceptable — Wibble still works as glance + log + appreciation.

---

## 6. Onboarding (first run)

Kept to the minimum:
1. Sign in with Google.
2. "What's your name?" (used in appreciation messages).
3. A short note: glucose will appear automatically once setup is complete; keep using your Libre app and its alarms as normal.
4. Land on the Today screen.

The LibreLinkUp follower invite and backend wiring are handled by the builder out-of-band, not in this flow.

---

## 7. User Journey (a day with Wibble v1)

- **Morning:** She wakes, glances at her phone. A Wibble notification (or the Today screen) shows a one-line message: *"Morning, [name]. Another day, and you've got this."* Above it, her current glucose and trend, pulled live.
- **Throughout the day:** When she eats or doses, she taps the quick-log button, types a few words, optionally adds carbs or units, saves. Under 15 seconds.
- **A high or low:** Her Libre app alarms as it always does (primary). Wibble may also send a soft nudge if enabled (bonus).
- **The builder's job:** Watches, without helping, which of these she actually uses. That observation drives v2.

---

## 8. Non-Functional Requirements

| Requirement | Target |
|-------------|--------|
| Time to interactive (mobile, 4G) | < 2 seconds |
| Glucose freshness | Within a few minutes of LibreLinkUp's latest reading |
| PWA installability | Passes the core PWA install checklist on iOS + Android |
| Glucose source resilience | Token auto-refresh; graceful "stale data" state if polling fails |
| Safety framing | UI never positions Wibble as the primary alarm; Libre stays primary |
| Accessibility | Adequate contrast, large tap targets (min 44×44pt) |

---

## 9. Success Criteria

After one week on her phone:
1. She opens Wibble unprompted at least once a day.
2. She reacts positively to at least one appreciation message.
3. She logs at least a few entries without being asked.

Hit all three → expand toward the emotional layer or the logging layer, based on which she gravitated to. Miss them → that's cheap, valuable signal too.

---

## 10. Out of Scope for v1 (deferred, not cancelled)

AI food logging, calorie estimation, separate insulin type/brand tracking, bolus calculator, multi-user / caregiver sharing (co-account + read-only), history feed, weekly time-in-range analytics, achievement-based appreciation, rapid-rise/fall alerts, snooze logic, time-window graph switching, dark mode, CSV export, Apple Watch. All retained in Appendix A.

---

## 11. Open Questions

1. ~~Does the appreciation message land or grate?~~ **Resolved:** the appreciation feature was the user's own idea. Open sub-question is only the *tone/wording* of the message bank — get it right, iterate with her directly.
2. Will she log anything in a second app when the Libre app is right there?
3. iOS Web Push reliability for the nudge — real-device test required; drop it if it's not even a useful bonus.
4. Is the glucose hero pulling its weight, or is appreciation + logging the whole product?
5. LibreLinkUp API durability — mitigate with a maintained client behind `GlucoseSource`.
6. EU/US region + JWT refresh handling for her account.

---

## Appendix A — The "Someday" Backlog (former full PRD)

The original v1.0 PRD described a full five-pillar product: live glucose with switchable time windows, AI photo/description food logging with carbs + calories, short/long insulin logging with user-configured brands, a full push-notification alarm suite (low / urgent low / high / rapid rise / rapid fall, sound toggle, snooze), scheduled + achievement-based appreciation, multi-user (owner + co-account + read-only caregiver) with email invites, and a history tab with a weekly time-in-range summary.

That scope is **not cancelled** — it is the expansion menu. Each item returns when the Minimal Mirror earns it through observed daily use. Build the smallest real thing first; let the real user choose what comes next.
