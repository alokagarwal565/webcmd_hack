import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../../db/pool.js';
import { insertJob, getJobById } from '../../services/jobService.js';
import { tick } from '../index.js';

async function makeSession() {
  const s = await pool.query(
    `INSERT INTO sessions (title, activity_type, share_token, organizer_token)
     VALUES ('runner tick test', 'movie', $1, $2) RETURNING id`,
    [`test-share-${Date.now()}-${Math.random()}`, `test-org-${Date.now()}`]
  );
  return s.rows[0].id;
}

async function cleanup(sessionId) {
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

test('a job whose option is missing fails immediately (not stuck in running for 10 minutes)', async () => {
  const sessionId = await makeSession();
  try {
    const job = await insertJob({ sessionId, optionId: null });
    await tick();

    const after = await getJobById(job.id);
    assert.equal(after.status, 'failed');
    assert.equal(after.error_code, 'VALIDATION_FAILED');
    assert.ok(after.error_message.includes('missing option'));
  } finally {
    await cleanup(sessionId);
  }
});

test('a job with an option but no consensus fails with INVALID_STATE, not stuck', async () => {
  const sessionId = await makeSession();
  try {
    const opt = await pool.query(
      `INSERT INTO options (session_id, external_id, title, venue, price) VALUES ($1,'ext','Movie','Cinema',300) RETURNING id`,
      [sessionId]
    );
    const job = await insertJob({ sessionId, optionId: opt.rows[0].id });
    await tick();

    const after = await getJobById(job.id);
    assert.equal(after.status, 'failed');
    assert.equal(after.error_code, 'INVALID_STATE');
    assert.ok(after.error_message.includes('consensus'));
  } finally {
    await cleanup(sessionId);
  }
});
