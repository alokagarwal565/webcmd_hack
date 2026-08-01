import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { AppError } from '../lib/AppError.js';
import { claimNextJob } from './claim.js';
import { sweepStuckJobs, transitionJob, logJobEvent } from '../services/jobService.js';
import { selectSeats } from './steps/selectSeats.js';
import { runCheckout } from './steps/checkout.js';

const POLL_INTERVAL_MS = 2000;

async function getOptionById(optionId) {
  const { rows } = await pool.query('SELECT * FROM options WHERE id = $1', [optionId]);
  return rows[0] ?? null;
}

async function getLatestConsensus(sessionId) {
  const { rows } = await pool.query(
    'SELECT * FROM consensus WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1',
    [sessionId]
  );
  return rows[0] ?? null;
}

// The real pipeline: fetch the approved option + the group's constraint set,
// select seats against the §18.3 ladder, then carry to checkout (§14.4).
// P3-T6 wraps this with the whoami/login check and OTP/CAPTCHA detection
// (the `awaiting_human` pause) — not yet present here.
async function executeJob(job) {
  const option = await getOptionById(job.option_id);
  if (!option) {
    throw new AppError('VALIDATION_FAILED', `Job ${job.id} references a missing option ${job.option_id}.`, 400);
  }

  const consensus = await getLatestConsensus(job.session_id);
  if (!consensus?.constraint_set) {
    // A real product-flow gap, not a webcmd/automation failure: no
    // aggregation has run for this session yet, so there is no constraint
    // set to book against. Fails clearly rather than fabricating one.
    throw new AppError(
      'INVALID_STATE',
      `No consensus/constraint set found for session ${job.session_id}; run aggregation before booking.`,
      409
    );
  }

  const bookingOption = { raw: option.raw };
  const constraintSet = consensus.constraint_set;

  const { seats } = await selectSeats(job, bookingOption, constraintSet);
  await logJobEvent(job.id, {
    step: 'select_seats',
    level: 'info',
    message: `Seats selected: ${seats.join(', ')}`,
  });

  await runCheckout(job, bookingOption, seats);
}

export async function tick() {
  const job = await claimNextJob();
  if (!job) return;

  try {
    await executeJob(job);
  } catch (err) {
    // A thrown step must not leave the job stuck in `running` until the
    // 10-minute stuck-sweep catches it — classified failures (SEATS_
    // UNAVAILABLE, ADAPTER_MISMATCH, etc.) surface to the human immediately.
    const code = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
    const message = err.message || 'Unclassified automation failure.';
    await logJobEvent(job.id, { step: job.current_step, level: 'error', message });
    await transitionJob(job.id, { status: 'failed', errorCode: code, errorMessage: message });
    logger.error({ event: 'runner.job_failed', jobId: job.id, code, message });
  }
}

// Started in-process from server/index.js for now (§ P3-T1 notes) — Phase 5
// extracts this loop unchanged into a standalone Runner process that reaches
// the same automation_jobs table over HTTPS instead of a local `pg` pool.
export async function startRunner() {
  const stuck = await sweepStuckJobs();
  if (stuck.length > 0) {
    logger.warn({ event: 'runner.startup_sweep', failedCount: stuck.length });
  }

  const intervalId = setInterval(() => {
    // A bad job must never kill the Runner (§ notes) — every tick is
    // independently guarded so one thrown error just gets logged and the
    // loop keeps polling.
    tick().catch((err) => {
      logger.error({ event: 'runner.tick_error', message: err.message, stack: err.stack });
    });
  }, POLL_INTERVAL_MS);

  return () => clearInterval(intervalId);
}
