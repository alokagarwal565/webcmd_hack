import { logger } from '../lib/logger.js';
import { claimNextJob } from './claim.js';
import { sweepStuckJobs, transitionJob, logJobEvent } from '../services/jobService.js';

const POLL_INTERVAL_MS = 2000;

// Placeholder execution step — replaced by the real seat-selection/checkout
// pipeline in P3-T4/T5/T6. Exists now so P3-T1's claim → run → free-the-queue
// cycle is independently testable before any webcmd automation exists.
async function executeJob(job) {
  await logJobEvent(job.id, {
    step: 'placeholder',
    level: 'info',
    message: 'No execution steps wired yet (arrives in P3-T4/T5/T6).',
  });
  await transitionJob(job.id, { status: 'succeeded', currentStep: 'placeholder' });
}

async function tick() {
  const job = await claimNextJob();
  if (!job) return;
  await executeJob(job);
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
