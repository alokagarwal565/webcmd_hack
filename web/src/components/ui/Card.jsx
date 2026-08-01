import './Card.css';

/**
 * Rounded bordered surface. `variant="accent"` adds a glow border (used for
 * the recommended option); `variant="muted"` is for secondary/organizer
 * blocks that shouldn't compete visually with primary content.
 */
export default function Card({ children, variant = 'default', padding = 'md', className = '' }) {
  const classes = ['ui-card', `ui-card-${variant}`, `ui-card-pad-${padding}`, className]
    .filter(Boolean)
    .join(' ');
  return <div className={classes}>{children}</div>;
}
