import { useState } from 'react';
import { apiClient } from '../lib/apiClient.js';
import { saveOrganizerToken } from '../lib/storage.js';

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
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 480 }}>
        <h1>SeatSync</h1>
        <p>Session created. Share this link with your group:</p>
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <input readOnly value={link} style={{ flex: 1, padding: '0.5rem' }} />
          <button type="button" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
        <p style={{ color: '#666', fontSize: '0.9rem' }}>
          Keep this browser/device — your organizer access lives here only.
        </p>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 480 }}>
      <h1>SeatSync</h1>
      <p>Group booking without the group-chat chaos.</p>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1rem' }}>
          <label>
            Title
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Friday movie night"
              style={{ display: 'block', width: '100%', padding: '0.5rem' }}
            />
          </label>
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label>
            City
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Bengaluru"
              style={{ display: 'block', width: '100%', padding: '0.5rem' }}
            />
          </label>
        </div>
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
          <label style={{ flex: 1 }}>
            From
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{ display: 'block', width: '100%', padding: '0.5rem' }}
            />
          </label>
          <label style={{ flex: 1 }}>
            To
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{ display: 'block', width: '100%', padding: '0.5rem' }}
            />
          </label>
        </div>
        {error && <p style={{ color: 'crimson' }}>{error}</p>}
        <button type="submit">Create session</button>
      </form>
    </div>
  );
}
