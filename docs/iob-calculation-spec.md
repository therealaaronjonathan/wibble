# Insulin on Board (IOB) — Implementation Spec

**Audience:** the engineer implementing this feature in the T1D tracker app.
**Status:** design agreed; ready to implement.
**Scope:** one displayed number. Nothing in this document is a dosing recommendation, and the feature must never produce one.

---

## 1. What we are building

A single value, **"Insulin on board"**, shown in the app: an estimate of how many units of the user's rapid-acting insulin — from doses she has logged in the last few hours — are still active. It refreshes every minute.

**In scope**

- Current insulin-on-board number, one decimal, in units.
- A secondary line showing the most recent rapid-acting dose and how long ago it was taken.
- An expandable breakdown of the doses contributing to the number.
- Two user-editable settings: peak time and duration (section 4).
- Input guards that protect the number from bad inputs (section 8).
- Automated tests (section 10).

**Out of scope — do not build**

- An insulin-on-board curve on the glucose graph.
- Carbs on board.
- Insulin activity rate.
- Any suggested dose, correction amount, "you can take X units" text, or comparison of insulin on board against glucose that implies an action. This MUST NOT exist anywhere in the feature.

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **Insulin on board (IOB)** | Rapid-acting insulin injected recently that is still lowering glucose, expressed in units. The number this feature displays. |
| **Duration (duration of insulin action, DIA)** | Minutes after an injection at which its remaining effect is treated as zero. Default 300 min (5 h). |
| **Peak time** | Minutes after an injection at which the insulin is working hardest. Default 75 min. |
| **Bolus** | A rapid-acting dose taken for food or to correct a high glucose. Counts toward insulin on board. |
| **Basal** | Long-acting background insulin, injected once or twice a day. Never counts toward insulin on board. |
| **Rapid-acting insulin** | Humalog (lispro), NovoRapid/Novolog (aspart), Apidra (glulisine). The user takes one of these. |
| **MDI (multiple daily injections)** | Insulin via pens rather than a pump. Relevant because every dose is logged manually. |
| **CGM (continuous glucose monitor)** | Source of the app's glucose graph via Nightscout. **Not an input to this calculation.** |
| **ISF (insulin sensitivity factor)** | How far one unit drops glucose. A planned separate feature that will reuse code from this one (section 12). |

---

## 3. Facts the design relies on

- The user is on MDI with a rapid-acting insulin listed above → peak time 75 min.
- Every insulin dose is logged in the app by the user with: `units`, an injection time (defaults to now, editable, can be backdated), and a tag. Basal doses carry the tag `basal`.
- There is no pump, smart pen, or other app computing insulin on board for her. There is nothing to match; we choose the most realistic model.
- Typical bolus size is 6–10 units.
- The app already stores her configured basal dose and basal time (used by the guards in section 8).
- Glucose data is not used by this calculation in any way.

---

## 4. Model and parameters

Use the **exponential insulin-activity curve** used by the open-source automated insulin delivery projects Loop, OpenAPS (oref0), and AndroidAPS. Do **not** implement linear decay or the older bilinear ("Walsh") curve.

Why this curve: insulin does not act at a constant rate. Its effect ramps up, peaks around 75 minutes, then tails off. Linear decay overstates insulin on board at 2–3 hours (50 % / 25 % remaining vs. about 41 % / 16 % with this curve), and that error would flow straight into the planned sensitivity feature.

| Setting | Default | Allowed range | Meaning |
|---|---|---|---|
| `peakMinutes` | 75 | 45 – 90 | Time after injection when insulin action is strongest. 75 is correct for Humalog / NovoRapid / Apidra. |
| `durationMinutes` | 300 | 240 – 480 | Time after injection when the remaining fraction reaches exactly 0. |

Constraints:

- Both settings are user-editable and persisted.
- `durationMinutes` MUST be greater than `2 × peakMinutes` (the formula divides by `1 − 2·tp/td`). The allowed ranges guarantee this; assert it anyway.
- Do not lower the default duration. People are commonly told rapid-acting insulin "lasts 3–4 hours"; on this curve that is roughly where the tail becomes negligible (about 3 % remains at 4 h with the defaults). Loop ships 6 h. In the settings UI, label duration as *"when the effect reaches zero, not when it feels worn off"*.

---

## 5. Formula

