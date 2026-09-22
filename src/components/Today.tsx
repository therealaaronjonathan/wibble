import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  Timestamp,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db, PATIENT_NAME, PATIENT_UID } from "../firebase";
import type { Reading } from "../glucose";
import { normalizeLog, type LogEntry } from "../logs";
import { homeTirWindow } from "../tir";
import { signOut } from "../useAuth";
import { messageForToday } from "../appreciation";
import AppreciationCard from "./AppreciationCard";
import GlucoseHero from "./GlucoseHero";
import Sparkline from "./Sparkline";
import QuickLog from "./QuickLog";
import DayChart from "./DayChart";
import LogDetail from "./LogDetail";
import IobDisplay from "./IobDisplay";
import TirDisplay from "./TirDisplay";

// ~3 hours of history at one point per minute, with headroom.
const HISTORY_LIMIT = 200;
// Home TIR window can span ~26h at one point per minute.
const TIR_LIMIT = 2000;
// Recent logs to keep live for the sparkline markers on the Today screen.
// (The "Your day" sheet fetches its own per-day data.)
const LOG_LIMIT = 100;

export default function Today({ user }: { user: User }) {
  // Single-user v1: everyone views the patient's shared record. Only she (the
  // owner uid) can write — everyone else is view-only (hardcoded pairing).
  const canLog = user.uid === PATIENT_UID;

  const [readings, setReadings] = useState<Reading[] | null>(null);
  const [tirReadings, setTirReadings] = useState<Reading[]>([]);
  const [error, setError] = useState(false);
  const [, setTirTick] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [editing, setEditing] = useState<LogEntry | null>(null);
  const [viewing, setViewing] = useState<LogEntry | null>(null);

  // Tapping a log dot/row: the patient edits it; a view-only account sees it
  // read-only.
  const openLog = (e: LogEntry) => (canLog ? setEditing(e) : setViewing(e));

  // Force-refresh to the latest deploy. The installed PWA's service worker
  // serves the cached (old) bundle until every window closes — so a plain
  // reload isn't enough. We unregister the SW + clear its caches, then reload,
  // which refetches the newest code and re-reads the latest glucose/logs.
  // Two taps (an armed confirm) so it can't fire by accident.
  const [refreshArmed, setRefreshArmed] = useState(false);
  async function refreshApp() {
    if (!refreshArmed) {
      setRefreshArmed(true);
      setTimeout(() => setRefreshArmed(false), 2500);
      return;
    }
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (typeof caches !== "undefined") {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) {
      console.error("[refresh] failed to clear caches", e);
    }
    window.location.reload();
  }

  useEffect(() => {
    const t = setInterval(() => setTirTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const tirWindow = homeTirWindow(new Date());
  const tirStartMs = tirWindow?.startMs ?? null;

  useEffect(() => {
    if (tirStartMs == null) {
      setTirReadings([]);
      return;
    }
    const q = query(
      collection(db, "readings"),
      where("measuredAt", ">=", Timestamp.fromMillis(tirStartMs)),
      orderBy("measuredAt", "asc"),
      limit(TIR_LIMIT)
    );
    return onSnapshot(
      q,
      (snap) => setTirReadings(snap.docs.map((d) => d.data() as Reading)),
      (err) => console.error("[tir] snapshot error", err)
    );
  }, [tirStartMs]);

  useEffect(() => {
    const q = query(
      collection(db, "readings"),
      orderBy("measuredAt", "desc"),
      limit(HISTORY_LIMIT)
    );
    return onSnapshot(
      q,
      (snap) => {
        setReadings(snap.docs.map((d) => d.data() as Reading));
        setError(false);
      },
      (err) => {
        console.error("[readings] snapshot error", err);
        setError(true);
      }
    );
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, "users", PATIENT_UID, "logs"),
      orderBy("loggedAt", "desc"),
      limit(LOG_LIMIT)
    );
    return onSnapshot(
      q,
      (snap) => {
        // estimate => freshly-written entries get a local timestamp instead of
        // null, so a marker shows up the moment she logs.
        setLogs(
          snap.docs.map((d) =>
            normalizeLog(d.id, d.data({ serverTimestamps: "estimate" }))
          )
        );
      },
      (err) => console.error("[logs] snapshot error", err)
    );
  }, []);

  // The daily appreciation is always addressed to the patient (her), whoever is
  // signed in — it's her record, her message.
  const message = useMemo(() => messageForToday(PATIENT_NAME), []);

  // newest first → current is [0]; sparkline wants oldest→newest, last 3h.
  const current = readings?.[0] ?? null;
  const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
  const series = (readings ?? [])
    .filter((r) => r.measuredAt.toMillis() >= threeHoursAgo)
    .slice()
    .reverse();

  return (
    <div className="screen today">
      <header className="topbar">
        <span className="wordmark sm">wibble</span>
        <div className="topbar-actions">
          <button
            className={`link${refreshArmed ? " armed" : ""}`}
            onClick={refreshApp}
            aria-label="Refresh the app to the latest version"
          >
            {refreshArmed ? "Tap again to refresh" : "↻ Refresh"}
          </button>
          <button className="link" onClick={() => signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {!canLog && (
        <p className="viewer-tag">Viewing {PATIENT_NAME}'s day</p>
      )}

      <AppreciationCard message={message} />

      <GlucoseHero
        current={current}
        loading={readings === null && !error}
        error={error}
      >
        <IobDisplay logs={logs} />
        <TirDisplay readings={tirReadings} />
      </GlucoseHero>

      {series.length > 1 && (
        <Sparkline
          readings={series}
          logs={logs}
          onOpen={() => setChartOpen(true)}
          onOpenLog={openLog}
        />
      )}

      {canLog && (
        <button className="btn-log" onClick={() => setLogOpen(true)}>
          + Add entry
        </button>
      )}

      {chartOpen && (
        <DayChart
          onOpenLog={openLog}
          onClose={() => setChartOpen(false)}
        />
      )}

      {canLog && logOpen && (
        <QuickLog uid={PATIENT_UID} onClose={() => setLogOpen(false)} />
      )}

      {canLog && editing && (
        <QuickLog
          uid={PATIENT_UID}
          existing={editing}
          onClose={() => setEditing(null)}
        />
      )}

      {viewing && (
        <LogDetail entry={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}
