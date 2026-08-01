import { useParams, Link } from 'react-router-dom';
import { useSessionPoll } from '../hooks/useSessionPoll.js';
import { getOrganizerToken, getParticipant } from '../lib/storage.js';

export default function Lobby() {
  const { shareToken } = useParams();
  const { data, loading, error } = useSessionPoll(shareToken, 3000);

  if (loading && !data) {
    return <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>Loading…</div>;
  }

  if (error && !data) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <p style={{ color: 'crimson' }}>{error}</p>
      </div>
    );
  }

  const { session, participants, counts, consensus } = data;
  const isOrganizer = Boolean(getOrganizerToken(session.id));
  const mine = getParticipant(session.id);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 480 }}>
      <h1>{session.title}</h1>
      {session.city && <p>{session.city}</p>}

      <p>
        <strong>
          {counts.submitted} of {counts.participants} responded
        </strong>
      </p>

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {participants.map((p) => (
          <li key={p.id} style={{ padding: '0.25rem 0' }}>
            {p.hasSubmitted ? '✅' : '⬜'} {p.displayName}
          </li>
        ))}
      </ul>

      {mine && (
        <p>
          <Link to={`/s/${shareToken}/preferences`}>
            {mine ? 'Set / edit your preferences' : 'Set your preferences'}
          </Link>
        </p>
      )}

      {consensus && !isOrganizer && (
        <p>
          <Link to={`/s/${shareToken}/consensus`}>View recommendations →</Link>
        </p>
      )}

      {isOrganizer && (
        <div style={{ marginTop: '1.5rem', borderTop: '1px solid #ddd', paddingTop: '1rem' }}>
          <p style={{ color: '#666', fontSize: '0.9rem' }}>Organizer controls</p>
          <p>
            <Link to={`/s/${shareToken}/consensus`}>Run aggregation / view recommendations →</Link>
          </p>
          {/* Approve action lands here in Phase 3, on ConsensusView (P3-T7). */}
        </div>
      )}
    </div>
  );
}
