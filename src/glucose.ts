import { Timestamp } from "firebase/firestore";

// One glucose reading, mirrored from LibreLinkUp by the pollGlucose function
// into the top-level `readings` collection (doc id = measurement epoch ms).
export type Reading = {
  valueMgdl: number;
  trend: string; // LibreLinkUp string union, e.g. "Flat", "SingleUp"
  isHigh: boolean;
  isLow: boolean;
  measuredAt: Timestamp;
  ingestedAt: Timestamp;
};

// A reading is "stale" once it's older than this. Safety-critical: past this
// window we must NOT present the number as her current glucose.
export const STALE_AFTER_MS = 15 * 60 * 1000;

// Glucose color bands (mg/dL), per the approved design:
//   red < 70 (low) | green 70-180 (in range) | amber > 180 (high)
export type Band = "low" | "inRange" | "high";

export function bandFor(valueMgdl: number): Band {
  if (valueMgdl < 70) return "low";
  if (valueMgdl > 180) return "high";
  return "inRange";
}

// Map the LibreLinkUp trend string to an arrow glyph.
const TREND_ARROWS: Record<string, string> = {
  SingleDown: "↓",
  FortyFiveDown: "↘",
  Flat: "→",
  FortyFiveUp: "↗",
  SingleUp: "↑",
  // Defensive aliases seen across LibreLinkUp client versions.
  DoubleDown: "⇊",
  DoubleUp: "⇈",
  NotComputable: "",
};

export function trendArrow(trend: string): string {
  return TREND_ARROWS[trend] ?? "";
}

export function isStale(measuredAt: Timestamp, now: number = Date.now()): boolean {
  return now - measuredAt.toMillis() > STALE_AFTER_MS;
}

// "updated 3m ago" / "updated just now"
export function agoLabel(measuredAt: Timestamp, now: number = Date.now()): string {
  const mins = Math.floor((now - measuredAt.toMillis()) / 60000);
  if (mins <= 0) return "updated just now";
  if (mins === 1) return "updated 1 min ago";
  if (mins < 60) return `updated ${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? "updated 1 hr ago" : `updated ${hrs} hrs ago`;
}
