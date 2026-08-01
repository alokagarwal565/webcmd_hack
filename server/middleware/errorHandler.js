import { logger } from '../lib/logger.js';
import { AppError } from '../lib/AppError.js';

// Turns any thrown error into the §11.1/§22.1 envelope. Unclassified errors
// become INTERNAL_ERROR/500 with a safe message — the stack trace goes only
// to the log, keyed by requestId (§21.1 rule 6: no stack traces to clients).
export function errorHandler(err, req, res, next) {
  const isAppError = err instanceof AppError;
  const code = isAppError ? err.code : 'INTERNAL_ERROR';
  const httpStatus = isAppError ? err.httpStatus : 500;
  const message = isAppError ? err.message : 'An unexpected error occurred.';

  logger.error({
    event: 'error',
    requestId: req.requestId,
    code,
    message: err.message,
    stack: err.stack,
  });

  res.status(httpStatus).json({ error: { code, message } });
}
