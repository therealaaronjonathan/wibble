import { bandFor, type Reading } from "./glucose";

export type TirCaption = "today" | "since yesterday 12:00am";

export type HomeTirWindow = {
  startMs: number;
  endMs: number;
  caption: TirCaption;
};

/** Local midnight of the calendar day containing `d`. */
export function localDayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Visible 08:00–02:00; hidden 02:00–08:00. */
export function homeTirVisible(now: Date): boolean {
  const h = now.getHours();
  return h >= 8 || h < 2;
}

/**
 * Home TIR window. null when the card is hidden (02:00–08:00).
 * 08:00–midnight: today 00:00 → now.
 * midnight–02:00: yesterday 00:00 → now (~24–26h).
 */
export function homeTirWindow(now: Date): HomeTirWindow | null {
  if (!homeTirVisible(now)) return null;
  const todayStart = localDayStart(now);
  const h = now.getHours();
  if (h < 2) {
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    return {
      startMs: yesterdayStart.getTime(),
      endMs: now.getTime(),
      caption: "since yesterday 12:00am",
    };
  }
  return {
    startMs: todayStart.getTime(),
    endMs: now.getTime(),
    caption: "today",
  };
}

/** Whole-percent TIR. Empty → null (do not render 0%). 70 and 180 count as in range. */
export function tirPercent(
  readings: Pick<Reading, "valueMgdl">[]
): number | null {
  if (readings.length === 0) return null;
  let inRange = 0;
  for (const r of readings) {
    if (bandFor(r.valueMgdl) === "inRange") inRange += 1;
  }
  return Math.round((100 * inRange) / readings.length);
}

export function readingsInWindow(
  readings: Reading[],
  startMs: number,
  endMs: number
): Reading[] {
  return readings.filter((r) => {
    const t = r.measuredAt.toMillis();
    return t >= startMs && t <= endMs;
  });
}

export function formatTirPct(pct: number): string {
  return `${pct}%`;
}

export function tirCaptionLabel(caption: TirCaption): string {
  return caption === "today" ? "today" : "since yesterday 12:00am";
}
