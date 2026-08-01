import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { AppError } from '../lib/AppError.js';
import { claimNextJob } from './claim.js';
import { sweepStuckJobs, sweepExpiredHumanPauses, transitionJob, logJobEvent, getJobById } from '../services/jobService.js';
import { selectSeats } from './steps/selectSeats.js';
import { runCheckout } from './steps/checkout.js';
import { isLoggedIn, triggerLogin, detectInterstitial } from './steps/detectHumanStep.js';

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

// The real pipeline (§14.4, P3-T4/T5/T6): pre-flight login check, seat
// selection against the §18.3 ladder, then checkout to payment handoff —
// with an `awaiting_human` pause at either the login step or an OTP/CAPTCHA
// interstitial detected around checkout.
//
// Resumable by design: chosen seats are persisted to `job.result` the
// moment they're selected, so a resume — whether from the login pause or a
// checkout-time interstitial — never re-runs seat selection (which could
// pick different seats if inventory moved) and never re-does the login
// check once already past it. This is what makes `/resume` continue "from
// the paused step, not from the start" (§ P3-T6 acceptance criteria).
export async function executeJob(
  job,
  {
    checkLogin = isLoggedIn,
    doLogin = triggerLogin,
    doSelectSeats = selectSeats,
    doCheckout = runCheckout,
    checkInterstitial = detectInterstitial,
  } = {}
) {
  const option = await getOptionById(job.option_id);
  if (!option) {
    throw new AppError('VALIDATION_FAILED', `Job ${job.id} references a missing option ${job.option_id}.`, 400);
  }

  const consensus = await getLatestConsensus(job.session_id);
  if (!consensus?.constraint_set) {
    throw new AppError(
      'INVALID_STATE',
      `No consensus/constraint set found for session ${job.session_id}; run aggregation before booking.`,
      409
    );
  }

  const bookingOption = { raw: option.raw };
  const constraintSet = consensus.constraint_set;

  let chosenSeats = job.result?.chosenSeats;

  if (!chosenSeats) {
    // Only checked before anything irreversible has happened — a resume
    // that already has chosenSeats persisted is past this point.
    const loggedIn = await checkLogin(job);
    if (!loggedIn) {
      await doLogin(job);
      await transitionJob(job.id, {
        status: 'awaiting_human',
        currentStep: 'login',
        humanActionNeeded: 'Log into District in the browser window, then press Resume.',
      });
      await logJobEvent(job.id, { step: 'login', level: 'warn', message: 'Paused for District login.' });
      return;
    }

    const { seats } = await doSelectSeats(job, bookingOption, constraintSet);
    chosenSeats = seats;
    await transitionJob(job.id, { currentStep: 'select_seats', result: { chosenSeats } });
    await logJobEvent(job.id, {
      step: 'select_seats',
      level: 'info',
      message: `Seats selected: ${seats.join(', ')}`,
    });
  }

  try {
    await doCheckout(job, bookingOption, chosenSeats);
  } catch (err) {
    // Before giving up, check whether the failure is actually an OTP/CAPTCHA
    // interstitial rather than a genuine error — if so, this is a pause,
    // not a failure (§14.3: awaiting_human is a designed feature).
    const interstitial = await checkInterstitial(job);
    if (interstitial) {
      await transitionJob(job.id, {
        status: 'awaiting_human',
        currentStep: 'checkout',
        humanActionNeeded: interstitial,
        result: { chosenSeats },
      });
      await logJobEvent(job.id, { step: 'checkout', level: 'warn', message: `Paused: ${interstitial}` });
      return;
    }
    throw err;
  }
}

async function runAndHandleFailure(job) {
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

export async function tick() {
  await sweepExpiredHumanPauses();

  const job = await claimNextJob();
  if (!job) return;
  await runAndHandleFailure(job);
}

// Invoked by the resume route (§ P3-T3/P3-T6) immediately after transitioning
// a job from `awaiting_human` back to `running` — that transition happens
// outside the normal claim cycle (claimNextJob only looks at `queued` jobs),
// so without this the Runner would never notice a resumed job needs its next
// step executed. Fire-and-forget from the route; not awaited in the HTTP
// response so resume returns immediately while automation continues.
export async function continueJob(jobId) {
  const job = await getJobById(jobId);
  if (!job || job.status !== 'running') return;
  await runAndHandleFailure(job);
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
