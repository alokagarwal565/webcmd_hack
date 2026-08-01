import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { apiClient } from '../lib/apiClient.js';
import { useSessionPoll } from '../hooks/useSessionPoll.js';
import { getOrganizerToken } from '../lib/storage.js';
import OptionCard from '../components/OptionCard.jsx';
import {
  PageShell,
  Card,
  Button,
  Badge,
  StatCard,
  EmptyState,
  Spinner,
  AIProcessingState,
} from '../components/ui/index.js';
import './ConsensusView.css';

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
    return (
      <PageShell maxWidth="md">
        <div className="consensus-loading">
          <Spinner />
        </div>
      </PageShell>
    );
  }
  if (error && !data) {
    return (
      <PageShell maxWidth="md">
        <Card>
          <p className="form-error">{error}</p>
        </Card>
      </PageShell>
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
    <PageShell maxWidth="md" back={{ to: `/s/${shareToken}/lobby`, label: 'Back to lobby' }}>
      <h1>{session.title}</h1>

      {isOrganizer && (
        <div className="consensus-actions">
          <Button variant="primary" onClick={runAggregate} loading={busy}>
            {consensus ? 'Re-run aggregation' : 'Run aggregation'}
          </Button>
          {consensus && (
            <Button variant="secondary" onClick={refreshOptions} loading={busy}>
              Refresh options
            </Button>
          )}
        </div>
      )}

      <AIProcessingState active={busy} />
      {actionError && <p className="form-error">{actionError}</p>}

      {!consensus && (
        <EmptyState
          title="No recommendations yet"
          description={
            isOrganizer
              ? 'Run aggregation once enough of the group has responded.'
              : 'Waiting for the organizer to run aggregation.'
          }
        />
      )}

      {consensus && (
        <Card className="consensus-card">
          <h2>What the group agreed</h2>
          {consensus.llmUnavailable && (
            <Badge tone="warning">AI reconciliation unavailable — deterministic fallback used</Badge>
          )}
          {consensus.summary && <p className="consensus-summary">{consensus.summary}</p>}

          <div className="ui-stat-grid consensus-stat-grid">
            <StatCard label="Party size" value={consensus.constraintSet.party_size} />
            <StatCard
              label="Budget ceiling"
              value={consensus.constraintSet.max_price_per_seat ?? 'No ceiling stated'}
            />
            <StatCard label="Seat class" value={consensus.constraintSet.seat_class ?? 'No preference'} />
            <StatCard label="Sit together" value={consensus.constraintSet.seats_together ? 'Yes' : 'No preference'} />
            <StatCard label="Location" value={consensus.constraintSet.location ?? 'Unspecified'} />
          </div>

          {consensus.conflicts?.length > 0 && (
            <div className="consensus-conflicts">
              <Badge tone="danger" size="sm">
                Conflicts
              </Badge>
              <ul>
                {consensus.conflicts.map((c, i) => (
                  <li key={i}>{c.detail ?? JSON.stringify(c)}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {options && options.length > 0 && (
        <section className="consensus-options">
          <h2>Ranked options</h2>
          <div className="consensus-options-list">
            {options.map((option) => (
              <OptionCard key={option.id} option={option} />
            ))}
          </div>
        </section>
      )}

      {consensus && (!options || options.length === 0) && (
        <EmptyState
          title="No options yet"
          description={
            isOrganizer ? 'Refresh options to fetch live showtimes.' : 'Waiting for the organizer to fetch options.'
          }
        />
      )}

      {isOrganizer && options?.some((o) => o.recommended) && (
        <Card variant="muted" className="organizer-controls">
          <Badge tone="neutral" size="sm">
            Organizer controls
          </Badge>
          {activeJob ? (
            <p>
              <Link to={`/s/${shareToken}/jobs/${activeJob.id}`}>
                View booking progress ({activeJob.status}) →
              </Link>
            </p>
          ) : (
            <Button variant="primary" onClick={approveBooking} loading={busy}>
              Approve &amp; book "{recommendedOption?.title}"
            </Button>
          )}
        </Card>
      )}
    </PageShell>
  );
}
