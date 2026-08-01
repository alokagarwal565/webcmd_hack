import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../../db/pool.js';
import { insertJob, getJobById, sweepExpiredHumanPauses } from '../../services/jobService.js';
import { tick, executeJob, continueJob } from '../index.js';

async function makeSession() {
  const s = await pool.query(
    `INSERT INTO sessions (title, activity_type, share_token, organizer_token)
     VALUES ('runner tick test', 'movie', $1, $2) RETURNING id`,
    [`test-share-${Date.now()}-${Math.random()}`, `test-org-${Date.now()}`]
  );
  return s.rows[0].id;
}

async function makeSessionWithOptionAndConsensus(constraintSet) {
  const sessionId = await makeSession();
  const opt = await pool.query(
    `INSERT INTO options (session_id, external_id, title, venue, price) VALUES ($1,'ext','Movie','Cinema',300) RETURNING id`,
    [sessionId]
  );
  await pool.query(`INSERT INTO consensus (session_id, constraint_set) VALUES ($1, $2)`, [
    sessionId,
    JSON.stringify(constraintSet),
  ]);
  return { sessionId, optionId: opt.rows[0].id };
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

const constraintSet = { party_size: 2, max_price_per_seat: 300, seat_class: null, seats_together: false };

test('not logged in -> pauses awaiting_human at the login step, never selects seats', async () => {
  const { sessionId, optionId } = await makeSessionWithOptionAndConsensus(constraintSet);
  try {
    const job = await insertJob({ sessionId, optionId });
    let loginTriggered = false;
    let selectSeatsCalled = false;

    await executeJob(job, {
      checkLogin: async () => false,
      doLogin: async () => {
        loginTriggered = true;
      },
      doSelectSeats: async () => {
        selectSeatsCalled = true;
        return { seats: ['X1', 'X2'] };
      },
    });

    assert.equal(loginTriggered, true);
    assert.equal(selectSeatsCalled, false, 'must not select seats before login is confirmed');

    const after = await getJobById(job.id);
    assert.equal(after.status, 'awaiting_human');
    assert.equal(after.current_step, 'login');
    assert.ok(after.human_action_needed.includes('Log into District'));
  } finally {
    await cleanup(sessionId);
  }
});

test('resume with chosenSeats already persisted skips login check and seat selection entirely', async () => {
  const { sessionId, optionId } = await makeSessionWithOptionAndConsensus(constraintSet);
  try {
    const job = await insertJob({ sessionId, optionId });
    // Simulate a job that already picked seats before an earlier pause.
    await pool.query('UPDATE automation_jobs SET result = $2 WHERE id = $1', [
      job.id,
      JSON.stringify({ chosenSeats: ['A1', 'A2'] }),
    ]);
    const resumedJob = await getJobById(job.id);

    let checkLoginCalled = false;
    let selectSeatsCalled = false;
    let checkoutSeats = null;

    await executeJob(resumedJob, {
      checkLogin: async () => {
        checkLoginCalled = true;
        return true;
      },
      doSelectSeats: async () => {
        selectSeatsCalled = true;
        return { seats: ['Z9'] };
      },
      doCheckout: async (_job, _option, seats) => {
        checkoutSeats = seats;
      },
    });

    assert.equal(checkLoginCalled, false, 'must not re-check login once already past it');
    assert.equal(selectSeatsCalled, false, 'must not re-select seats — could pick different ones');
    assert.deepEqual(checkoutSeats, ['A1', 'A2'], 'checkout must use the originally chosen seats');
  } finally {
    await cleanup(sessionId);
  }
});

test('an OTP/CAPTCHA interstitial during checkout pauses awaiting_human, preserving chosen seats', async () => {
  const { sessionId, optionId } = await makeSessionWithOptionAndConsensus(constraintSet);
  try {
    const job = await insertJob({ sessionId, optionId });

    await executeJob(job, {
      checkLogin: async () => true,
      doSelectSeats: async () => ({ seats: ['B1', 'B2'] }),
      doCheckout: async () => {
        throw new Error('checkout timed out waiting for the next element');
      },
      checkInterstitial: async () => 'Enter the OTP shown in the browser window, then press Resume.',
    });

    const after = await getJobById(job.id);
    assert.equal(after.status, 'awaiting_human');
    assert.equal(after.current_step, 'checkout');
    assert.ok(after.human_action_needed.includes('OTP'));
    assert.deepEqual(after.result.chosenSeats, ['B1', 'B2']);
  } finally {
    await cleanup(sessionId);
  }
});

test('a genuine checkout failure (no interstitial detected) propagates rather than pausing', async () => {
  const { sessionId, optionId } = await makeSessionWithOptionAndConsensus(constraintSet);
  try {
    const job = await insertJob({ sessionId, optionId });

    await assert.rejects(
      () =>
        executeJob(job, {
          checkLogin: async () => true,
          doSelectSeats: async () => ({ seats: ['C1', 'C2'] }),
          doCheckout: async () => {
            throw new Error('genuinely broken');
          },
          checkInterstitial: async () => null,
        }),
      /genuinely broken/
    );
  } finally {
    await cleanup(sessionId);
  }
});

test('sweepExpiredHumanPauses cancels an awaiting_human job stuck past the timeout', async () => {
  const sessionId = await makeSession();
  try {
    const job = await insertJob({ sessionId, optionId: null });
    await pool.query(
      `UPDATE automation_jobs SET status='awaiting_human', human_action_needed='waiting', updated_at = now() - interval '11 minutes' WHERE id = $1`,
      [job.id]
    );

    const swept = await sweepExpiredHumanPauses();
    assert.equal(swept.length, 1);
    assert.equal(swept[0].id, job.id);

    const after = await getJobById(job.id);
    assert.equal(after.status, 'cancelled');
    assert.equal(after.human_action_needed, null);
  } finally {
    await cleanup(sessionId);
  }
});

test('continueJob is a no-op when the job is not in running state', async () => {
  const sessionId = await makeSession();
  try {
    const job = await insertJob({ sessionId, optionId: null }); // status: queued
    await continueJob(job.id); // should not throw, should not touch the job
    const after = await getJobById(job.id);
    assert.equal(after.status, 'queued');
  } finally {
    await cleanup(sessionId);
  }
});
