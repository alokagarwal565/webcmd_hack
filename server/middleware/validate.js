import { AppError } from '../lib/AppError.js';

// One boundary validator for every POST/PUT route (§21.1 rule 4). Zod's
// .strict() rejects unknown fields rather than silently stripping them —
// a request with a field the schema doesn't expect is a client bug worth
// surfacing, not swallowing.
export function validate(schema) {
  const strictSchema = typeof schema.strict === 'function' ? schema.strict() : schema;

  return (req, res, next) => {
    const result = strictSchema.safeParse(req.body);
    if (!result.success) {
      const firstIssue = result.error.issues[0];
      const field = firstIssue.path.join('.') || '(body)';
      const message =
        firstIssue.code === 'unrecognized_keys'
          ? `Unknown field: ${firstIssue.keys?.join(', ') || field}`
          : `${field}: ${firstIssue.message}`;
      return next(new AppError('VALIDATION_FAILED', message, 400));
    }
    req.body = result.data;
    next();
  };
}
