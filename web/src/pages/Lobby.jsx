import { useParams, Link } from 'react-router-dom';
import { useSessionPoll } from '../hooks/useSessionPoll.js';
import { getOrganizerToken, getParticipant } from '../lib/storage.js';
import { PageShell, Card, Badge, Avatar, Meter, Spinner } from '../components/ui/index.js';
import './Lobby.css';

export default function Lobby() {
  const { shareToken } = useParams();
  const { data, loading, error } = useSessionPoll(shareToken, 3000);

  if (loading && !data) {
    return (
      <PageShell maxWidth="sm">
        <div className="lobby-loading">
          <Spinner />
        </div>
      </PageShell>
    );
  }

  if (error && !data) {
    return (
      <PageShell maxWidth="sm">
        <Card>
          <p className="form-error">{error}</p>
        </Card>
      </PageShell>
    );
  }

  const { session, participants, counts, consensus } = data;
  const isOrganizer = Boolean(getOrganizerToken(session.id));
  const mine = getParticipant(session.id);

  return (
    <PageShell maxWidth="sm">
      <div className="lobby-header">
        <h1>{session.title}</h1>
        {session.city && <Badge tone="neutral">{session.city}</Badge>}
      </div>

      <Card>
        <Meter label={`${counts.submitted} of ${counts.participants} responded`} value={(counts.submitted / Math.max(1, counts.participants)) * 100} />
        <ul className="lobby-participant-list">
          {participants.map((p) => (
            <li key={p.id} className="lobby-participant-row">
              <span className="lobby-participant-identity">
                <Avatar name={p.displayName} />
                {p.displayName}
              </span>
              <Badge tone={p.hasSubmitted ? 'success' : 'neutral'}>
                {p.hasSubmitted ? 'Responded' : 'Waiting'}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>

      {mine && (
        <Link to={`/s/${shareToken}/preferences`} className="link-arrow">
          {mine ? 'Set / edit your preferences' : 'Set your preferences'} →
        </Link>
      )}

      {consensus && !isOrganizer && (
        <Link to={`/s/${shareToken}/consensus`} className="link-arrow">
          View recommendations →
        </Link>
      )}

      {isOrganizer && (
        <Card variant="muted">
          <Badge tone="neutral" size="sm">
            Organizer controls
          </Badge>
          <div className="lobby-organizer-link">
            <Link to={`/s/${shareToken}/consensus`} className="link-arrow">
              Run aggregation / view recommendations →
            </Link>
          </div>
          {/* Approve action lands here in Phase 3, on ConsensusView (P3-T7). */}
        </Card>
      )}
    </PageShell>
  );
}
