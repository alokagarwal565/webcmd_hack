import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiClient } from '../lib/apiClient.js';
import { getParticipant, saveParticipant } from '../lib/storage.js';

export default function JoinSession() {
  const { shareToken } = useParams();
  const [detail, setDetail] = useState(null);
  const [participant, setParticipant] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get(`/api/sessions/${shareToken}`)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        const existing = getParticipant(data.session.id);
        if (existing) setParticipant(existing);
      })
      .catch((err) => !cancelled && setError(err.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [shareToken]);

  async function handleJoin(e) {
    e.preventDefault();
    setError(null);
    try {
      const data = await apiClient.post(`/api/sessions/${shareToken}/participants`, {
        displayName,
      });
      const record = {
        participantId: data.participant.id,
        displayName: data.participant.displayName,
        participantToken: data.participantToken,
      };
      saveParticipant(detail.session.id, record);
      setParticipant(record);
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) {
    return <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>Loading…</div>;
  }

  if (error && !detail) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <h1>SeatSync</h1>
        <p style={{ color: 'crimson' }}>{error}</p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 480 }}>
      <h1>{detail.session.title}</h1>
      {detail.session.city && <p>{detail.session.city}</p>}

      {participant ? (
        <>
          <p>
            Welcome back, <strong>{participant.displayName}</strong>. You're in.
          </p>
          <p>
            <Link to={`/s/${shareToken}/lobby`}>Go to the lobby</Link>
          </p>
        </>
      ) : (
        <form onSubmit={handleJoin}>
          <div style={{ marginBottom: '1rem' }}>
            <label>
              Your name
              <input
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name"
                style={{ display: 'block', width: '100%', padding: '0.5rem' }}
              />
            </label>
          </div>
          {error && <p style={{ color: 'crimson' }}>{error}</p>}
          <button type="submit">Join</button>
        </form>
      )}
    </div>
  );
}