### 5.1 Fraction of one dose still remaining

For a single dose, `t` minutes after injection:

```
Inputs
  tp = peakMinutes
  td = durationMinutes
  t  = minutes since injection (may be fractional)

Boundary
  if t < 0  → fraction = 0     (future-dated dose; see section 8)
  if t >= td → fraction = 0

Helper constants — depend only on tp and td, no meaning on their own
  tau = tp * (1 - tp / td) / (1 - 2 * tp / td)
  a   = 2 * tau / td
  S   = 1 / (1 - a + (1 + a) * exp(-td / tau))

Fraction remaining, 0 ≤ t < td
  fraction(t) = 1 - S * (1 - a) * ( (t² / (tau * td * (1 - a)) - t / tau - 1) * exp(-t / tau) + 1 )
```

Mathematical properties (all are test targets):

- `fraction(0) = 1` exactly.
- `fraction(td) = 0` exactly (S is defined to make this true).
- Strictly decreasing on `[0, td)`.
- Steepest descent at `t = tp` (the activity peak).

### 5.2 Insulin on board

```
IOB(now) = Σ  d.units × fraction( minutesBetween(d.injectedAt, now) )
           over every dose d where
             d.tag ≠ 'basal'
             and 0 ≤ minutesBetween(d.injectedAt, now) < durationMinutes
```

Doses older than `durationMinutes` contribute exactly 0 and need not be loaded.

---

## 6. Reference implementation

TypeScript. Port to the app's language if needed, but keep the function names and structure — the sensitivity feature will import `fractionRemaining` later.

```ts
export const DEFAULT_PEAK_MINUTES = 75;      // when the insulin works hardest
export const DEFAULT_DURATION_MINUTES = 300; // when its remaining effect reaches zero

export interface InsulinDose {
  units: number;       // > 0
  injectedAt: Date;    // stored as UTC; the time she injected, not the time the row was saved
  tag?: string;        // 'basal' excludes the dose from insulin on board
}

export interface IobSettings {
  peakMinutes: number;
  durationMinutes: number;
}

export function validateIobSettings(s: IobSettings): void {
  if (s.peakMinutes < 45 || s.peakMinutes > 90) throw new Error('peakMinutes must be 45–90');
  if (s.durationMinutes < 240 || s.durationMinutes > 480) throw new Error('durationMinutes must be 240–480');
  if (s.durationMinutes <= 2 * s.peakMinutes) throw new Error('durationMinutes must exceed 2 × peakMinutes');
}

/** Fraction (0–1) of a single dose still left to act, `minutesSinceDose` after injecting it. */
export function fractionRemaining(
  minutesSinceDose: number,
  peak: number = DEFAULT_PEAK_MINUTES,
  duration: number = DEFAULT_DURATION_MINUTES,
): number {
  if (minutesSinceDose < 0 || minutesSinceDose >= duration) return 0;
  const tau = peak * (1 - peak / duration) / (1 - 2 * peak / duration);
  const a = 2 * tau / duration;
  const S = 1 / (1 - a + (1 + a) * Math.exp(-duration / tau));
  const t = minutesSinceDose;
  return 1 - S * (1 - a) * ((t * t / (tau * duration * (1 - a)) - t / tau - 1) * Math.exp(-t / tau) + 1);
}

/** Total insulin on board, in units (unrounded). */
export function insulinOnBoard(
  doses: InsulinDose[],
  settings: IobSettings = { peakMinutes: DEFAULT_PEAK_MINUTES, durationMinutes: DEFAULT_DURATION_MINUTES },
  now: Date = new Date(),
): number {
  return doses
    .filter(d => d.tag !== 'basal')
    .reduce((total, d) => {
      const minutes = (now.getTime() - d.injectedAt.getTime()) / 60_000;
      return total + d.units * fractionRemaining(minutes, settings.peakMinutes, settings.durationMinutes);
    }, 0);
}

/** Per-dose breakdown for the expandable list in the UI. */
export function insulinOnBoardBreakdown(
  doses: InsulinDose[],
  settings: IobSettings,
  now: Date = new Date(),
): Array<InsulinDose & { minutesAgo: number; remainingUnits: number }> {
  return doses
    .filter(d => d.tag !== 'basal')
    .map(d => {
      const minutesAgo = (now.getTime() - d.injectedAt.getTime()) / 60_000;
      return { ...d, minutesAgo, remainingUnits: d.units * fractionRemaining(minutesAgo, settings.peakMinutes, settings.durationMinutes) };
    })
    .filter(d => d.remainingUnits > 0)
    .sort((x, y) => x.minutesAgo - y.minutesAgo);
}
```

