import { useEffect, useState, type ReactNode } from "react";
import {
  agoLabel,
  bandFor,
  isStale,
  trendArrow,
  type Reading,
} from "../glucose";

type Props = {
  current: Reading | null;
  loading: boolean;
  error: boolean;
  children?: ReactNode;
};

export default function GlucoseHero({
  current,
  loading,
  error,
  children,
}: Props) {
  // Re-render once a minute so "updated Xm ago" and the stale flip stay honest.
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  if (loading) {
    return (
      <section className="hero hero-muted">
        <div className="muted">Reading your glucose…</div>
        {children}
      </section>
    );
  }

  if (error) {
    return (
      <section className="hero hero-muted">
        <div className="muted">Can't load right now.</div>
        <div className="subtle">We'll keep trying.</div>
        {children}
      </section>
    );
  }

  if (!current) {
    return (
      <section className="hero hero-muted">
        <div className="muted">No readings yet</div>
        <div className="subtle">
          Once your Libre data is flowing, your glucose shows up here.
        </div>
        {children}
      </section>
    );
  }

  const stale = isStale(current.measuredAt);
  const band = bandFor(current.valueMgdl);

  // Stale is safety-critical: never present an old number as current.
  if (stale) {
    return (
      <section className="hero hero-stale">
        <div className="stale-badge">Data may be out of date</div>
        <div className="hero-value stale">
          {current.valueMgdl}
          <span className="hero-unit">mg/dL</span>
        </div>
        <div className="hero-ago warn">{agoLabel(current.measuredAt)}</div>
        <div className="subtle">Check your Libre app for your current reading.</div>
        {children}
      </section>
    );
  }

  return (
    <section className={`hero band-${band}`}>
      <div className="hero-value">
        {current.valueMgdl}
        <span className="hero-arrow">{trendArrow(current.trend)}</span>
        <span className="hero-unit">mg/dL</span>
      </div>
      <div className="hero-ago">{agoLabel(current.measuredAt)}</div>
      {children}
    </section>
  );
}
