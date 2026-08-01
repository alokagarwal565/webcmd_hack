import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { AppError } from '../lib/AppError.js';
import { getSessionById, assertOrganizer } from './sessionService.js';

const STUCK_THRESHOLD_MINUTES = 10;

export async function insertJob({ sessionId, optionId }) {
  const { rows } = await pool.query(
    `INSERT INTO automation_jobs (session_id, option_id, status)
     VALUES ($1, $2, 'queued')
     RETURNING *`,
    [sessionId, optionId]
  );
  return rows[0];
}

export async function getJobById(jobId) {
  const { rows } = await pool.query('SELECT * FROM automation_jobs WHERE id = $1', [jobId]);
  return rows[0] ?? null;
}

// Follows the §14.3 state machine. Every transition writes a job_events row
// and a job.transition log line — this IS the live progress the UI polls for.
export async function transitionJob(jobId, { status, currentStep, humanActionNeeded, errorCode, errorMessage, result }) {
  const before = await getJobById(jobId);
  const fromStatus = before?.status ?? 'unknown';

  const { rows } = await pool.query(
    `UPDATE automation_jobs
     SET status = COALESCE($2, status),
         current_step = COALESCE($3, current_step),
         human_action_needed = $4,
         error_code = $5,
         error_message = $6,
         result = COALESCE($7, result),
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      jobId,
      status ?? null,
      currentStep ?? null,
      humanActionNeeded ?? null,
      errorCode ?? null,
      errorMessage ?? null,
      result ?? null,
    ]
  );
  const after = rows[0];

  logger.info({ event: 'job.transition', jobId, from: fromStatus, to: after.status, reason: currentStep });
  return after;
}

export async function logJobEvent(jobId, { step, level = 'info', message, screenshotPath }) {
  await pool.query(
    `INSERT INTO job_events (job_id, step, level, message, screenshot_path)
     VALUES ($1, $2, $3, $4, $5)`,
    [jobId, step ?? null, level, message ?? null, screenshotPath ?? null]
  );
}

export async function getJobEvents(jobId) {
  const { rows } = await pool.query(
    'SELECT * FROM job_events WHERE job_id = $1 ORDER BY created_at',
    [jobId]
  );
  return rows;
}

// GET is public — the whole group watches a job's progress (§ P3-T3 notes).
export async function getJobDetail(jobId) {
  const job = await getJobById(jobId);
  if (!job) return null;
  const events = await getJobEvents(jobId);
  return { job, events };
}

async function assertOrganizerForJob(job, organizerToken) {
  const session = await getSessionById(job.session_id);
  assertOrganizer(session, organizerToken);
}

// resume/cancel are organizer-only mutations (§ P3-T3 notes) — GET is public.
export async function resumeJob(jobId, organizerToken) {
  const job = await getJobById(jobId);
  if (!job) {
    throw new AppError('JOB_NOT_FOUND', 'No job matches this id.', 404);
  }
  await assertOrganizerForJob(job, organizerToken);

  if (job.status !== 'awaiting_human') {
    throw new AppError('INVALID_STATE', 'Only a job awaiting a human step can be resumed.', 409);
  }

  const updated = await transitionJob(jobId, { status: 'running', humanActionNeeded: null });
  await logJobEvent(jobId, { step: job.current_step, level: 'info', message: 'Resumed by organizer' });
  return updated;
}

export async function cancelJob(jobId, organizerToken) {
  const job = await getJobById(jobId);
  if (!job) {
    throw new AppError('JOB_NOT_FOUND', 'No job matches this id.', 404);
  }
  await assertOrganizerForJob(job, organizerToken);

  if (!['queued', 'running', 'awaiting_human'].includes(job.status)) {
    throw new AppError('INVALID_STATE', 'Only an active job can be cancelled.', 409);
  }

  const updated = await transitionJob(jobId, { status: 'cancelled', humanActionNeeded: null });
  await logJobEvent(jobId, { step: job.current_step, level: 'info', message: 'Cancelled by organizer' });
  return updated;
}

// §14.6 recovery: a job stuck `running` past this threshold means the Runner
// that claimed it is presumed dead (crash, kill -9). Without this sweep, one
// crash wedges the single-job queue permanently — every later approval would
// silently do nothing, forever, because claimNextJob()'s NOT EXISTS guard
// would always see a phantom "running" row.
export async function sweepStuckJobs() {
  const { rows } = await pool.query(
    `UPDATE automation_jobs
     SET status = 'failed',
         error_code = 'RUNTIME_UNAVAILABLE',
         error_message = 'Runner did not report back within the stuck-job threshold; presumed crashed.',
         updated_at = now()
     WHERE status = 'running'
       AND updated_at < now() - interval '${STUCK_THRESHOLD_MINUTES} minutes'
     RETURNING *`
  );
  for (const job of rows) {
    await logJobEvent(job.id, {
      step: job.current_step,
      level: 'error',
      message: 'Marked failed by startup sweep — stuck in running past the threshold.',
    });
    logger.warn({ event: 'job.transition', jobId: job.id, from: 'running', to: 'failed', reason: 'stuck_sweep' });
  }
  return rows;
}
