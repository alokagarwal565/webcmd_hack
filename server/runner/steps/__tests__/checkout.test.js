import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../../../db/pool.js';
import { insertJob, getJobEvents, getJobById } from '../../../services/jobService.js';
import { runCheckout } from '../checkout.js';

// runCheckout() persists via the real jobService (Neon), so these use a real
// throwaway session+job — same pattern as selectSeats.test.js — with
// synthetic listSeats/doCheckout/screenshot injected in place of the real
// webcmd/District calls, unavailable in this sandbox (see district.js's
// resolveShowArgs comment).

async function makeJob() {
  const s = await pool.query(
    `INSERT INTO sessions (title, activity_type, share_token, organizer_token)
     VALUES ('checkout test', 'movie', $1, $2) RETURNING id`,
    [`test-share-${Date.now()}-${Math.random()}`, `test-org-${Date.now()}`]
  );
  const sessionId = s.rows[0].id;
  const job = await insertJob({ sessionId, optionId: null });
  return { sessionId, job };
}

async function cleanup(sessionId) {
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
}

const option = { raw: { url: 'https://www.district.in/movies/seat-layout/fake?contentid=1' } };

test('happy path: verifies seats, screenshots twice, stores a ticket, transitions to succeeded', async () => {
  const { sessionId, job } = await makeJob();
  try {
    let screenshotCalls = 0;
    const ticket = await runCheckout(job, option, ['A1', 'A2'], {
      listSeats: async () => [{ seat: 'A1' }, { seat: 'A2' }, { seat: 'A3' }],
      doCheckout: async () => ({
        status: 'success',
        movie: 'Test Movie',
        cinema: 'Test Cinema',
        date: '2026-08-07',
        time: '19:00',
        seats: ['A1', 'A2'],
        ticketCount: 2,
        orderAmount: 500,
        bookingCharge: 20,
        total: 520,
        paymentMethod: 'upi',
        paymentState: 'pending',
        upiQrVisible: true,
        paymentAmount: 520,
        paymentUrl: 'https://pay.example/x',
        showId: 'SHOW1',
      }),
      screenshot: async () => {
        screenshotCalls++;
        return '/fake/path.png';
      },
    });

    assert.equal(screenshotCalls, 2, 'screenshots taken before and after checkout');
    assert.equal(ticket.total_amount, 520);
    assert.equal(ticket.payment_state, 'handoff_pending');
    assert.equal(ticket.booking_details.upiQrVisible, true);
    assert.deepEqual(ticket.booking_details.seats, ['A1', 'A2']);

    const job2 = await getJobById(job.id);
    assert.equal(job2.status, 'succeeded');
    assert.equal(job2.result.ticketId, ticket.id);

    const events = await getJobEvents(job.id);
    assert.ok(events.some((e) => e.message.includes('payment handoff')));
  } finally {
    await cleanup(sessionId);
  }
});

test('re-verify catches a vanished seat and throws SEATS_UNAVAILABLE before ever calling checkout', async () => {
  const { sessionId, job } = await makeJob();
  try {
    let checkoutCalled = false;
    await assert.rejects(
      () =>
        runCheckout(job, option, ['A1', 'A2'], {
          // A2 is no longer in the current listing.
          listSeats: async () => [{ seat: 'A1' }, { seat: 'A3' }],
          doCheckout: async () => {
            checkoutCalled = true;
            return {};
          },
          screenshot: async () => null,
        }),
      (err) => err.code === 'SEATS_UNAVAILABLE'
    );
    assert.equal(checkoutCalled, false, 'checkout must never run against a stale seat selection');

    const events = await getJobEvents(job.id);
    assert.ok(events.some((e) => e.level === 'error' && e.message.includes('no longer available')));
  } finally {
    await cleanup(sessionId);
  }
});

test('parses total from orderAmount when `total` is absent', async () => {
  const { sessionId, job } = await makeJob();
  try {
    const ticket = await runCheckout(job, option, ['B1'], {
      listSeats: async () => [{ seat: 'B1' }],
      doCheckout: async () => ({ orderAmount: 250 }),
      screenshot: async () => null,
    });
    assert.equal(ticket.total_amount, 250);
  } finally {
    await cleanup(sessionId);
  }
});
