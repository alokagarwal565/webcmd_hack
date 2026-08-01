import { pool } from '../db/pool.js';
import { AppError } from '../lib/AppError.js';

export async function getParticipantByToken(participantToken) {
  const { rows } = await pool.query('SELECT * FROM participants WHERE participant_token = $1', [
    participantToken,
  ]);
  return rows[0] ?? null;
}

// Upserts the participant's own preference row plus its availability_windows
// children. All fields are optional — an empty submission is valid and
// meaningful (FR-2.1/FR-4, the Rahul case: unconstrained, not absent).
// Windows are delete-then-insert inside one transaction — simpler and more
// correct than diffing (§ P1-T4 notes).
export async function submitPreferences(participantId, payload) {
  const {
    budgetCeiling = null,
    seatClass = null,
    seatsTogether = null,
    preferredLocation = null,
    notes = null,
    availabilityWindows = [],
  } = payload;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM preferences WHERE participant_id = $1', [
      participantId,
    ]);

    let preferenceId;
    if (existing.rows.length > 0) {
      preferenceId = existing.rows[0].id;
      await client.query(
        `UPDATE preferences
         SET budget_ceiling = $1, seat_class = $2, seats_together = $3,
             preferred_location = $4, notes = $5, availability_source = 'manual',
             updated_at = now()
         WHERE id = $6`,
        [budgetCeiling, seatClass, seatsTogether, preferredLocation, notes, preferenceId]
      );
      await client.query('DELETE FROM availability_windows WHERE preference_id = $1', [
        preferenceId,
      ]);
    } else {
      const { rows } = await client.query(
        `INSERT INTO preferences (participant_id, budget_ceiling, seat_class, seats_together,
                                   preferred_location, notes, availability_source)
         VALUES ($1, $2, $3, $4, $5, $6, 'manual')
         RETURNING id`,
        [participantId, budgetCeiling, seatClass, seatsTogether, preferredLocation, notes]
      );
      preferenceId = rows[0].id;
    }

    for (const window of availabilityWindows) {
      await client.query(
        `INSERT INTO availability_windows (preference_id, start_ts, end_ts) VALUES ($1, $2, $3)`,
        [preferenceId, window.start, window.end]
      );
    }

    await client.query('COMMIT');
    return { preferenceId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export function assertOwnParticipant(participant, session) {
  if (!participant) {
    throw new AppError('INVALID_TOKEN', 'Missing or invalid participant token.', 403);
  }
  if (participant.session_id !== session.id) {
    throw new AppError('INVALID_TOKEN', 'This token does not belong to this session.', 403);
  }
}
