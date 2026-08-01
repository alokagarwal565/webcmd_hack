import { useId } from 'react';
import './Checkbox.css';

/** Custom-styled checkbox (native input visually hidden + styled box). */
export default function Checkbox({ label, checked, onChange, id }) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <label htmlFor={inputId} className="ui-checkbox-row">
      <span className="ui-checkbox-box">
        <input id={inputId} type="checkbox" checked={checked} onChange={onChange} />
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M3 8.5 6.5 12 13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="ui-checkbox-label">{label}</span>
    </label>
  );
}
