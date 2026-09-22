import { Timestamp } from "firebase/firestore";

import type { InsulinDose } from "./iob";

// A quick-log entry written by QuickLog into users/{uid}/logs.
// carbs / insulinUnits are optional (null when she didn't enter them).
// loggedAt is a client timestamp of when the moment happened (injection time
// for insulin). tag is 'basal' for long-acting; missing/null = bolus.
export type LogEntry = {
  id: string;
  note: string;
  carbs: number | null;
  insulinUnits: number | null;
  loggedAt: Timestamp | null;
  tag: "basal" | null;
};

// Split an entry into its labelled parts so a row can show carbs/insulin
// clearly (not a cryptic "60g · 6u") and the note as its own line.
//   macro: "50g carbs · 6u insulin"  (empty if neither was entered)
//   note:  the free-text note         (empty if none)
export function logParts(e: LogEntry): { macro: string; note: string } {
  const parts: string[] = [];
  if (e.carbs != null) parts.push(`${e.carbs}g carbs`);
  if (e.insulinUnits != null) {
    parts.push(
      e.tag === "basal"
        ? `${e.insulinUnits}u basal`
        : `${e.insulinUnits}u insulin`
    );
  }
  return { macro: parts.join(" · "), note: e.note };
}

/** Map a log row to an IOB dose, or null if it has no usable insulin. */
export function logToDose(e: LogEntry): InsulinDose | null {
  if (e.insulinUnits == null || e.insulinUnits <= 0 || e.loggedAt == null) {
    return null;
  }
  return {
    units: e.insulinUnits,
    injectedAt: e.loggedAt.toDate(),
    tag: e.tag ?? undefined,
  };
}

export function logsToDoses(logs: LogEntry[]): InsulinDose[] {
  const doses: InsulinDose[] = [];
  for (const e of logs) {
    const d = logToDose(e);
    if (d) doses.push(d);
  }
  return doses;
}

/** Old docs have no tag field. Treat anything other than 'basal' as bolus. */
export function normalizeLog(
  id: string,
  data: Omit<LogEntry, "id"> | Record<string, unknown>
): LogEntry {
  const row = data as Omit<LogEntry, "id">;
  return {
    id,
    note: typeof row.note === "string" ? row.note : "",
    carbs: row.carbs ?? null,
    insulinUnits: row.insulinUnits ?? null,
    loggedAt: row.loggedAt ?? null,
    tag: row.tag === "basal" ? "basal" : null,
  };
}

// "1:05pm" for axis-free marker captions.
export function clockLabel(t: Timestamp): string {
  return formatClock(t.toDate());
}

export function clockLabelMs(ms: number): string {
  return formatClock(new Date(ms));
}

// Like clockLabel but prefixes the date when the entry isn't from today, so a
// recent-logs list can span days without ambiguity ("Jun 16, 2:05pm").
export function dayTimeLabel(t: Timestamp): string {
  const d = t.toDate();
  const now = new Date();
  const time = formatClock(d);
  if (d.toDateString() === now.toDateString()) return time;
  const date = d.toLocaleDateString([], { month: "short", day: "numeric" });
  return `${date}, ${time}`;
}

function formatClock(d: Date): string {
  return d
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    .toLowerCase()
    .replace(" ", "");
}
