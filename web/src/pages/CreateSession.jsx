import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../lib/apiClient.js';
import { saveOrganizerToken } from '../lib/storage.js';
import { PageShell, Card, TextField, Button } from '../components/ui/index.js';
import './CreateSession.css';

export default function CreateSession() {
  const [title, setTitle] = useState('');
  const [city, setCity] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      const body = { title };
      if (city) body.city = city;
      if (dateFrom) body.dateFrom = dateFrom;
      if (dateTo) body.dateTo = dateTo;

      const data = await apiClient.post('/api/sessions', body);
      saveOrganizerToken(data.session.id, data.organizerToken);
      setResult(data);
    } catch (err) {
      setError(err.message);
    }
  }

  function handleCopy() {
    const link = `${window.location.origin}/s/${result.shareToken}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (result) {
    const link = `${window.location.origin}/s/${result.shareToken}`;
    return (
      <PageShell maxWidth="sm">
        <h1>SeatSync</h1>
        <Card>
          <p className="create-session-lead">Session created. Share this link with your group:</p>
          <div className="create-session-share-row">
            <TextField label="Share link" hideLabel readOnly value={link} />
            <Button variant={copied ? 'secondary' : 'primary'} onClick={handleCopy}>
              {copied ? 'Copied!' : 'Copy link'}
            </Button>
          </div>
          <p className="create-session-caption">
            Keep this browser/device — your organizer access lives here only.
          </p>
        </Card>
        <Link to={`/s/${result.shareToken}/lobby`} className="link-arrow">
          Go to the lobby →
        </Link>
      </PageShell>
    );
  }

  return (
    <PageShell maxWidth="sm">
      <div className="create-session-hero">
        <h1>SeatSync</h1>
        <p>Group booking without the group-chat chaos.</p>
      </div>
      <Card padding="lg">
        <form onSubmit={handleSubmit} className="create-session-form">
          <TextField
            label="Title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Friday movie night"
          />
          <TextField
            label="City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Bengaluru"
          />
          <div className="create-session-date-row">
            <TextField label="From" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <TextField label="To" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          {error && <p className="form-error">{error}</p>}
          <Button type="submit" variant="primary" fullWidth>
            Create session
          </Button>
        </form>
      </Card>
    </PageShell>
  );
}
