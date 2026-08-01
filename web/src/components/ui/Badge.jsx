import './Badge.css';

/** Small pill label for statuses. */
export default function Badge({ children, tone = 'neutral', size = 'sm' }) {
  return <span className={`ui-badge ui-badge-${tone} ui-badge-${size}`}>{children}</span>;
}
