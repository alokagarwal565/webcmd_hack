import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import {
  createSession,
  toPublicSession,
  getSessionDetail,
  getSessionByShareToken,
  getParticipantsForAggregation,
  saveConsensus,
  getLatestConsensus,
  saveOptions,
  getOptions,
} from '../services/sessionService.js';
import { reconcile } from '../services/aggregationService.js';
import { recommend } from '../services/recommendationService.js';
import { getTicketBySession } from '../services/jobService.js';
import { tokensMatch } from '../lib/tokens.js';
import { AppError } from '../lib/AppError.js';

export const sessionsRouter = Router();

// §21.1 rule 7: the organizer gate is server-side. Hiding the button in the
// UI is not authorization.
function assertOrganizer(req, session) {
  if (!tokensMatch(req.headers['x-organizer-token'], session.organizer_token)) {
    throw new AppError('INVALID_TOKEN', 'Missing or invalid organizer token.', 403);
  }
}

async function requireSession(shareToken) {
  const session = await getSessionByShareToken(shareToken);
  if (!session) {
    throw new AppError('SESSION_NOT_FOUND', 'No session matches this link.', 404);
  }
  return session;
}

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

// Runs deterministic availability intersection + LLM preference
// reconciliation (§16) and persists the result as a CONSENSUS row. Organizer
// only (§11.2) — aggregating is cheap to redo, but it is still an action
// taken on behalf of the whole group.
sessionsRouter.post('/sessions/:shareToken/aggregate', async (req, res, next) => {
  try {
    const session = await requireSession(req.params.shareToken);
    assertOrganizer(req, session);

    const participants = await getParticipantsForAggregation(session.id);
    if (participants.length === 0) {
      throw new AppError('INVALID_STATE', 'No participants have joined this session yet.', 409);
    }

    const result = await reconcile({
      participants,
      sessionCity: session.city,
      requestId: req.requestId,
    });

    const consensus = await saveConsensus(session.id, result);
    res.json(consensus);
  } catch (err) {
    next(err);
  }
});

// Read-only: the last computed ranked option list, public (§11.2 — the
// whole group watches, not just the organizer).
sessionsRouter.get('/sessions/:shareToken/options', async (req, res, next) => {
  try {
    const session = await requireSession(req.params.shareToken);
    const options = await getOptions(session.id);
    res.json({ options });
  } catch (err) {
    next(err);
  }
});

// Re-queries the booking provider against the latest consensus and
// re-scores/re-ranks (§17). Organizer only — this is a live network call
// against the booking site, not a free read.
sessionsRouter.post('/sessions/:shareToken/options/refresh', async (req, res, next) => {
  try {
    const session = await requireSession(req.params.shareToken);
    assertOrganizer(req, session);

    const consensus = await getLatestConsensus(session.id);
    if (!consensus) {
      throw new AppError('INVALID_STATE', 'Run /aggregate before fetching options.', 409);
    }

    const { options, binding } = await recommend({
      constraintSet: consensus.constraintSet,
      intersection: consensus.intersection,
      requestId: req.requestId,
    });

    await saveOptions(session.id, options);
    const saved = await getOptions(session.id);
    res.json({ options: saved, binding });
  } catch (err) {
    next(err);
  }
});

// Public (§11.2) — the whole group sees the stored ticket, not just the organizer.
sessionsRouter.get('/sessions/:shareToken/ticket', async (req, res, next) => {
  try {
    const session = await requireSession(req.params.shareToken);
    const ticket = await getTicketBySession(session.id);
    res.json({ ticket });
  } catch (err) {
    next(err);
  }
});