---

## 7. Runtime behaviour

1. Load `peakMinutes` and `durationMinutes` from settings (validated; fall back to defaults if absent).
2. Load doses with `injectedAt > now − durationMinutes` and `tag ≠ 'basal'`.
3. Compute `insulinOnBoard(doses, settings, now)`.
4. Display rounded to one decimal. Keep the unrounded value internally.
5. Recompute:
   - every 60 seconds from a timer — the value is a pure function of `(doses, settings, now)`, so the tick needs no network call;
   - immediately after any dose is created, edited, or deleted;
   - immediately after a settings change.
6. Time handling: store `injectedAt` as UTC (ISO 8601 with offset, or epoch milliseconds). Compute with epoch milliseconds. Convert to local time only when rendering. Changing the device's time zone MUST NOT change the number.

---

## 8. Input guards

The number is only as good as the doses behind it. These guards are part of the feature, not optional polish.

| Guard | Rule |
|---|---|
| **Basal auto-tag** | When a new dose's `units` equals the configured basal dose (±0.5 u) and its time is within ±90 min of the configured basal time, pre-select the `basal` tag. The user can override. |
| **Large untagged dose** | If a dose is not tagged `basal` and `units > max(15, 1.5 × largest non-basal dose in the last 30 days)`, ask for confirmation before saving. A mistagged 20-unit basal shot would otherwise show as 20 units on board for five hours. |
| **Future timestamp** | Reject `injectedAt` more than 5 minutes in the future. If one exists anyway, it contributes 0. |
| **Settings** | Enforce the ranges in section 4 with inline helper text; never save an invalid value. |

---

## 9. UI

- **Primary:** label "Insulin on board", value formatted `X.X u` (one decimal). Show `0.0 u` when no dose is in range. Never render `-0.0` or unrounded floats.
- **Secondary line:** `Last dose 2.4 u · 1 h 50 min ago` — most recent non-basal dose. Hide if there is no non-basal dose in the last 24 h.
- **Tap to expand:** list from `insulinOnBoardBreakdown`, one row per contributing dose: injection time (local), units, `≈ 1.6 u remaining`. Purpose: lets the user audit the total against her memory and spot a missing or duplicated entry.
- **Label (always visible or one tap away):** *"Estimated from your logged doses using a standard insulin-action curve. Informational only — not a dosing recommendation."*
- **MUST NOT:** suggest a dose, show "correction needed", or place insulin on board next to glucose in a way that implies an action.

---

## 10. Test plan

### 10.1 `fractionRemaining` — known values, tolerance ±0.001

Peak 75, duration 300 (defaults):

| min | fraction | min | fraction |
|---|---|---|---|
| 0 | 1.000 | 150 | 0.268 |
| 30 | 0.925 | 180 | 0.159 |
| 60 | 0.764 | 210 | 0.082 |
| 75 | 0.673 | 240 | 0.033 |
| 90 | 0.581 | 270 | 0.007 |
| 120 | 0.411 | 300 | 0.000 |

Peak 75, duration 360 (verifies parameters are not hard-coded):

| min | fraction |
|---|---|
| 60 | 0.779 |
| 120 | 0.450 |
| 180 | 0.208 |
| 240 | 0.073 |
| 300 | 0.014 |
| 360 | 0.000 |

Edge cases and properties:

- `fractionRemaining(-1) === 0`, `fractionRemaining(300) === 0`, `fractionRemaining(10_000) === 0`.
- Strictly decreasing: for every 1-minute step in `[0, 300)`, `fraction(t+1) < fraction(t)`.
- Of all 10-minute windows `[10k, 10k+10]` in `[0, 300]`, the largest drop is in `[70, 80]` (proves the peak setting works).
- `validateIobSettings` rejects peak 40, peak 95, duration 200, duration 500, and `{peak: 90, duration: 240}` is accepted (240 > 180).

### 10.2 `insulinOnBoard` — scenarios (fixed `now`)

