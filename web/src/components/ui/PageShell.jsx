import { Link } from 'react-router-dom';
import './PageShell.css';

const MAX_WIDTHS = { sm: 480, md: 640, lg: 880 };

/**
 * Top-level page wrapper — centers content, responsive padding, and an
 * optional back-link slot. Replaces every page's duplicated
 * `fontFamily/padding/maxWidth` inline-style div.
 */
export default function PageShell({ children, maxWidth = 'sm', back }) {
  return (
    <div className="page-shell" style={{ maxWidth: MAX_WIDTHS[maxWidth] }}>
      {back && (
        <Link to={back.to} className="link-arrow page-shell-back">
          ← {back.label}
        </Link>
      )}
      {children}
    </div>
  );
}
