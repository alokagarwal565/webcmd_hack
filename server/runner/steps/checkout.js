// server/runner/steps/checkout.js — carries an approved booking to payment
// handoff and stores the ticket (§14.1, §18.4, §19.2, P3-T5).
import { webcmdExec } from '../../adapters/booking/webcmdExec.js';
import { resolveShowArgs } from '../../adapters/booking/district.js';
import { logJobEvent, transitionJob, createTicket } from '../../services/jobService.js';
import { captureScreenshot } from './screenshot.js';
import { AppError } from '../../lib/AppError.js';

function parseIntSafe(value) {
  if (typeof value === 'number') return Math.round(value);
  const match = String(value ?? '').match(/-?\d+/);
  return match ? Number(match[0]) : null;
}

async function listCurrentSeats(job, option) {
  const { show, extraArgs } = resolveShowArgs(option);
  return webcmdExec({
    adapter: 'district',
    command: 'seats',
    args: [show, ...extraArgs],
    browser: true,
    jobId: job.id,
    step: 'checkout',
  });
}

async function runDistrictCheckout(job, option, chosenSeats) {
  const { show, extraArgs } = resolveShowArgs(option);
  return webcmdExec({
    adapter: 'district',
    command: 'checkout',
    args: [show, ...extraArgs, '--seats', chosenSeats.join(','), '--payment', 'upi-qr', '--keep-tab', 'true'],
    browser: true,
    jobId: job.id,
    step: 'checkout',
  });
}

// §18.4 — seats are re-read immediately before checkout. Inventory can move
// in seconds on a popular show; a cheap re-read converts a stale selection
// into a clean SEATS_UNAVAILABLE rather than a confusing mid-checkout
// failure. Listing (no --count) shows current availability; any previously
// chosen label absent from that listing is treated as gone.
async function verifySeatsStillAvailable(job, chosenSeats, listSeats) {
  const rows = await listSeats();
  const currentLabels = new Set((Array.isArray(rows) ? rows : []).map((r) => r.seat).filter(Boolean));
  const missing = chosenSeats.filter((seat) => !currentLabels.has(seat));
  if (missing.length > 0) {
    await logJobEvent(job.id, {
      step: 'checkout',
      level: 'error',
      message: `Seat(s) no longer available at re-read: ${missing.join(', ')}`,
    });
    throw new AppError(
      'SEATS_UNAVAILABLE',
      `Previously selected seat(s) are no longer available: ${missing.join(', ')}`,
      409
    );
  }
}

function buildBookingDetails(checkoutResponse, chosenSeats) {
  // §14.1's documented columns, verbatim — the verified contract.
  return {
    status: checkoutResponse.status ?? null,
    movie: checkoutResponse.movie ?? null,
    cinema: checkoutResponse.cinema ?? null,
    date: checkoutResponse.date ?? null,
    time: checkoutResponse.time ?? null,
    seats: checkoutResponse.seats ?? chosenSeats,
    ticketCount: checkoutResponse.ticketCount ?? chosenSeats.length,
    orderAmount: checkoutResponse.orderAmount ?? null,
    bookingCharge: checkoutResponse.bookingCharge ?? null,
    total: checkoutResponse.total ?? null,
    paymentMethod: checkoutResponse.paymentMethod ?? null,
    paymentState: checkoutResponse.paymentState ?? null,
    upiQrVisible: checkoutResponse.upiQrVisible ?? null,
    paymentAmount: checkoutResponse.paymentAmount ?? null,
    paymentUrl: checkoutResponse.paymentUrl ?? null,
    showId: checkoutResponse.showId ?? null,
  };
}

/**
 * Runs checkout to payment handoff and stores the resulting ticket.
 * Never retried automatically (§23) — checkout is the one non-idempotent
 * operation in the system; a retry could double-book, so any failure here
 * surfaces to the human rather than being silently retried.
 *
 * `listSeats`/`doCheckout`/`screenshot` default to the real District/webcmd
 * calls; tests inject synthetic versions so the orchestration (re-verify ->
 * screenshot -> checkout -> parse -> store -> transition, and the
 * SEATS_UNAVAILABLE error path) can be verified deterministically without a
 * live browser/network dependency.
 * @param {object} job
 * @param {object} option
 * @param {string[]} chosenSeats
 */
export async function runCheckout(
  job,
  option,
  chosenSeats,
  {
    listSeats = () => listCurrentSeats(job, option),
    doCheckout = () => runDistrictCheckout(job, option, chosenSeats),
    screenshot = captureScreenshot,
  } = {}
) {
  await transitionJob(job.id, { currentStep: 'checkout' });

  await verifySeatsStillAvailable(job, chosenSeats, listSeats);

  await screenshot(job, 'checkout', 'Before checkout — seats selected, about to confirm.');

  const checkoutResponse = await doCheckout();

  await screenshot(job, 'checkout', 'After checkout — payment handoff reached.');

  const bookingDetails = buildBookingDetails(checkoutResponse, chosenSeats);
  const totalAmount = parseIntSafe(bookingDetails.total ?? bookingDetails.orderAmount);

  const ticket = await createTicket({
    sessionId: job.session_id,
    jobId: job.id,
    bookingDetails,
    totalAmount,
    paymentState: 'handoff_pending',
  });

  await logJobEvent(job.id, {
    step: 'checkout',
    level: 'info',
    message: `Checkout reached payment handoff. Seats: ${chosenSeats.join(', ')}. Total: ${totalAmount ?? 'unknown'}.`,
  });

  await transitionJob(job.id, { status: 'succeeded', currentStep: 'checkout', result: { ticketId: ticket.id } });

  return ticket;
}
