// Repeatable local-datetime window pairs. Values are kept as
// datetime-local strings (local time) while editing; the page converts to
// UTC ISO once, at the submit boundary (R13 — never store/pass local strings).
import { TextField, Button } from './ui/index.js';
import './AvailabilityWindows.css';

export function toLocalInputValue(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

export default function AvailabilityWindows({ windows, onChange, min, max }) {
  function updateWindow(index, field, value) {
    const next = windows.map((w, i) => (i === index ? { ...w, [field]: value } : w));
    onChange(next);
  }

  function addWindow() {
    onChange([...windows, { start: '', end: '' }]);
  }

  function removeWindow(index) {
    onChange(windows.filter((_, i) => i !== index));
  }

  return (
    <div className="availability-windows">
      {windows.map((w, i) => (
        <div key={i} className="availability-window-row">
          <TextField
            label="Start"
            hideLabel
            type="datetime-local"
            value={w.start}
            min={min}
            max={max}
            onChange={(e) => updateWindow(i, 'start', e.target.value)}
          />
          <TextField
            label="End"
            hideLabel
            type="datetime-local"
            value={w.end}
            min={min}
            max={max}
            onChange={(e) => updateWindow(i, 'end', e.target.value)}
          />
          <Button variant="ghost" size="sm" onClick={() => removeWindow(i)}>
            Remove
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={addWindow}>
        + Add a time window
      </Button>
    </div>
  );
}
