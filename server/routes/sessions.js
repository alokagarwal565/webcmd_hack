import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { createSession, toPublicSession, getSessionDetail } from '../services/sessionService.js';
import { AppError } from '../lib/AppError.js';

export const sessionsRouter = Router();

const createSessionSchema = z.object({
  title: z.string().min(1),
  activityType: z.string().min(1).default('movie'),
  city: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

sessionsRouter.post('/sessions', validate(createSessionSchema), async (req, res, next) => {
  try {
    const { session, shareToken, organizerToken } = await createSession(req.body);
    res.status(201).json({
      session: toPublicSession(session),
      shareToken,
      organizerToken,
    });
  } catch (err) {
    next(err);
  }
});

sessionsRouter.get('/sessions/:shareToken', async (req, res, next) => {
  try {
    const detail = await getSessionDetail(req.params.shareToken);
    if (!detail) {
      throw new AppError('SESSION_NOT_FOUND', 'No session matches this link.', 404);
    }
    res.json(detail);
  } catch (err) {
    next(err);
  }
});
