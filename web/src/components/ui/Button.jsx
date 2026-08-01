import Spinner from './Spinner.jsx';
import './Button.css';

/**
 * All buttons/CTAs across the app. `loading` swaps the label for an inline
 * spinner and disables the button, without changing its width.
 */
export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  type = 'button',
  fullWidth = false,
  onClick,
  ...rest
}) {
  const classes = [
    'ui-button',
    `ui-button-${variant}`,
    `ui-button-${size}`,
    fullWidth ? 'ui-button-full' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || loading}
      onClick={onClick}
      aria-busy={loading}
      {...rest}
    >
      {loading ? <Spinner size="sm" /> : children}
    </button>
  );
}
