import { pool } from '../db/pool.js';
import { logger } from '../lib/logger.js';
import { logJobEvent } from '../services/jobService.js';

// §14.5 — the exact single-claim query, verbatim. FOR UPDATE SKIP LOCKED
// makes this safe even if a second Runner is accidentally started; the
// NOT EXISTS guard is what makes "exactly one job at a time" hold even
// across two Runner processes racing this same query — the classic Postgres
// queue pattern, and the reason no Redis or queue broker is needed.
export async function claimNextJob() {
  const { rows } = await pool.query(
    `UPDATE automation_jobs SET status='running', updated_at=now()
     WHERE id = (
       SELECT id FROM automation_jobs
       WHERE status='queued'
         AND NOT EXISTS (SELECT 1 FROM automation_jobs WHERE status IN ('running','awaiting_human'))
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING *`
  );
  const job = rows[0] ?? null;
  if (job) {
    await logJobEvent(job.id, { step: job.current_step, level: 'info', message: 'Job claimed by runner' });
    logger.info({ event: 'job.transition', jobId: job.id, from: 'queued', to: 'running' });
  }
  return job;
}
