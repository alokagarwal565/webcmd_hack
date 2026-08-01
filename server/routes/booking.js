import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { approveBooking } from '../services/bookingService.js';

// Mounted at /api/sessions/:shareToken/book.
export const bookingRouter = Router({ mergeParams: true });

const bookSchema = z.object({
  optionId: z.string().min(1),
});

bookingRouter.post('/', validate(bookSchema), async (req, res, next) => {
  try {
    const job = await approveBooking(
      req.params.shareToken,
      req.headers['x-organizer-token'],
      req.body.optionId
    );
    res.status(201).json({ job });
  } catch (err) {
    next(err);
  }
});
