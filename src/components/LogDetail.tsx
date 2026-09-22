import { dayTimeLabel, logParts, type LogEntry } from "../logs";

// Read-only view of a single log entry. Shown when a view-only account (the
// husband) taps a log dot/row — he can see what she logged but not change it.
// (The patient gets the editable QuickLog sheet instead.)
export default function LogDetail({
  entry,
  onClose,
}: {
  entry: LogEntry;
  onClose: () => void;
}) {
  const { macro, note } = logParts(entry);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" />
        <h2 className="sheet-title">
          {entry.loggedAt ? dayTimeLabel(entry.loggedAt) : "Log"}
        </h2>

        {macro && <p className="logdetail-macro">{macro}</p>}
        {note && <p className="logdetail-note">{note}</p>}
        {!macro && !note && <p className="muted">No details on this entry.</p>}

        <div className="sheet-actions">
          <button className="btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
