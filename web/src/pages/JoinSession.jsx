import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiClient } from '../lib/apiClient.js';
import { getParticipant, saveParticipant } from '../lib/storage.js';
import { PageShell, Card, TextField, Button, Badge, Avatar, Spinner } from '../components/ui/index.js';
import './JoinSession.css';

export default function JoinSession() {
  const { shareToken } = useParams();
  const [detail, setDetail] = useState(null);
  const [participant, setParticipant] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);

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
    setJoining(true);
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
    } finally {
      setJoining(false);
    }
  }

  if (loading) {
    return (
      <PageShell maxWidth="sm">
        <div className="join-session-loading">
          <Spinner />
        </div>
      </PageShell>
    );
  }

  if (error && !detail) {
    return (
      <PageShell maxWidth="sm">
        <h1>SeatSync</h1>
        <Card>
          <p className="form-error">{error}</p>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell maxWidth="sm">
      <div className="join-session-header">
        <h1>{detail.session.title}</h1>
        {detail.session.city && <Badge tone="neutral">{detail.session.city}</Badge>}
      </div>

      {participant ? (
        <Card>
          <div className="join-session-welcome">
            <Avatar name={participant.displayName} size="md" />
            <p>
              Welcome back, <strong>{participant.displayName}</strong>. You're in.
            </p>
          </div>
          <Link to={`/s/${shareToken}/lobby`}>
            <Button variant="secondary" fullWidth>
              Go to the lobby
            </Button>
          </Link>
        </Card>
      ) : (
        <Card padding="lg">
          <form onSubmit={handleJoin} className="join-session-form">
            <TextField
              label="Your name"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Your name"
            />
            {error && <p className="form-error">{error}</p>}
            <Button type="submit" variant="primary" loading={joining} fullWidth>
              Join
            </Button>
          </form>
        </Card>
      )}
    </PageShell>
  );
}
