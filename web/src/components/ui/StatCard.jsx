import './StatCard.css';

/** Small label+value tile, used in a responsive grid. */
export default function StatCard({ label, value }) {
  return (
    <div className="ui-stat-card">
      <span className="ui-stat-card-label">{label}</span>
      <span className="ui-stat-card-value">{value}</span>
    </div>
  );
}
