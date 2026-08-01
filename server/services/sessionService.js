import { pool } from '../db/pool.js';
import { generateToken } from '../lib/tokens.js';

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
