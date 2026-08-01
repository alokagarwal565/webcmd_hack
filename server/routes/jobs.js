import { Router } from 'express';
import { AppError } from '../lib/AppError.js';
import { getJobDetail, resumeJob, cancelJob } from '../services/jobService.js';
import { continueJob } from '../runner/index.js';
import { logger } from '../lib/logger.js';

// Mounted at /api/jobs.
export const jobsRouter = Router();

jobsRouter.get('/:id', async (req, res, next) => {
  try {
    const detail = await getJobDetail(req.params.id);
    if (!detail) {
      throw new AppError('JOB_NOT_FOUND', 'No job matches this id.', 404);
    }
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

jobsRouter.post('/:id/resume', async (req, res, next) => {
  try {
    const job = await resumeJob(req.params.id, req.headers['x-organizer-token']);
    res.json({ job });
    // Fire-and-forget: claimNextJob() only looks at `queued` jobs, so
    // without this the Runner would never notice a resumed `running` job
    // needs its next step executed. Not awaited — resume responds
    // immediately while automation continues in the background.
    continueJob(job.id).catch((err) => {
      logger.error({ event: 'runner.continue_job_error', jobId: job.id, message: err.message });
    });
  } catch (err) {
    next(err);
  }
});

jobsRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    const job = await cancelJob(req.params.id, req.headers['x-organizer-token']);
    res.json({ job });
  } catch (err) {
    next(err);
  }
});
