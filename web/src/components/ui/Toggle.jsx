import { useId } from 'react';
import './Toggle.css';

/**
 * Pill switch — reserved for future on/off system state (e.g. a manual
 * light/dark override), not used for ordinary boolean form preferences
 * (those use Checkbox). Built now, not wired into any page yet.
 */
export default function Toggle({ checked, onChange, label, id }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <label htmlFor={inputId} className="ui-toggle-row">
      {label && <span className="ui-checkbox-label">{label}</span>}
      <span className="ui-toggle-track">
        <input id={inputId} type="checkbox" checked={checked} onChange={onChange} />
        <span className="ui-toggle-thumb" />
      </span>
    </label>
  );
}
