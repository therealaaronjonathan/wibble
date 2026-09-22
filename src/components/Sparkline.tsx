import { bandFor, type Reading } from "../glucose";
import { clockLabelMs, type LogEntry } from "../logs";

// Compact 3-hour glucose sparkline on the home screen. readings are oldest →
// newest, X mapped by time so log markers sit under the curve. Now mirrors the
// "Your day" chart's read: green/amber/red zones, faint 70/180 guides, a few
// hour ticks. Tapping a log dot opens that log; tapping elsewhere opens the
// full-day chart (onOpen).
const LOW = 70;
const HIGH = 180;
const VERY_HIGH = 250;
const HOUR = 60 * 60 * 1000;

export default function Sparkline({
  readings,
  logs = [],
  onOpen,
  onOpenLog,
}: {
  readings: Reading[];
  logs?: LogEntry[];
  onOpen?: () => void;
  onOpenLog?: (e: LogEntry) => void;
}) {
  // viewBox H must equal .sparkline CSS height (px) so y-units == px for the
  // overlaid mg/dL labels.
  const W = 320;
  const H = 72;
  const PAD = 6;

  const values = readings.map((r) => r.valueMgdl);
  const min = Math.min(LOW, ...values) - 10;
  const max = Math.max(HIGH, ...values) + 10;
  const span = Math.max(1, max - min);

  const tMin = readings[0].measuredAt.toMillis();
  const tMax = readings[readings.length - 1].measuredAt.toMillis();
  const tSpan = Math.max(1, tMax - tMin);

  const xAt = (ms: number) => PAD + clamp01((ms - tMin) / tSpan) * (W - 2 * PAD);
  const leftPct = (ms: number) => (xAt(ms) / W) * 100;
  const y = (v: number) => PAD + (1 - (v - min) / span) * (H - 2 * PAD);

  const dPath = readings
    .map(
      (r, i) =>
        `${i === 0 ? "M" : "L"} ${xAt(r.measuredAt.toMillis()).toFixed(1)} ${y(
          r.valueMgdl
        ).toFixed(1)}`
    )
    .join(" ");

  const last = readings[readings.length - 1];
  const band = bandFor(last.valueMgdl);

  // Color zones, clipped to the visible value range.
  const zone = (top: number, bottom: number) => ({
    y: y(top),
    height: Math.max(0, y(bottom) - y(top)),
  });
  const zLow = zone(LOW, min);
  const zIn = zone(HIGH, LOW);
  const zAmber = zone(Math.min(VERY_HIGH, max), HIGH);
  const zHigh = max > VERY_HIGH ? zone(max, VERY_HIGH) : null;

  const yLabels = [LOW, HIGH].filter((v) => v >= min && v <= max);

  // On-the-hour vertical ticks within the window (a few light time markers).
  const ticks: number[] = [];
  for (let t = Math.ceil(tMin / HOUR) * HOUR; t <= tMax; t += HOUR) ticks.push(t);

  const marks = logs.filter((e) => {
    const ms = e.loggedAt?.toMillis();
    return ms != null && ms >= tMin && ms <= tMax;
  });

  return (
    <div
      className={`sparkline-wrap${onOpen ? " as-button" : ""}`}
      onClick={onOpen}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label="See your day: glucose and logs"
    >
      <div className="spark-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="sparkline"
          preserveAspectRatio="none"
        >
          {zHigh && (
            <rect x={0} y={zHigh.y} width={W} height={zHigh.height} className="zone-high" />
          )}
          <rect x={0} y={zAmber.y} width={W} height={zAmber.height} className="zone-amber" />
          <rect x={0} y={zIn.y} width={W} height={zIn.height} className="zone-in" />
          <rect x={0} y={zLow.y} width={W} height={zLow.height} className="zone-low" />

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

          <path d={dPath} className="spark-line" fill="none" vectorEffect="non-scaling-stroke" />

          {marks.map((e) => {
            const mx = xAt(e.loggedAt!.toMillis());
            return (
              <g key={e.id} className="spark-mark">
                <line x1={mx} y1={H - PAD} x2={mx} y2={PAD} className="spark-mark-line" vectorEffect="non-scaling-stroke" />
                <circle cx={mx} cy={H - PAD} r={3} className="spark-mark-dot" />
              </g>
            );
          })}

          <circle
            cx={xAt(last.measuredAt.toMillis())}
            cy={y(last.valueMgdl)}
            r={3.5}
            className={`spark-dot band-${band}`}
          />
        </svg>

        {/* mg/dL guides */}
        {yLabels.map((v) => (
          <span key={`yl${v}`} className="grid-label sm" style={{ top: `${y(v)}px` }}>
            {v}
          </span>
        ))}

        {/* Per-dot tap targets: open that log without triggering the day view */}
        {onOpenLog &&
          marks.map((e) => (
            <button
              key={e.id}
              type="button"
              className="spark-hit"
              style={{ left: `${leftPct(e.loggedAt!.toMillis())}%` }}
              onClick={(ev) => {
                ev.stopPropagation();
                onOpenLog(e);
              }}
              aria-label={`Open log at ${clockLabelMs(e.loggedAt!.toMillis())}`}
            />
          ))}

        {/* Hour ticks */}
        <div className="spark-ticks">
          {ticks.map((t, i) => (
            <span key={i} className="spark-tick" style={{ left: `${leftPct(t)}%` }}>
              {hourLabel(t)}
            </span>
          ))}
        </div>
      </div>

      <div className="spark-caption subtle">
        last 3 hours
        {logs.length > 0 ? " · tap a dot, or tap to open your day" : ""}
      </div>
    </div>
  );
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// "3p", "12a" — compact on-the-hour label.
function hourLabel(ms: number): string {
  const h = new Date(ms).getHours();
  const ap = h < 12 ? "a" : "p";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${ap}`;
}
