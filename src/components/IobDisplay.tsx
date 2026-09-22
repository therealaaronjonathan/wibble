import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_DURATION_MINUTES,
  DEFAULT_IOB_SETTINGS,
  DEFAULT_PEAK_MINUTES,
  INSULIN_BRAND,
  formatIobUnits,
  formatLastDoseLine,
  insulinOnBoard,
  lastNonBasalDose,
} from "../iob";
import { logsToDoses, type LogEntry } from "../logs";

// Informational only. Never a dosing recommendation. Sits under the glucose
// number with smaller type so it cannot be read as a second reading.
export default function IobDisplay({ logs }: { logs: LogEntry[] }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const now = new Date();
  const doses = useMemo(() => logsToDoses(logs), [logs]);
  const iob = insulinOnBoard(doses, DEFAULT_IOB_SETTINGS, now);
  const last = lastNonBasalDose(doses, now);
  const hours = DEFAULT_DURATION_MINUTES / 60;

  return (
    <div className="iob">
      <div className="iob-row">
        <span className="iob-label">Insulin on board</span>
        <span className="iob-value">{formatIobUnits(iob)}</span>
      </div>
      {last && (
        <div className="iob-last">{formatLastDoseLine(last, now)}</div>
      )}
      <div className="iob-params">
        {INSULIN_BRAND} · {DEFAULT_PEAK_MINUTES} min peak · {hours} h duration
      </div>
      <p className="iob-disclaimer">
        Estimated from your logged doses using a standard insulin-action curve.
        Informational only — not a dosing recommendation.
      </p>
    </div>
  );
}
