import './Meter.css';

/** Horizontal mini progress bar with a label and numeric value (0-100). */
export default function Meter({ label, value }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div className="ui-meter">
      <div className="ui-meter-head">
        <span className="ui-meter-label">{label}</span>
        <span className="ui-meter-value">{Math.round(pct)}</span>
      </div>
      <div className="ui-meter-track">
        <div className="ui-meter-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
