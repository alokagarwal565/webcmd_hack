import './Avatar.css';

const SIZES = { sm: 28, md: 36 };

// Deterministic hue offset from the name so the same person always gets the
// same tint, without needing to store a color anywhere.
function hueFromName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) % 360;
  }
  return hash;
}

function initials(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Avatar({ name, size = 'sm' }) {
  const px = SIZES[size];
  const hue = hueFromName(name || '?');
  return (
    <span
      className="ui-avatar"
      style={{
        width: px,
        height: px,
        fontSize: px * 0.4,
        background: `hsla(${hue}, 70%, 60%, 0.18)`,
        color: `hsl(${hue}, 70%, 72%)`,
      }}
      aria-hidden="true"
    >
      {initials(name || '?')}
    </span>
  );
}
