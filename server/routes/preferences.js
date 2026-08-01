import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { getSessionByShareToken } from '../services/sessionService.js';
import {
  getParticipantByToken,
  submitPreferences,
  getOwnPreferences,
  assertOwnParticipant,
} from '../services/preferenceService.js';
import { AppError } from '../lib/AppError.js';

// Mounted at /api/sessions/:shareToken/preferences.
export const preferencesRouter = Router({ mergeParams: true });

const windowSchema = z.object({
  start: z.string(),
  end: z.string(),
});

// .strict() is applied to the base object BEFORE .superRefine() — superRefine
// wraps the schema in ZodEffects, which has no .strict() of its own, so
// validate() (which calls .strict() defensively) would silently skip unknown-
// field rejection here otherwise (§21.1: every POST/PUT route rejects them).
const preferencesSchema = z
  .object({
    budgetCeiling: z.number().int().positive().optional(),
    seatClass: z.string().optional(),
    seatsTogether: z.boolean().optional(),
    preferredLocation: z.string().optional(),
    notes: z.string().optional(),
    availabilityWindows: z.array(windowSchema).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    (data.availabilityWindows ?? []).forEach((window, index) => {
      const start = new Date(window.start);
      const end = new Date(window.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        ctx.addIssue({
          code: 'custom',
          path: ['availabilityWindows', index],
          message: 'start/end must be valid dates',
        });
      } else if (end.getTime() <= start.getTime()) {
        ctx.addIssue({
          code: 'custom',
          path: ['availabilityWindows', index],
          message: 'end must be after start',
        });
      }
    });
  });

preferencesRouter.put('/', validate(preferencesSchema), async (req, res, next) => {
  try {
    const session = await getSessionByShareToken(req.params.shareToken);
    if (!session) {
      throw new AppError('SESSION_NOT_FOUND', 'No session matches this link.', 404);
    }

    const participant = await getParticipantByToken(req.headers['x-participant-token']);
    assertOwnParticipant(participant, session);

    const windows = (req.body.availabilityWindows ?? []).map((w) => ({
      start: new Date(w.start).toISOString(),
      end: new Date(w.end).toISOString(),
    }));

    await submitPreferences(participant.id, { ...req.body, availabilityWindows: windows });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

preferencesRouter.get('/', async (req, res, next) => {
  try {
    const session = await getSessionByShareToken(req.params.shareToken);
    if (!session) {
      throw new AppError('SESSION_NOT_FOUND', 'No session matches this link.', 404);
    }

    const participant = await getParticipantByToken(req.headers['x-participant-token']);
    assertOwnParticipant(participant, session);

    const preferences = await getOwnPreferences(participant.id);
    res.json({ preferences });
  } catch (err) {
    next(err);
  }
});
