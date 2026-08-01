import { randomUUID } from 'node:crypto';

// Every response carries X-Request-Id — accepted from the caller if present,
// otherwise generated. Propagated onto req.requestId for logging (§24.4).
export function requestId(req, res, next) {
  const id = req.headers['x-request-id'] || `req_${randomUUID()}`;
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}
