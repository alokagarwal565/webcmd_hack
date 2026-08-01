// One ranked option (§17). Deterministic score + breakdown are shown
// alongside the LLM's reasoning so the AI's contribution is legible rather
// than a black box (P2-T8 notes) — the organizer can see exactly why an
// option ranked where it did.
import { Card, Badge, Meter } from './ui/index.js';
import './OptionCard.css';

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
    <Card variant={recommended ? 'accent' : 'default'} className={disqualified ? 'option-card-disqualified' : ''}>
      <div className="option-card-head">
        <h3>{title}</h3>
        <span className="option-card-score">{typeof score === 'number' ? `${Math.round(score)}/100` : '—'}</span>
      </div>

      {(recommended || disqualified) && (
        <div className="option-card-tags">
          {recommended && <Badge tone="success">Recommended</Badge>}
          {disqualified && <Badge tone="neutral">Excluded</Badge>}
        </div>
      )}

      <p className="option-card-meta">
        {venue}
        {formatShowTime(showTime) ? ` · ${formatShowTime(showTime)}` : ''}
        {typeof price === 'number' ? ` · ₹${price}` : ''}
      </p>

      {reasoning && (
        <div className="option-card-reasoning">
          <span className="option-card-reasoning-label">AI reasoning</span>
          <p>{reasoning}</p>
        </div>
      )}

      {scoreBreakdown && (
        <div className="ui-meter-grid option-card-meters">
          {Object.entries(scoreBreakdown).map(([key, value]) => (
            <Meter key={key} label={DIMENSION_LABELS[key] ?? key} value={value} />
          ))}
        </div>
      )}
    </Card>
  );
}
