import { pool } from '../db/pool.js';
import { generateToken } from '../lib/tokens.js';
import { AppError } from '../lib/AppError.js';

function toPublicParticipant(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    displayName: row.display_name,
    joinedAt: row.joined_at,
  };
}

// The projection returned by every read endpoint. organizer_token is
// deliberately absent — it is issued once, at creation, and never again
// (FR-1.2, §20.1).
export function toPublicSession(row) {
  return {
    id: row.id,
    title: row.title,
    activityType: row.activity_type,
    city: row.city,
    dateFrom: row.date_from,
    dateTo: row.date_to,
    shareToken: row.share_token,
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function createSession({ title, activityType, city, dateFrom, dateTo }) {
  const shareToken = generateToken();
  const organizerToken = generateToken();

  const { rows } = await pool.query(
    `INSERT INTO sessions (title, activity_type, city, date_from, date_to, share_token, organizer_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [title, activityType, city ?? null, dateFrom ?? null, dateTo ?? null, shareToken, organizerToken]
  );

  return { session: rows[0], shareToken, organizerToken };
}

export async function getSessionByShareToken(shareToken) {
  const { rows } = await pool.query('SELECT * FROM sessions WHERE share_token = $1', [shareToken]);
  return rows[0] ?? null;
}

// Join by link with a display name (FR-1.3/1.4). Duplicate names are allowed —
// real groups have two Rahuls — participants are distinguished by token, not name.
export async function joinSession(shareToken, displayName) {
  const session = await getSessionByShareToken(shareToken);
  if (!session) {
    throw new AppError('SESSION_NOT_FOUND', 'No session matches this link.', 404);
  }
  if (session.status === 'booked') {
    throw new AppError('INVALID_STATE', 'This session has already been booked.', 409);
  }

  const participantToken = generateToken();
  const { rows } = await pool.query(
    `INSERT INTO participants (session_id, display_name, participant_token)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [session.id, displayName, participantToken]
  );

  return { participant: toPublicParticipant(rows[0]), participantToken };
}

function toPublicConsensus(row) {
  if (!row) return null;
  return {
    constraintSet: row.constraint_set,
    conflicts: row.conflicts,
    intersection: row.intersection,
    llmProviderUsed: row.llm_provider_used,
    summary: row.summary,
    llmUnavailable: row.llm_unavailable,
    createdAt: row.created_at,
  };
}

function toPublicOption(row) {
  return {
    id: row.id,
    externalId: row.external_id,
    title: row.title,
    venue: row.venue,
    showTime: row.show_time,
    price: row.price,
    // Postgres `numeric` columns come back from `pg` as strings (to avoid
    // silent precision loss) — coerced to a real number here so the UI's
    // `typeof score === 'number'` check doesn't fail and render "—" instead
    // of the actual score.
    score: row.score !== null && row.score !== undefined ? Number(row.score) : null,
    reasoning: row.reasoning,
    rank: row.rank,
    recommended: row.rank === 1,
    disqualified: Boolean(row.raw?.disqualified),
    scoreBreakdown: row.raw?.scoreBreakdown ?? null,
  };
}

// Assembles the shape aggregationService.reconcile() expects — pure data,
// no service/adapter imports here (this file stays a repository; Branch B's
// services are pure functions of exactly this shape, per the branch split).
// timestamptz columns come back from `pg` as JS Date objects, not strings —
// converted to ISO once, at this boundary (R13), never left as Date objects
// for a service to trip over.
export async function getParticipantsForAggregation(sessionId) {
  const { rows: participants } = await pool.query(
    'SELECT id, display_name FROM participants WHERE session_id = $1 ORDER BY joined_at',
    [sessionId]
  );
  if (participants.length === 0) return [];

  const participantIds = participants.map((p) => p.id);
  const [{ rows: prefs }, { rows: windows }] = await Promise.all([
    pool.query(
      `SELECT participant_id, budget_ceiling, seat_class, seats_together, preferred_location, notes
       FROM preferences WHERE participant_id = ANY($1)`,
      [participantIds]
    ),
    pool.query(
      `SELECT aw.start_ts, aw.end_ts, pref.participant_id
       FROM availability_windows aw
       JOIN preferences pref ON pref.id = aw.preference_id
       WHERE pref.participant_id = ANY($1)`,
      [participantIds]
    ),
  ]);

  const prefByParticipant = new Map(prefs.map((p) => [p.participant_id, p]));
  const windowsByParticipant = new Map();
  for (const w of windows) {
    const list = windowsByParticipant.get(w.participant_id) ?? [];
    list.push({ start: w.start_ts.toISOString(), end: w.end_ts.toISOString() });
    windowsByParticipant.set(w.participant_id, list);
  }

  return participants.map((p) => {
    const pref = prefByParticipant.get(p.id);
    return {
      name: p.display_name,
      windows: windowsByParticipant.get(p.id) ?? [],
      preference: pref
        ? {
            budget_ceiling: pref.budget_ceiling,
            seat_class: pref.seat_class,
            seats_together: pref.seats_together,
            preferred_location: pref.preferred_location,
            notes: pref.notes,
          }
        : {},
    };
  });
}

// Persists aggregationService's reconcile() result. `pg` JSON-serializes
// plain objects/arrays passed as query parameters automatically for jsonb
// columns — no manual JSON.stringify (which would double-encode).
export async function saveConsensus(
  sessionId,
  { constraint_set, conflicts, intersection, llm_provider_used, summary, llm_unavailable }
) {
  const { rows } = await pool.query(
    `INSERT INTO consensus (session_id, constraint_set, conflicts, intersection, llm_provider_used, summary, llm_unavailable)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [sessionId, constraint_set, conflicts, intersection, llm_provider_used, summary ?? null, Boolean(llm_unavailable)]
  );
  return toPublicConsensus(rows[0]);
}

export async function getLatestConsensus(sessionId) {
  const { rows } = await pool.query(
    'SELECT * FROM consensus WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1',
    [sessionId]
  );
  return rows[0] ? toPublicConsensus(rows[0]) : null;
}

// Replaces the session's option set with a freshly scored/ranked one
// (§11.2 "refresh"). Disqualified/zero-score options are kept (rank NULL)
// rather than dropped — FR-4.3 wants every ranked option's reasoning
// visible, including why a cheaper-looking option didn't make the cut
// (P2-T8 notes: "this is what makes the AI legible to a judge, not a black
// box"). scoreBreakdown/disqualified ride inside `raw` since §10.1's OPTIONS
// table has no dedicated columns for them.
export async function saveOptions(sessionId, scoredOptions) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM options WHERE session_id = $1', [sessionId]);

    let rank = 0;
    for (const opt of scoredOptions) {
      const eligible = !opt.disqualified && opt.score > 0;
      if (eligible) rank += 1;
      await client.query(
        `INSERT INTO options (session_id, external_id, title, venue, show_time, price, raw, score, reasoning, rank)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          sessionId,
          opt.externalId,
          opt.title,
          opt.venue,
          opt.showTime,
          opt.price,
          { ...opt.raw, scoreBreakdown: opt.scoreBreakdown, disqualified: Boolean(opt.disqualified) },
          opt.score,
          opt.reasoning ?? null,
          eligible ? rank : null,
        ]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getOptions(sessionId) {
  const { rows } = await pool.query('SELECT * FROM options WHERE session_id = $1 ORDER BY rank ASC NULLS LAST', [
    sessionId,
  ]);
  return rows.map(toPublicOption);
}

function toPublicJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    optionId: row.option_id,
    status: row.status,
    currentStep: row.current_step,
    humanActionNeeded: row.human_action_needed,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Everything the lobby polls for, in one call (§9.1: the most-called endpoint).
// Assembled from a fixed small set of queries — one per related table, never
// one per participant — so cost does not grow with group size beyond a join.
export async function getSessionDetail(shareToken) {
  const session = await getSessionByShareToken(shareToken);
  if (!session) return null;

  const [participantsResult, consensusResult, optionsResult, jobResult] = await Promise.all([
    pool.query(
      `SELECT p.id, p.display_name, (pref.id IS NOT NULL) AS has_submitted
       FROM participants p
       LEFT JOIN preferences pref ON pref.participant_id = p.id
       WHERE p.session_id = $1
       ORDER BY p.joined_at`,
      [session.id]
    ),
    pool.query('SELECT * FROM consensus WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1', [
      session.id,
    ]),
    pool.query('SELECT * FROM options WHERE session_id = $1 ORDER BY rank ASC NULLS LAST', [
      session.id,
    ]),
    pool.query(
      `SELECT * FROM automation_jobs
       WHERE session_id = $1 AND status IN ('queued', 'running', 'awaiting_human')
       ORDER BY created_at DESC LIMIT 1`,
      [session.id]
    ),
  ]);

  const participants = participantsResult.rows.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    hasSubmitted: row.has_submitted,
  }));

  return {
    session: toPublicSession(session),
    participants,
    counts: {
      participants: participants.length,
      submitted: participants.filter((p) => p.hasSubmitted).length,
    },
    consensus: toPublicConsensus(consensusResult.rows[0]),
    options: optionsResult.rows.length > 0 ? optionsResult.rows.map(toPublicOption) : null,
    activeJob: toPublicJob(jobResult.rows[0]),
  };
}
