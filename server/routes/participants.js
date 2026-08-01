import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { joinSession } from '../services/sessionService.js';

// Mounted at /api/sessions/:shareToken/participants — mergeParams gives
// access to :shareToken from the parent mount point.
export const participantsRouter = Router({ mergeParams: true });

const joinSchema = z.object({
  displayName: z.string().trim().min(1),
});

participantsRouter.post('/', validate(joinSchema), async (req, res, next) => {
  try {
    const { participant, participantToken } = await joinSession(
      req.params.shareToken,
      req.body.displayName
    );
    res.status(201).json({ participant, participantToken });
  } catch (err) {
    next(err);
  }
});
