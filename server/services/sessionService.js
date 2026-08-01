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
    score: row.score,
    reasoning: row.reasoning,
    rank: row.rank,
  };
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
