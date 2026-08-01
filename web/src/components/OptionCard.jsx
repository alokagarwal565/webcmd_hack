// One ranked option (§17). Deterministic score + breakdown are shown
// alongside the LLM's reasoning so the AI's contribution is legible rather
// than a black box (P2-T8 notes) — the organizer can see exactly why an
// option ranked where it did.
const DIMENSION_LABELS = {
  availability: 'Availability',
  budget: 'Budget',
  seat: 'Seats',
  content: 'Content',
  convenience: 'Convenience',
};

function formatShowTime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function OptionCard({ option }) {
  const { title, venue, showTime, price, score, reasoning, recommended, disqualified, scoreBreakdown } = option;

  return (
    <div
      style={{
        border: recommended ? '2px solid #2e7d32' : '1px solid #ddd',
        borderRadius: 8,
        padding: '1rem',
        marginBottom: '0.75rem',
        opacity: disqualified ? 0.6 : 1,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        <span style={{ fontWeight: 600 }}>{typeof score === 'number' ? `${Math.round(score)}/100` : '—'}</span>
      </div>

      {recommended && (
        <span
          style={{
            display: 'inline-block',
            background: '#2e7d32',
            color: '#fff',
            fontSize: '0.75rem',
            padding: '0.1rem 0.5rem',
            borderRadius: 999,
            marginTop: '0.25rem',
          }}
        >
          Recommended
        </span>
      )}
      {disqualified && (
        <span style={{ display: 'inline-block', color: 'crimson', fontSize: '0.85rem', marginTop: '0.25rem' }}>
          Excluded
        </span>
      )}

      <p style={{ margin: '0.5rem 0', color: '#555' }}>
        {venue}
        {formatShowTime(showTime) ? ` · ${formatShowTime(showTime)}` : ''}
        {typeof price === 'number' ? ` · ₹${price}` : ''}
      </p>

      {reasoning && <p style={{ margin: '0.5rem 0' }}>{reasoning}</p>}

      {scoreBreakdown && (
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', fontSize: '0.8rem', color: '#666' }}>
          {Object.entries(scoreBreakdown).map(([key, value]) => (
            <span key={key}>
              {DIMENSION_LABELS[key] ?? key}: {value}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
