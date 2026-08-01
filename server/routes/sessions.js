import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { createSession, toPublicSession } from '../services/sessionService.js';

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
