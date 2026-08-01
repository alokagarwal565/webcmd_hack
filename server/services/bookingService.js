import { pool } from '../db/pool.js';
import { AppError } from '../lib/AppError.js';
import { getSessionByShareToken, assertOrganizer } from './sessionService.js';
import { insertJob } from './jobService.js';

async function getActiveJob(sessionId) {
  const { rows } = await pool.query(
    `SELECT * FROM automation_jobs
     WHERE session_id = $1 AND status IN ('queued', 'running', 'awaiting_human')
     LIMIT 1`,
    [sessionId]
  );
  return rows[0] ?? null;
}

async function getOptionForSession(optionId, sessionId) {
  const { rows } = await pool.query('SELECT * FROM options WHERE id = $1 AND session_id = $2', [
    optionId,
    sessionId,
  ]);
  return rows[0] ?? null;
}

// The only irreversible transition in the product (§15.2). Hiding the
// approve button client-side is not authorization — the organizer token is
// checked here, server-side (§21.1 rule 7).
export async function approveBooking(shareToken, organizerToken, optionId) {
  const session = await getSessionByShareToken(shareToken);
  if (!session) {
    throw new AppError('SESSION_NOT_FOUND', 'No session matches this link.', 404);
  }

  assertOrganizer(session, organizerToken);

  if (session.status === 'booked') {
    throw new AppError('INVALID_STATE', 'This session has already been booked.', 409);
  }

  const activeJob = await getActiveJob(session.id);
  if (activeJob) {
    throw new AppError('INVALID_STATE', 'A booking job is already active for this session.', 409);
  }

  const option = await getOptionForSession(optionId, session.id);
  if (!option) {
    throw new AppError('VALIDATION_FAILED', 'optionId does not belong to this session.', 400);
  }

  const job = await insertJob({ sessionId: session.id, optionId: option.id });
  await pool.query(`UPDATE sessions SET status = 'booking' WHERE id = $1`, [session.id]);

  return job;
}