| Doses | Expected (rounded) |
|---|---|
| none | 0.0 |
| 5 u, 0 min ago | 5.0 |
| 4 u, 120 min ago | 1.6 |
| 6 u at 180 min ago + 2 u at 30 min ago | 2.8 |
| 20 u tagged `basal`, 60 min ago | 0.0 |
| 3 u, 360 min ago | 0.0 |
| 8 u with `injectedAt` 10 min in the future | 0.0 |
| 4 u at 120 min ago, settings duration 360 | 1.8 |

Invariants (property tests over random dose sets):

- Result is never negative.
- Result never exceeds the sum of non-basal units within the window.
- Between doses the result is non-increasing as `now` advances.
- Adding a dose of `u` units at exactly `now` increases the result by exactly `u`.

### 10.3 Independent oracle

The value table above came from the same person who wrote the formula. For an independent check, run the same scenarios through an existing implementation of these equations — OpenAPS/oref0's `lib/iob/calculate.js` (curve `rapid-acting`, DIA 5 h) or LoopKit's exponential insulin model — and confirm agreement within ±0.01 u. Alternatively re-implement the formula in a spreadsheet and compare; a different environment exposes operator-precedence mistakes.

### 10.4 Behaviour tests (inject `now`; never wait real time)

- Log a dose → number equals the units immediately.
- Advance mocked clock 1 min → number decreases. Advance 5 h → `0.0 u`.
- Log a dose backdated 2 h → correct fraction immediately.
- Edit a dose's units or time → number updates. Delete it → number updates.
- Toggle a dose's tag to `basal` → it disappears from the number and the breakdown.
- Change device time zone → number unchanged.
- Formatting: `0.0 u`, `2.3 u`, never `-0.0`, never `0.0000001`.
- Guards: basal auto-tag pre-selects correctly; large untagged dose prompts; future timestamp rejected.

### 10.5 Fit to the user (not automatable)

Whether the *defaults* fit her can only be observed over time, once the sensitivity feature exists: on clean correction doses (no food for ±3 h), compare when the CGM trend flattens with when insulin on board reads ≈ 0. Consistently earlier → duration too long; still falling well after ≈ 0 → too short. This tunes a setting; it is an observation for the user and her care team, not clinical validation.

---

## 11. Known limitations — accept, do not "fix"

| Limitation | Decision |
|---|---|
| The curve shape is identical for every dose. Real absorption varies with dose size (large doses run longer), injection site, exercise, heat, illness. | Accepted. Every commercial pump and automated system makes the same approximation; there is no validated way to scale the curve. **Do not** add dose-size scaling. |
| Defaults are population values, not measured for her. | Accepted. Tuning happens through the two settings, not code changes. Error across the plausible duration range (4–6 h) is about one unit worst case on a 10-unit dose. |
| No carbs on board, so the number cannot say where glucose is heading. | Accepted; out of scope. The number is still correct as insulin on board. |
| Will not match the insulin-on-board figure of a smart pen or pump if she gets one. | Accepted. If that happens, change the settings to that device's curve or retire this feature. |
| Only as good as her logging. | Mitigated by the guards and the breakdown UI (sections 8–9), not by the model. |
| The curve was developed inside closed-loop systems that re-check glucose every five minutes. A standalone number has no such safety net. | Mitigated by the label in section 9 and by having no dosing output anywhere. |

---

## 12. Future work — design for it now

- **Sensitivity (ISF) feature:** MUST import `fractionRemaining` for its insulin-on-board adjustment. There must be exactly one insulin curve in the codebase. Do not introduce a separate linear model.
- **Carbs on board:** same decay-and-sum pattern over logged carbohydrate entries.
- **Curve on the glucose graph:** `insulinOnBoard` evaluated at each historical timestamp. Cheap once the function exists; not requested yet.

---

## 13. Acceptance checklist

- [ ] Value tables in 10.1 pass within ±0.001 for both parameter sets.
- [ ] All scenarios in 10.2 pass; property tests pass.
- [ ] Independent oracle agrees within ±0.01 u.
- [ ] Basal-tagged doses never contribute.
- [ ] All four guards in section 8 work.
- [ ] Number refreshes every 60 s and immediately on dose or settings changes.
- [ ] Time-zone change does not alter the number.
- [ ] Label from section 9 is present; no dose suggestion exists anywhere in the feature.
- [ ] `fractionRemaining` is exported for reuse by the sensitivity feature.
