import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiClient } from '../lib/apiClient.js';
import { getParticipant } from '../lib/storage.js';
import AvailabilityWindows, { toLocalInputValue } from '../components/AvailabilityWindows.jsx';

export default function PreferenceForm() {
  const { shareToken } = useParams();
  const [session, setSession] = useState(null);
  const [participant, setParticipant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitted, setSubmitted] = useState(false);

  const [budgetCeiling, setBudgetCeiling] = useState('');
  const [seatClass, setSeatClass] = useState('');
  const [seatsTogether, setSeatsTogether] = useState(false);
  const [preferredLocation, setPreferredLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [windows, setWindows] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const detail = await apiClient.get(`/api/sessions/${shareToken}`);
        if (cancelled) return;
        setSession(detail.session);

        const rec = getParticipant(detail.session.id);
        if (!rec) {
          setError('No participant record found for this browser. Join the session first.');
          return;
        }
        setParticipant(rec);

        const prefResp = await apiClient.get(`/api/sessions/${shareToken}/preferences`, {
          participantToken: rec.participantToken,
        });
        if (cancelled) return;

        const pref = prefResp.preferences;
        if (pref) {
          if (pref.budgetCeiling != null) setBudgetCeiling(String(pref.budgetCeiling));
          if (pref.seatClass) setSeatClass(pref.seatClass);
          if (pref.seatsTogether != null) setSeatsTogether(pref.seatsTogether);
          if (pref.preferredLocation) setPreferredLocation(pref.preferredLocation);
          if (pref.notes) setNotes(pref.notes);
          if (pref.availabilityWindows?.length) {
            setWindows(
              pref.availabilityWindows.map((w) => ({
                start: toLocalInputValue(w.start),
                end: toLocalInputValue(w.end),
              }))
            );
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [shareToken]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      const body = {};
      if (budgetCeiling !== '') body.budgetCeiling = Number(budgetCeiling);
      if (seatClass !== '') body.seatClass = seatClass;
      if (seatsTogether) body.seatsTogether = true;
      if (preferredLocation !== '') body.preferredLocation = preferredLocation;
      if (notes !== '') body.notes = notes;

      const validWindows = windows.filter((w) => w.start && w.end);
      if (validWindows.length > 0) {
        body.availabilityWindows = validWindows.map((w) => ({
          start: new Date(w.start).toISOString(),
          end: new Date(w.end).toISOString(),
        }));
      }

      await apiClient.put(`/api/sessions/${shareToken}/preferences`, body, {
        participantToken: participant.participantToken,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) {
    return <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>Loading…</div>;
  }

  if (error && !participant) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <p style={{ color: 'crimson' }}>{error}</p>
        <Link to={`/s/${shareToken}`}>Go to join page</Link>
      </div>
    );
  }

  if (submitted) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <h1>Preferences saved</h1>
        <p>Thanks, {participant.displayName}. You can come back and change these any time.</p>
        <button type="button" onClick={() => setSubmitted(false)}>
          Edit again
        </button>
      </div>
    );
  }

  const dateMin = session.dateFrom ? `${session.dateFrom}T00:00` : undefined;
  const dateMax = session.dateTo ? `${session.dateTo}T23:59` : undefined;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 480 }}>
      <h1>{session.title}</h1>
      <p>Your preferences — everything is optional.</p>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1rem' }}>
          <label>
            Budget ceiling (per person)
            <input
              type="number"
              min="1"
              value={budgetCeiling}
              onChange={(e) => setBudgetCeiling(e.target.value)}
              style={{ display: 'block', width: '100%', padding: '0.5rem' }}
            />
          </label>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label>
            Seat class
            <input
              value={seatClass}
              onChange={(e) => setSeatClass(e.target.value)}
              placeholder="premium, recliner, …"
              style={{ display: 'block', width: '100%', padding: '0.5rem' }}
            />
          </label>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label>
            <input
              type="checkbox"
              checked={seatsTogether}
              onChange={(e) => setSeatsTogether(e.target.checked)}
            />{' '}
            We should sit together
          </label>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label>
            Preferred location / cinema
            <input
              value={preferredLocation}
              onChange={(e) => setPreferredLocation(e.target.value)}
              style={{ display: 'block', width: '100%', padding: '0.5rem' }}
            />
          </label>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label>
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ display: 'block', width: '100%', padding: '0.5rem' }}
            />
          </label>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <p>When are you free?</p>
          <AvailabilityWindows windows={windows} onChange={setWindows} min={dateMin} max={dateMax} />
        </div>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        <button type="submit">Save preferences</button>
      </form>
    </div>
  );
}
