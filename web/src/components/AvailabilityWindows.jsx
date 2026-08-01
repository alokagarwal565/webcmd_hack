// Repeatable local-datetime window pairs. Values are kept as
// datetime-local strings (local time) while editing; the page converts to
// UTC ISO once, at the submit boundary (R13 — never store/pass local strings).

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
    <div>
      {windows.map((w, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
          <input
            type="datetime-local"
            value={w.start}
            min={min}
            max={max}
            onChange={(e) => updateWindow(i, 'start', e.target.value)}
          />
          <input
            type="datetime-local"
            value={w.end}
            min={min}
            max={max}
            onChange={(e) => updateWindow(i, 'end', e.target.value)}
          />
          <button type="button" onClick={() => removeWindow(i)}>
            Remove
          </button>
        </div>
      ))}
      <button type="button" onClick={addWindow}>
        + Add a time window
      </button>
    </div>
  );
}
