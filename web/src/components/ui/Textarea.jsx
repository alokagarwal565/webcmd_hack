import { useId } from 'react';
import './TextField.css';

/** Labeled multi-line input. Shares field/input styling with TextField. */
export default function Textarea({ label, value, onChange, placeholder, rows = 4, hint, ...rest }) {
  const id = useId();
  return (
    <div className="ui-field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
        className="ui-textarea"
        {...rest}
      />
      {hint && <p className="ui-field-hint">{hint}</p>}
    </div>
  );
}
