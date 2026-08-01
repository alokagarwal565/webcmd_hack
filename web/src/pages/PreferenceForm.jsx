import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiClient } from '../lib/apiClient.js';
import { getParticipant } from '../lib/storage.js';
import AvailabilityWindows, { toLocalInputValue } from '../components/AvailabilityWindows.jsx';
import { PageShell, Card, TextField, Textarea, Checkbox, Button, Spinner } from '../components/ui/index.js';
import './PreferenceForm.css';

export default function PreferenceForm() {
  const { shareToken } = useParams();
  const [session, setSession] = useState(null);
  const [participant, setParticipant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

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
    setSaving(true);
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
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <PageShell maxWidth="sm">
        <div className="preference-form-loading">
          <Spinner />
        </div>
      </PageShell>
    );
  }

  if (error && !participant) {
    return (
      <PageShell maxWidth="sm">
        <Card>
          <p className="form-error">{error}</p>
          <Link to={`/s/${shareToken}`} className="link-arrow">
            Go to join page
          </Link>
        </Card>
      </PageShell>
    );
  }

  if (submitted) {
    return (
      <PageShell maxWidth="sm">
        <Card>
          <h1 className="preference-form-confirm-title">Preferences saved</h1>
          <p className="preference-form-confirm-text">
            Thanks, {participant.displayName}. You can come back and change these any time.
          </p>
          <Button variant="secondary" onClick={() => setSubmitted(false)}>
            Edit again
          </Button>
        </Card>
      </PageShell>
    );
  }

  const dateMin = session.dateFrom ? `${session.dateFrom}T00:00` : undefined;
  const dateMax = session.dateTo ? `${session.dateTo}T23:59` : undefined;

  return (
    <PageShell maxWidth="sm">
      <div>
        <h1>{session.title}</h1>
        <p>Your preferences — everything is optional.</p>
      </div>
      <Card padding="lg">
        <form onSubmit={handleSubmit} className="preference-form">
          <TextField
            label="Budget ceiling (per person)"
            type="number"
            min="1"
            value={budgetCeiling}
            onChange={(e) => setBudgetCeiling(e.target.value)}
          />
          <TextField
            label="Seat class"
            value={seatClass}
            onChange={(e) => setSeatClass(e.target.value)}
            placeholder="premium, recliner, …"
          />
          <Checkbox
            label="We should sit together"
            checked={seatsTogether}
            onChange={(e) => setSeatsTogether(e.target.checked)}
          />
          <TextField
            label="Preferred location / cinema"
            value={preferredLocation}
            onChange={(e) => setPreferredLocation(e.target.value)}
          />
          <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="preference-form-availability">
            <h2>When are you free?</h2>
            <AvailabilityWindows windows={windows} onChange={setWindows} min={dateMin} max={dateMax} />
          </div>
          {error && <p className="form-error">{error}</p>}
          <Button type="submit" variant="primary" loading={saving} fullWidth>
            Save preferences
          </Button>
        </form>
      </Card>
    </PageShell>
  );
}
