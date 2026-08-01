import './EmptyState.css';

/** Centered title/description/action block for "nothing here yet" moments. */
export default function EmptyState({ title, description, action }) {
  return (
    <div className="ui-empty-state">
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <div className="ui-empty-state-action">{action}</div>}
    </div>
  );
}
