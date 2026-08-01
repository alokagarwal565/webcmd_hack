import './Spinner.css';

const SIZES = { sm: 16, md: 24, lg: 32 };

export default function Spinner({ size = 'md' }) {
  const px = SIZES[size];
  return (
    <svg
      className="ui-spinner"
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
      role="status"
      aria-label="Loading"
    >
      <circle cx="12" cy="12" r="10" stroke="var(--border-default)" strokeWidth="3" />
      <path
        d="M22 12a10 10 0 0 0-10-10"
        stroke="var(--accent)"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
