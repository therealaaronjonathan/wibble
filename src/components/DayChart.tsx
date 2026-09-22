import { useEffect, useRef, useState } from "react";
import {
  Timestamp,
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db, PATIENT_UID } from "../firebase";
import { type Reading } from "../glucose";
import { clockLabel, logParts, normalizeLog, type LogEntry } from "../logs";
import { formatTirPct, tirPercent } from "../tir";

// Full-day "look closer" surface. One calendar day at a time: her glucose curve
// over the whole day with log entries pinned on the time axis, so she can see
// what a meal/dose did to her sugar. Color zones (low / in-range / high) make
// highs readable at a glance; 3-hour dividers anchor the time of day. She steps
// days with the arrows or jumps to any past day via the date picker.
const DAY_MS = 24 * 60 * 60 * 1000;
const THREE_H = 3 * 60 * 60 * 1000;

// Glucose thresholds the zones + gridlines are drawn at (mg/dL).
const LOW = 70;
const HIGH = 180;
const VERY_HIGH = 250;

export default function DayChart({
  onOpenLog,
  onClose,
}: {
  // Open a log entry. Today routes this to the editable sheet (patient) or a
  // read-only detail sheet (view-only husband).
  onOpenLog: (e: LogEntry) => void;
  onClose: () => void;
}) {
  const [dayStart, setDayStart] = useState<number>(startOfToday());
  // Zoom: when set, the chart shows from this time to end of day (she taps a
  // 3-hour tick to focus the afternoon/evening). null = whole day.
  const [zoomStart, setZoomStart] = useState<number | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const dateRef = useRef<HTMLInputElement>(null);

  const dayEnd = dayStart + DAY_MS;
  const todayStart = startOfToday();
  const isToday = dayStart === todayStart;
  const dayTir = tirPercent(readings);

  // Visible window: [viewStart, dayEnd]. Zoom only crops the left edge.
  const viewStart = zoomStart ?? dayStart;
  const viewSpan = Math.max(1, dayEnd - viewStart);

  // Live-fetch the selected day's readings + logs. Range + orderBy on the same
  // field needs no composite index. Live so "today" updates and any edit shows.
  useEffect(() => {
    const rq = query(
      collection(db, "readings"),
      where("measuredAt", ">=", Timestamp.fromMillis(dayStart)),
      where("measuredAt", "<", Timestamp.fromMillis(dayEnd)),
      orderBy("measuredAt", "asc")
    );
    const unsubR = onSnapshot(
      rq,
      (snap) => setReadings(snap.docs.map((d) => d.data() as Reading)),
      (err) => console.error("[daychart] readings error", err)
    );
    const lq = query(
      collection(db, "users", PATIENT_UID, "logs"),
      where("loggedAt", ">=", Timestamp.fromMillis(dayStart)),
      where("loggedAt", "<", Timestamp.fromMillis(dayEnd)),
      orderBy("loggedAt", "asc")
    );
    const unsubL = onSnapshot(
      lq,
      (snap) =>
        setLogs(snap.docs.map((d) => normalizeLog(d.id, d.data()))),
      (err) => console.error("[daychart] logs error", err)
    );
    return () => {
      unsubR();
      unsubL();
    };
  }, [dayStart, dayEnd]);

  // ---- geometry ----
  const W = 1000;
  const H = 220;
  const PAD = 8;

  const values = readings.map((r) => r.valueMgdl);
  const dataMax = values.length ? Math.max(...values) : HIGH;
  const dataMin = values.length ? Math.min(...values) : LOW;
  // Always show through VERY_HIGH so the high zone is visible; extend if she
  // actually ran higher/lower that day.
  const yMax = Math.max(VERY_HIGH + 20, Math.ceil((dataMax + 15) / 10) * 10);
  const yMin = Math.min(50, Math.floor((dataMin - 10) / 10) * 10);
  const vspan = Math.max(1, yMax - yMin);

  // The SVG is a fixed H px tall with a viewBox height of H, so viewBox y-units
  // map 1:1 to CSS px — y() doubles as the px offset for overlaid Y labels.
  // (Keep H in sync with .daychart-svg height in index.css.)
  const y = (v: number) => PAD + (1 - (v - yMin) / vspan) * (H - 2 * PAD);
  const xAt = (ms: number) => clamp01((ms - viewStart) / viewSpan) * W;
  const leftPct = (ms: number) => clamp01((ms - viewStart) / viewSpan) * 100;

  // Readings/logs within the visible (zoomed) window.
  const inView = (ms: number) => ms >= viewStart && ms <= dayEnd;
  const visReadings = readings.filter((r) => inView(r.measuredAt.toMillis()));

  const dPath = visReadings
    .map(
      (r, i) =>
        `${i === 0 ? "M" : "L"} ${xAt(r.measuredAt.toMillis()).toFixed(1)} ${y(
          r.valueMgdl
        ).toFixed(1)}`
    )
    .join(" ");

  // Zones as full-width rects between thresholds.
  const zone = (top: number, bottom: number) => ({
    y: y(top),
    height: Math.max(0, y(bottom) - y(top)),
  });
  const zLow = zone(LOW, yMin); // red, below 70
  const zIn = zone(HIGH, LOW); // green, 70–180
  const zAmber = zone(VERY_HIGH, HIGH); // amber, 180–250
  const zHigh = zone(yMax, VERY_HIGH); // red, above 250

  // 3-hour dividers across the visible window (e.g. zoomed to 3p: 3p,6p,9p,12a).
  const ticks: number[] = [];
  for (let t = viewStart; t <= dayEnd + 1; t += THREE_H) ticks.push(t);

  // Y labels to draw, only those inside the visible range.
  const yLabels = [LOW, HIGH, VERY_HIGH].filter((v) => v >= yMin && v <= yMax);

  // All the day's logs (newest first) for the list; pins are the visible subset.
  const logsDesc = [...logs]
    .filter((e) => e.loggedAt != null)
    .sort((a, b) => b.loggedAt!.toMillis() - a.loggedAt!.toMillis());
  const pinLogs = logsDesc.filter((e) => inView(e.loggedAt!.toMillis()));

  function goToDay(ms: number) {
    setDayStart(Math.min(ms, todayStart));
    setZoomStart(null); // a new day always starts at full-day
  }
  function stepDay(deltaDays: number) {
    const d = new Date(dayStart);
    d.setDate(d.getDate() + deltaDays);
    d.setHours(0, 0, 0, 0);
    goToDay(d.getTime());
  }
  function pickDate(value: string) {
    if (!value) return;
    const [yy, mm, dd] = value.split("-").map(Number);
    goToDay(new Date(yy, mm - 1, dd, 0, 0, 0, 0).getTime());
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="daychart"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Your day"
      >
        <div className="daychart-head">
          <h2 className="sheet-title">Your day</h2>
          <button className="link" onClick={onClose}>
            Done
          </button>
        </div>

        {/* Day navigation: ‹ prev | tappable date | next › */}
        <div className="daychart-daynav">
          <button
            className="daynav-arrow"
            onClick={() => stepDay(-1)}
            aria-label="Previous day"
          >
            ‹
          </button>
          <button
            className="daynav-date"
            onClick={() => dateRef.current?.showPicker?.()}
          >
            {dayLabel(dayStart, isToday)}
          </button>
          <input
            ref={dateRef}
            type="date"
            className="daynav-dateinput"
            value={ymd(dayStart)}
            max={ymd(todayStart)}
            onChange={(e) => pickDate(e.target.value)}
          />
          <button
            className="daynav-arrow"
            onClick={() => stepDay(1)}
            disabled={isToday}
            aria-label="Next day"
          >
            ›
          </button>
        </div>
        {dayTir != null && (
          <p className="daychart-tir">{formatTirPct(dayTir)} in range</p>
        )}

        {zoomStart != null && (
          <div className="daychart-zoombar">
            <span className="subtle">From {hourLabel(zoomStart)}</span>
            <button className="daychart-reset" onClick={() => setZoomStart(null)}>
              Full day
            </button>
          </div>
        )}

        <div className="daychart-plot">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="daychart-svg"
            preserveAspectRatio="none"
          >
            {/* Color zones */}
            <rect x={0} y={zHigh.y} width={W} height={zHigh.height} className="zone-high" />
            <rect x={0} y={zAmber.y} width={W} height={zAmber.height} className="zone-amber" />
            <rect x={0} y={zIn.y} width={W} height={zIn.height} className="zone-in" />
            <rect x={0} y={zLow.y} width={W} height={zLow.height} className="zone-low" />

            {/* 3-hour vertical dividers */}
            {ticks.map((t, i) => (
              <line
                key={`v${i}`}
                x1={xAt(t)}
                y1={PAD}
                x2={xAt(t)}
                y2={H - PAD}
                className="daychart-vline"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {/* Threshold gridlines */}
            {yLabels.map((v) => (
              <line
                key={`h${v}`}
                x1={0}
                y1={y(v)}
                x2={W}
                y2={y(v)}
                className="grid-line"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {/* Log markers */}
            {pinLogs.map((e) => (
              <line
                key={e.id}
                x1={xAt(e.loggedAt!.toMillis())}
                y1={PAD}
                x2={xAt(e.loggedAt!.toMillis())}
                y2={H - PAD}
                className="daychart-markline"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {dPath && <path d={dPath} className="spark-line" fill="none" vectorEffect="non-scaling-stroke" />}
          </svg>

          {/* Y threshold labels, aligned to the lines */}
          {yLabels.map((v) => (
            <span
              key={`yl${v}`}
              className="grid-label"
              style={{ top: `${y(v)}px` }}
            >
              {v}
            </span>
          ))}

          {/* Tappable log pins on the time axis → open the log */}
          {pinLogs.map((e) => (
            <button
              key={e.id}
              type="button"
              className="daychart-pin"
              style={{ left: `${leftPct(e.loggedAt!.toMillis())}%` }}
              onClick={() => onOpenLog(e)}
              aria-label={`Open log at ${clockLabel(e.loggedAt!)}`}
            >
              <span className="daychart-pin-dot" />
            </button>
          ))}

          {/* 3-hour time axis — tap a time to zoom from there to end of day */}
          <div className="daychart-axis">
            {ticks.map((t, i) =>
              t < dayEnd ? (
                <button
                  key={`t${i}`}
                  type="button"
                  className="daychart-tick"
                  onClick={() => setZoomStart(t)}
                >
                  {hourLabel(t)}
                </button>
              ) : (
                <span key={`t${i}`} className="daychart-tick-end">
                  {hourLabel(t)}
                </span>
              )
            )}
          </div>
        </div>

        {readings.length === 0 && (
          <p className="muted daychart-nogluc">
            No glucose recorded for this day.
          </p>
        )}

        <div className="daychart-list">
          {logsDesc.length === 0 ? (
            <p className="muted">No logs on this day.</p>
          ) : (
            <>
              <div className="daychart-list-head subtle">
                {isToday ? "Today's logs" : "Logs"}
              </div>
              {logsDesc.map((e) => {
                const { macro, note } = logParts(e);
                const body = (
                  <>
                    <span className="daychart-row-time">
                      {clockLabel(e.loggedAt!)}
                    </span>
                    <span className="daychart-row-body">
                      {macro && <span className="daychart-row-macro">{macro}</span>}
                      {note && <span className="daychart-row-note">{note}</span>}
                    </span>
                  </>
                );
                return (
                  <button
                    key={e.id}
                    type="button"
                    className="daychart-row"
                    onClick={() => onOpenLog(e)}
                  >
                    {body}
                  </button>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// Local midnight (ms) of today.
function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// yyyy-mm-dd in local time, for the <input type="date"> value.
function ymd(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// "Today" / "Sat, Jun 20" for the day-nav label.
function dayLabel(ms: number, isToday: boolean): string {
  if (isToday) return "Today";
  return new Date(ms).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Compact axis label: "12a", "3a", "12p", "6p".
function hourLabel(ms: number): string {
  const h = new Date(ms).getHours();
  const ap = h < 12 ? "a" : "p";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${ap}`;
}
