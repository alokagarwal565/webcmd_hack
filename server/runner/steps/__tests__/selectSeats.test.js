import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../../../db/pool.js';
import { insertJob, getJobEvents } from '../../../services/jobService.js';
import { selectSeats } from '../selectSeats.js';

// selectSeats() logs relaxation events via the real jobService (which writes
// to Neon), so these tests use a real throwaway session+job — same pattern
// as the P3-T1/P3-T3 tests — with a synthetic `fetchSeats` injected in place
// of the real District/webcmd call, so the ladder's progression and the
// rung-4 absolutes are verified deterministically without any live browser
// or network dependency (unavailable in this sandbox — `district.in`
// navigation times out here, matching Branch B's own P2-T7 finding).

async function makeJob() {
  const s = await pool.query(
    `INSERT INTO sessions (title, activity_type, share_token, organizer_token)
     VALUES ('selectSeats test', 'movie', $1, $2) RETURNING id`,
    [`test-share-${Date.now()}-${Math.random()}`, `test-org-${Date.now()}`]
  );
  const sessionId = s.rows[0].id;
  const job = await insertJob({ sessionId, optionId: null });
  return { sessionId, job };
}

async function cleanup(sessionId) {
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

const option = { raw: { url: 'https://www.district.in/movies/fake-movie-tickets-MV1' } };

test('rung 0 succeeds when the exact constraints already satisfy party size and budget', async () => {
  const { sessionId, job } = await makeJob();
  try {
    const constraintSet = { party_size: 2, max_price_per_seat: 300, seat_class: 'premium', seats_together: true };
    const fetchSeats = async () => [
      { seat: 'A1', price: 250, seatClass: 'premium' },
      { seat: 'A2', price: 250, seatClass: 'premium' },
    ];
    const result = await selectSeats(job, option, constraintSet, fetchSeats);
    assert.deepEqual(result.seats, ['A1', 'A2']);
    assert.equal(result.rungReached, 0);
  } finally {
    await cleanup(sessionId);
  }
});

test('relaxes to rung 1 when sitting together is unavailable at rung 0', async () => {
  const { sessionId, job } = await makeJob();
  try {
    const constraintSet = { party_size: 2, max_price_per_seat: 300, seat_class: 'premium', seats_together: true };
    let call = 0;
    const fetchSeats = async (_opt, params) => {
      call++;
      // Rung 0 (together requested) returns too few; rung 1 (together dropped) succeeds.
      if (params.together) return [{ seat: 'B1', price: 250, seatClass: 'premium' }];
      return [
        { seat: 'B1', price: 250, seatClass: 'premium' },
        { seat: 'C5', price: 250, seatClass: 'premium' },
      ];
    };
    const result = await selectSeats(job, option, constraintSet, fetchSeats);
    assert.equal(result.rungReached, 1);
    assert.equal(result.seats.length, 2);
    assert.ok(call >= 2);

    const events = await getJobEvents(job.id);
    assert.ok(events.some((e) => e.message.includes('rung 1')));
  } finally {
    await cleanup(sessionId);
  }
});

test('rung 4 absolute: never returns seats priced above the ceiling, even if plentiful', async () => {
  const { sessionId, job } = await makeJob();
  try {
    const constraintSet = { party_size: 2, max_price_per_seat: 200, seat_class: null, seats_together: false };
    // Always returns seats, but every one is over budget — must never be accepted.
    const fetchSeats = async () => [
      { seat: 'Z1', price: 500, seatClass: 'recliner' },
      { seat: 'Z2', price: 500, seatClass: 'recliner' },
    ];
    await assert.rejects(
      () => selectSeats(job, option, constraintSet, fetchSeats),
      (err) => err.code === 'SEATS_UNAVAILABLE'
    );

    const events = await getJobEvents(job.id);
    assert.ok(events.some((e) => e.level === 'error' && e.message.includes('rung 4')));
  } finally {
    await cleanup(sessionId);
  }
});

test('rung 4 absolute: never books fewer seats than the party size', async () => {
  const { sessionId, job } = await makeJob();
  try {
    const constraintSet = { party_size: 4, max_price_per_seat: 500, seat_class: null, seats_together: true };
    // Never returns more than 1 seat at a time, regardless of requested count —
    // even the contiguous-pairs rung (groups of 2) cannot be satisfied.
    const fetchSeats = async () => [{ seat: 'Q1', price: 100, seatClass: 'standard' }];
    await assert.rejects(
      () => selectSeats(job, option, constraintSet, fetchSeats),
      (err) => err.code === 'SEATS_UNAVAILABLE'
    );
  } finally {
    await cleanup(sessionId);
  }
});

test('rung 3 (contiguous pairs) succeeds for an odd party size via a final single seat', async () => {
  const { sessionId, job } = await makeJob();
  try {
    const constraintSet = { party_size: 3, max_price_per_seat: 300, seat_class: 'premium', seats_together: true };
    const fetchSeats = async (_opt, params) => {
      // Force every rung before 3 to fail (too few seats at any class/together combo).
      if (params.count === 3) return [{ seat: 'X1', price: 200, seatClass: 'premium' }];
      // Rung 3 requests in groups of 2 then 1 — satisfy both.
      if (params.count === 2) return [
        { seat: 'X1', price: 200, seatClass: 'premium' },
        { seat: 'X2', price: 200, seatClass: 'premium' },
      ];
      return [{ seat: 'X3', price: 200, seatClass: 'premium' }];
    };
    const result = await selectSeats(job, option, constraintSet, fetchSeats);
    assert.equal(result.rungReached, 3);
    assert.equal(result.seats.length, 3);
  } finally {
    await cleanup(sessionId);
  }
});
