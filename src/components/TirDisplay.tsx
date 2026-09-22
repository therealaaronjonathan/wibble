import { useEffect, useState } from "react";
import type { Reading } from "../glucose";
import {
  formatTirPct,
  homeTirWindow,
  readingsInWindow,
  tirCaptionLabel,
  tirPercent,
} from "../tir";

// Under IOB in the glucose card. Hidden 02:00–08:00 and when there are no
// readings in the window. Not colored by the current glucose band.
export default function TirDisplay({
  readings,
  now: nowProp,
}: {
  readings: Reading[];
  now?: Date;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (nowProp) return;
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [nowProp]);

  const now = nowProp ?? new Date();
  const win = homeTirWindow(now);
  if (!win) return null;
  const pct = tirPercent(readingsInWindow(readings, win.startMs, win.endMs));
  if (pct == null) return null;

  return (
    <div className="tir">
      <div className="iob-row">
        <span className="iob-label">Time in range</span>
        <span className="iob-value">{formatTirPct(pct)}</span>
      </div>
      <div className="tir-caption">{tirCaptionLabel(win.caption)}</div>
    </div>
  );
}
