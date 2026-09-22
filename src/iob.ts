// Insulin-on-board math. Ported from the exponential activity curve used by
// Loop / OpenAPS / AndroidAPS. Display-only in v1 — never a dosing recommendation.
//
// Future ISF work MUST import fractionRemaining from here. Do not add a second curve.

export const DEFAULT_PEAK_MINUTES = 75; // Humalog: when the insulin works hardest
export const DEFAULT_DURATION_MINUTES = 300; // when remaining effect reaches zero
export const INSULIN_BRAND = "Humalog";

export interface InsulinDose {
  units: number; // > 0
  injectedAt: Date; // UTC instant she injected (loggedAt)
  tag?: string; // 'basal' excludes the dose from insulin on board
}

export interface IobSettings {
  peakMinutes: number;
  durationMinutes: number;
}

export const DEFAULT_IOB_SETTINGS: IobSettings = {
  peakMinutes: DEFAULT_PEAK_MINUTES,
  durationMinutes: DEFAULT_DURATION_MINUTES,
};

export function validateIobSettings(s: IobSettings): void {
  if (s.peakMinutes < 45 || s.peakMinutes > 90) {
    throw new Error("peakMinutes must be 45–90");
  }
  if (s.durationMinutes < 240 || s.durationMinutes > 480) {
    throw new Error("durationMinutes must be 240–480");
  }
  if (s.durationMinutes <= 2 * s.peakMinutes) {
    throw new Error("durationMinutes must exceed 2 × peakMinutes");
  }
}

/** Fraction (0–1) of a single dose still left to act, `minutesSinceDose` after injecting it. */
export function fractionRemaining(
  minutesSinceDose: number,
  peak: number = DEFAULT_PEAK_MINUTES,
  duration: number = DEFAULT_DURATION_MINUTES
): number {
  if (minutesSinceDose < 0 || minutesSinceDose >= duration) return 0;
  const tau = (peak * (1 - peak / duration)) / (1 - (2 * peak) / duration);
  const a = (2 * tau) / duration;
  const S = 1 / (1 - a + (1 + a) * Math.exp(-duration / tau));
  const t = minutesSinceDose;
  return (
    1 -
    S *
      (1 - a) *
      ((t * t / (tau * duration * (1 - a)) - t / tau - 1) * Math.exp(-t / tau) +
        1)
  );
}

/** Total insulin on board, in units (unrounded). */
export function insulinOnBoard(
  doses: InsulinDose[],
  settings: IobSettings = DEFAULT_IOB_SETTINGS,
  now: Date = new Date()
): number {
  return doses
    .filter((d) => d.tag !== "basal")
    .reduce((total, d) => {
      const minutes = (now.getTime() - d.injectedAt.getTime()) / 60_000;
      return (
        total +
        d.units *
          fractionRemaining(minutes, settings.peakMinutes, settings.durationMinutes)
      );
    }, 0);
}

/** Per-dose breakdown. Exported for the planned sensitivity feature; not rendered in v1. */
export function insulinOnBoardBreakdown(
  doses: InsulinDose[],
  settings: IobSettings,
  now: Date = new Date()
): Array<InsulinDose & { minutesAgo: number; remainingUnits: number }> {
  return doses
    .filter((d) => d.tag !== "basal")
    .map((d) => {
      const minutesAgo = (now.getTime() - d.injectedAt.getTime()) / 60_000;
      return {
        ...d,
        minutesAgo,
        remainingUnits: d.units * fractionRemaining(
          minutesAgo,
          settings.peakMinutes,
          settings.durationMinutes
        ),
      };
    })
    .filter((d) => d.remainingUnits > 0)
    .sort((x, y) => x.minutesAgo - y.minutesAgo);
}

/** One-decimal units label. Never "-0.0". */
export function formatIobUnits(n: number): string {
  if (!Number.isFinite(n) || Math.abs(n) < 0.05) return "0.0 u";
  const s = n.toFixed(1);
  return s === "-0.0" ? "0.0 u" : `${s} u`;
}

export function minutesBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 60_000;
}

/** Most recent non-basal dose in the last 24 hours, or null. */
export function lastNonBasalDose(
  doses: InsulinDose[],
  now: Date,
  withinMinutes = 24 * 60
): InsulinDose | null {
  let best: InsulinDose | null = null;
  for (const d of doses) {
    if (d.tag === "basal" || d.units <= 0) continue;
    const mins = minutesBetween(d.injectedAt, now);
    if (mins < 0 || mins >= withinMinutes) continue;
    if (!best || d.injectedAt.getTime() > best.injectedAt.getTime()) best = d;
  }
  return best;
}

/** "just now" / "50 min ago" / "1 h 50 min ago" */
export function formatDurationAgo(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 1) return "just now";
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem} min ago`;
  if (rem === 0) return h === 1 ? "1 h ago" : `${h} h ago`;
  return `${h} h ${rem} min ago`;
}

function formatLoggedUnits(units: number): string {
  const rounded = Math.round(units * 10) / 10;
  if (Number.isInteger(rounded)) return `${rounded} u`;
  return `${rounded.toFixed(1)} u`;
}

export function formatLastDoseLine(dose: InsulinDose, now: Date): string {
  const mins = minutesBetween(dose.injectedAt, now);
  return `Last dose ${formatLoggedUnits(dose.units)} · ${formatDurationAgo(mins)}`;
}
