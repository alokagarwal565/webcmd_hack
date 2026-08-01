import { Router } from 'express';
import { AppError } from '../lib/AppError.js';
import { getJobDetail, resumeJob, cancelJob } from '../services/jobService.js';

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
