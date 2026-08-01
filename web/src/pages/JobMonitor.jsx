import { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../lib/apiClient.js';
import { getOrganizerToken } from '../lib/storage.js';

// The demo's climax (§ P3-T7 notes): the whole group watches an approved
// booking run in real time. Polls every 2s, per the acceptance criteria —
// same pattern as useSessionPoll (P1-T7), but against /api/jobs/:id
// directly since a job outlives the session-detail poll cadence.
export default function JobMonitor() {
  const { shareToken, jobId } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [busy, setBusy] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get(`/api/sessions/${shareToken}`)
      .then((data) => !cancelled && setSessionId(data.session.id))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [shareToken]);

  useEffect(() => {
    cancelledRef.current = false;
    async function poll() {
      try {
        const data = await apiClient.get(`/api/jobs/${jobId}`);
        if (!cancelledRef.current) {
          setDetail(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelledRef.current) setError(err.message);
      }
    }
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      cancelledRef.current = true;
      clearInterval(id);
    };
  }, [jobId]);

  if (error && !detail) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
        <p style={{ color: 'crimson' }}>{error}</p>
      </div>
    );
  }
  useEffect(() => {
    if (detail?.job.status === 'succeeded') {
      navigate(`/s/${shareToken}/ticket`, { replace: true });
    }
  }, [detail?.job.status, navigate, shareToken]);

  if (!detail) {
    return <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>Loading…</div>;
  }

  const { job, events } = detail;
  const organizerToken = sessionId ? getOrganizerToken(sessionId) : null;
  const isOrganizer = Boolean(organizerToken);

  async function handleResume() {
    setBusy(true);
    try {
      await apiClient.post(`/api/jobs/${jobId}/resume`, {}, { organizerToken });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    setBusy(true);
    try {
      await apiClient.post(`/api/jobs/${jobId}/cancel`, {}, { organizerToken });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const lastScreenshotEvent = [...events].reverse().find((e) => e.screenshot_path);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 640 }}>
      <p>
        <Link to={`/s/${shareToken}/consensus`}>← Back</Link>
      </p>
      <h1>Booking in progress</h1>
      <p>
        Status: <strong>{job.status}</strong>
        {job.current_step ? ` — ${job.current_step}` : ''}
      </p>

      {job.status === 'awaiting_human' && (
        <div
          style={{
            background: '#fff3cd',
            border: '1px solid #ffe08a',
            borderRadius: 8,
            padding: '1rem',
            margin: '1rem 0',
          }}
        >
          <p style={{ margin: 0, fontWeight: 600 }}>Action needed</p>
          <p style={{ margin: '0.5rem 0' }}>{job.human_action_needed}</p>
          {isOrganizer && (
            <button type="button" onClick={handleResume} disabled={busy}>
              Resume
            </button>
          )}
        </div>
      )}

      {job.status === 'failed' && (
        <div style={{ background: '#fdecea', borderRadius: 8, padding: '1rem', margin: '1rem 0' }}>
          <p style={{ margin: 0, fontWeight: 600 }}>Booking failed</p>
          <p style={{ margin: '0.5rem 0' }}>
            {job.error_code}: {job.error_message}
          </p>
          {lastScreenshotEvent && <p style={{ color: '#666' }}>Last screenshot: {lastScreenshotEvent.screenshot_path}</p>}
        </div>
      )}

      {job.status === 'cancelled' && <p>This booking was cancelled.</p>}

      {isOrganizer && ['queued', 'running', 'awaiting_human'].includes(job.status) && (
        <button type="button" onClick={handleCancel} disabled={busy}>
          Cancel booking
        </button>
      )}

      <h2>Progress</h2>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {events.map((e) => (
          <li key={e.id} style={{ padding: '0.35rem 0', borderBottom: '1px solid #eee' }}>
            <span style={{ color: e.level === 'error' ? 'crimson' : e.level === 'warn' ? '#a15c00' : '#333' }}>
              {e.level === 'error' ? '✖' : e.level === 'warn' ? '⚠' : '•'} {e.message}
            </span>
          </li>
        ))}
        {events.length === 0 && <li style={{ color: '#666' }}>Waiting for the runner to pick this up…</li>}
      </ul>
    </div>
  );
}
