import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../lib/apiClient.js';
import { useSessionPoll } from '../hooks/useSessionPoll.js';
import { getOrganizerToken } from '../lib/storage.js';
import OptionCard from '../components/OptionCard.jsx';

// The view that makes the AI's contribution visible (§7.2/§12.1 demo north
// star #2): preferences -> a constraint set with explicit conflicts ->
// ranked, reasoned options. Session detail (GET /api/sessions/:shareToken)
// already carries consensus + options, matching P1-T2's "one call returns
// everything the UI polls for" — Aggregate/Refresh here just trigger the
// POST endpoints that produce fresher rows for the next poll tick to pick up.
export default function ConsensusView() {
  const { shareToken } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useSessionPoll(shareToken, 3000);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState(null);

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

  const { session, consensus, options, activeJob } = data;
  const organizerToken = getOrganizerToken(session.id);
  const isOrganizer = Boolean(organizerToken);
  const recommendedOption = options?.find((o) => o.recommended);

  async function runAggregate() {
    setBusy(true);
    setActionError(null);
    try {
      await apiClient.post(`/api/sessions/${shareToken}/aggregate`, {}, { organizerToken });
      await refetch();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function refreshOptions() {
    setBusy(true);
    setActionError(null);
    try {
      await apiClient.post(`/api/sessions/${shareToken}/options/refresh`, {}, { organizerToken });
      await refetch();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // The only irreversible transition in the product (§15.2) — approving the
  // recommended option enqueues a real automation job.
  async function approveBooking() {
    setBusy(true);
    setActionError(null);
    try {
      const { job } = await apiClient.post(
        `/api/sessions/${shareToken}/book`,
        { optionId: recommendedOption.id },
        { organizerToken }
      );
      navigate(`/s/${shareToken}/jobs/${job.id}`);
    } catch (err) {
      setActionError(err.message);
      setBusy(false);
    }
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 640 }}>
      <p>
        <Link to={`/s/${shareToken}/lobby`}>← Back to lobby</Link>
      </p>
      <h1>{session.title}</h1>

      {isOrganizer && (
        <div style={{ margin: '1rem 0', display: 'flex', gap: '0.5rem' }}>
          <button type="button" onClick={runAggregate} disabled={busy}>
            {consensus ? 'Re-run aggregation' : 'Run aggregation'}
          </button>
          {consensus && (
            <button type="button" onClick={refreshOptions} disabled={busy}>
              Refresh options
            </button>
          )}
        </div>
      )}
      {actionError && <p style={{ color: 'crimson' }}>{actionError}</p>}

      {!consensus && (
        <p style={{ color: '#666' }}>
          {isOrganizer
            ? 'Run aggregation once enough of the group has responded.'
            : 'Waiting for the organizer to run aggregation.'}
        </p>
      )}

      {consensus && (
        <section style={{ margin: '1rem 0', padding: '1rem', background: '#f7f7f7', borderRadius: 8 }}>
          <h2 style={{ marginTop: 0 }}>What the group agreed</h2>
          {consensus.llmUnavailable && (
            <p style={{ color: '#a15c00' }}>
              AI reconciliation was unavailable — this is a deterministic fallback (lowest budget, strict
              availability overlap).
            </p>
          )}
          {consensus.summary && <p>{consensus.summary}</p>}

          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.25rem 1rem', margin: 0 }}>
            <dt>Party size</dt>
            <dd>{consensus.constraintSet.party_size}</dd>
            <dt>Budget ceiling</dt>
            <dd>{consensus.constraintSet.max_price_per_seat ?? 'No ceiling stated'}</dd>
            <dt>Seat class</dt>
            <dd>{consensus.constraintSet.seat_class ?? 'No preference'}</dd>
            <dt>Sit together</dt>
            <dd>{consensus.constraintSet.seats_together ? 'Yes' : 'No preference'}</dd>
            <dt>Location</dt>
            <dd>{consensus.constraintSet.location ?? 'Unspecified'}</dd>
          </dl>

          {consensus.conflicts?.length > 0 && (
            <div style={{ marginTop: '0.75rem' }}>
              <strong>Conflicts</strong>
              <ul>
                {consensus.conflicts.map((c, i) => (
                  <li key={i}>{c.detail ?? JSON.stringify(c)}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {options && options.length > 0 && (
        <section>
          <h2>Ranked options</h2>
          {options.map((option) => (
            <OptionCard key={option.id} option={option} />
          ))}
        </section>
      )}

      {consensus && (!options || options.length === 0) && (
        <p style={{ color: '#666' }}>
          {isOrganizer ? 'Refresh options to fetch live showtimes.' : 'Waiting for the organizer to fetch options.'}
        </p>
      )}

      {isOrganizer && options?.some((o) => o.recommended) && (
        <div style={{ marginTop: '1.5rem', borderTop: '1px solid #ddd', paddingTop: '1rem' }}>
          <p style={{ color: '#666', fontSize: '0.9rem' }}>Organizer controls</p>
          {activeJob ? (
            <p>
              <Link to={`/s/${shareToken}/jobs/${activeJob.id}`}>
                View booking progress ({activeJob.status}) →
              </Link>
            </p>
          ) : (
            <button type="button" onClick={approveBooking} disabled={busy}>
              Approve &amp; book "{recommendedOption?.title}"
            </button>
          )}
        </div>
      )}
    </div>
  );
}
