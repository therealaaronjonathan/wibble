import {
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import type { LogEntry } from "../logs";

// Deliberately minimal: a free-text note + optional carbs + optional insulin.
// Insulin can be tagged basal (long-acting) so it does not count toward IOB.
//
// One sheet, two modes:
//   - create (no `existing`): addDoc a new entry.
//   - edit (`existing` passed): prefill, updateDoc on save, with a Delete option.
//
// Save fires on pointerdown (not click). iOS otherwise spends the first tap
// dismissing the keyboard / native time picker, so click never arrives.
export default function QuickLog({
  uid,
  existing,
  onClose,
}: {
  uid: string;
  existing?: LogEntry;
  onClose: () => void;
}) {
  const editing = existing != null;
  const [note, setNote] = useState(existing?.note ?? "");
  const [carbs, setCarbs] = useState(
    existing?.carbs != null ? String(existing.carbs) : ""
  );
  const [insulin, setInsulin] = useState(
    existing?.insulinUnits != null ? String(existing.insulinUnits) : ""
  );
  const [basal, setBasal] = useState(existing?.tag === "basal");
  // When the moment happened. Defaults to now; she can scroll it back to log an
  // earlier moment from today. Editing keeps the entry's own day and just lets
  // her fix the time.
  const [whenMs, setWhenMs] = useState<number>(
    existing?.loggedAt?.toMillis() ?? Date.now()
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Same-tick pointerdown+click must not double-write (React state is too late).
  const inFlight = useRef(false);

  const busy = saving || deleting;
  const empty = !note.trim() && !carbs.trim() && !insulin.trim();
  const insulinPreview = parseOptionalNumber(insulin);
  const showBasal =
    insulinPreview !== null && insulinPreview !== "invalid";

  async function save() {
    if (empty || busy || inFlight.current) return;
    if (whenMs > Date.now()) {
      setErr("That time is still in the future — pick a time up to now.");
      return;
    }
    const carbsVal = parseOptionalNumber(carbs);
    const insulinVal = parseOptionalNumber(insulin);
    if (carbsVal === "invalid" || insulinVal === "invalid") {
      setErr("Carbs and insulin need to be numbers.");
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setErr(null);
    const loggedAt = Timestamp.fromDate(new Date(whenMs));
    const fields = {
      note: note.trim(),
      carbs: carbsVal,
      insulinUnits: insulinVal,
      loggedAt,
      tag: insulinVal != null && basal ? "basal" : null,
    };
    try {
      if (editing) {
        await updateDoc(doc(db, "users", uid, "logs", existing!.id), fields);
      } else {
        await addDoc(collection(db, "users", uid, "logs"), fields);
      }
      onClose();
    } catch (e) {
      console.error("[quicklog] save failed", e);
      setErr("Couldn't save. Try again.");
      inFlight.current = false;
      setSaving(false);
    }
  }

  function onTimeChange(value: string) {
    const [h, m] = value.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return;
    const d = new Date(whenMs);
    d.setHours(h, m, 0, 0);
    setWhenMs(d.getTime());
    setErr(null);
  }

  const isToday =
    new Date(whenMs).toDateString() === new Date().toDateString();
  const maxTime = isToday ? toTimeInput(Date.now()) : undefined;

  function setLogDay(yesterday: boolean) {
    const next = shiftWhenToDay(whenMs, yesterday);
    const clamped = !yesterday && next > Date.now() ? Date.now() : next;
    setWhenMs(clamped);
    setErr(null);
  }

  async function remove() {
    if (!editing || busy || inFlight.current) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    inFlight.current = true;
    setDeleting(true);
    setErr(null);
    try {
      await deleteDoc(doc(db, "users", uid, "logs", existing!.id));
      onClose();
    } catch (e) {
      console.error("[quicklog] delete failed", e);
      setErr("Couldn't delete. Try again.");
      inFlight.current = false;
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h2 className="sheet-title">{editing ? "Edit entry" : "Add entry"}</h2>

        <label className="field">
          <span className="field-label">Note</span>
          <textarea
            className="input"
            rows={3}
            placeholder="What's going on? (food, how you feel, anything)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus={!editing}
          />
        </label>

        <div className="field">
          <div className="when-head">
            <span className="field-label">When</span>
            {!editing && (
              <div className="day-chips">
                <button
                  type="button"
                  className={`day-chip${isToday ? " on" : ""}`}
                  aria-pressed={isToday}
                  {...pressProps(() => setLogDay(false))}
                >
                  Today
                </button>
                <button
                  type="button"
                  className={`day-chip${!isToday ? " on" : ""}`}
                  aria-pressed={!isToday}
                  {...pressProps(() => setLogDay(true))}
                >
                  Yesterday
                </button>
              </div>
            )}
          </div>
          <input
            className="input"
            type="time"
            value={toTimeInput(whenMs)}
            max={maxTime}
            onChange={(e) => onTimeChange(e.target.value)}
          />
        </div>

        <div className="field-row">
          <label className="field">
            <span className="field-label">Carbs (g)</span>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              placeholder="optional"
              value={carbs}
              onChange={(e) => setCarbs(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Insulin (u)</span>
            <input
              className="input"
              type="number"
              inputMode="decimal"
              placeholder="optional"
              value={insulin}
              onChange={(e) => {
                setInsulin(e.target.value);
                if (!e.target.value.trim()) setBasal(false);
              }}
            />
          </label>
        </div>

        {showBasal && (
          <button
            type="button"
            className={`basal-chip${basal ? " on" : ""}`}
            aria-pressed={basal}
            {...pressProps(() => setBasal((v) => !v))}
          >
            Basal (long-acting)
          </button>
        )}
        {showBasal && (
          <p className="basal-hint">
            Night insulin. Does not count as insulin on board.
          </p>
        )}

        {err && <p className="error">{err}</p>}

        <div className="sheet-actions">
          <button
            type="button"
            className="btn-ghost"
            disabled={busy}
            {...pressProps(onClose, busy)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={empty || busy}
            {...pressProps(save, empty || busy)}
          >
            {saving ? "Saving…" : editing ? "Save changes" : "Save"}
          </button>
        </div>

        {editing && (
          <button
            type="button"
            className="btn-delete"
            disabled={busy}
            {...pressProps(remove, busy)}
          >
            {deleting
              ? "Deleting…"
              : confirmDelete
                ? "Tap again to delete"
                : "Delete entry"}
          </button>
        )}
      </div>
    </div>
  );
}

// Local HH:MM for a <input type="time"> value.
function shiftWhenToDay(whenMs: number, yesterday: boolean): number {
  const time = new Date(whenMs);
  const day = new Date();
  if (yesterday) day.setDate(day.getDate() - 1);
  day.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return day.getTime();
}

function toTimeInput(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function parseOptionalNumber(raw: string): number | null | "invalid" {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  if (n === 0) return null;
  return n;
}

function blurActive() {
  const ae = document.activeElement;
  if (ae instanceof HTMLElement) ae.blur();
}

// Fire the action on pointerdown (iOS otherwise spends that tap blurring the
// focused field, and dismissing the keyboard can slide the button out from
// under pointerup). preventDefault suppresses the trailing click; click is
// kept as a keyboard-activation fallback.
function pressProps(action: () => void, disabled = false) {
  return {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      if (disabled || e.button !== 0) return;
      e.preventDefault();
      blurActive();
      e.currentTarget.dataset.pressHandled = "1";
      action();
    },
    onClick: (e: MouseEvent<HTMLButtonElement>) => {
      if (disabled) return;
      if (e.currentTarget.dataset.pressHandled === "1") {
        delete e.currentTarget.dataset.pressHandled;
        return;
      }
      action();
    },
  };
}
