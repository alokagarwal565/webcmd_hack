import { useId } from 'react';
import './TextField.css';

/**
 * Labeled single-line input (text/number/date/datetime-local/...).
 * `hideLabel` visually hides the label while keeping it accessible
 * (used for paired start/end datetime inputs in AvailabilityWindows).
 */
export default function TextField({
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  required = false,
  min,
  max,
  error,
  hint,
  hideLabel = false,
  readOnly = false,
  ...rest
}) {
  const id = useId();
  return (
    <div className="ui-field">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        min={min}
        max={max}
        readOnly={readOnly}
        className={`ui-input ${error ? 'ui-input-error' : ''}`}
        {...rest}
      />
      {hint && !error && <p className="ui-field-hint">{hint}</p>}
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}
