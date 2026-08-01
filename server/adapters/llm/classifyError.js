// server/adapters/llm/classifyError.js — the §13.4 table, implemented once
// and unit-tested exhaustively. This is the specification, not just code:
// every row of the table in the plan corresponds to a branch here.
//
// Whether a class should fail over, fail fast, or retry on the same provider
// is exported alongside the classifier so resilientCall.js never re-derives
// the policy — the table is the single source of truth for both.

export const ERROR_CLASSES = Object.freeze({
  RATE_LIMIT: 'RATE_LIMIT',
  TIMEOUT: 'TIMEOUT',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  NETWORK: 'NETWORK',
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  AUTH: 'AUTH',
  BAD_REQUEST: 'BAD_REQUEST',
});

// §13.4: these classes failover to the other provider.
export const FAILOVER_CLASSES = new Set([
  ERROR_CLASSES.RATE_LIMIT,
  ERROR_CLASSES.TIMEOUT,
  ERROR_CLASSES.PROVIDER_ERROR,
  ERROR_CLASSES.NETWORK,
  ERROR_CLASSES.MODEL_UNAVAILABLE,
]);

// §13.4: these must NEVER failover — a wrong key must be loud, not silently
// masked by the fallback provider also happening to work.
export const FAILFAST_CLASSES = new Set([ERROR_CLASSES.AUTH, ERROR_CLASSES.BAD_REQUEST]);

// §13.5: only NETWORK and PROVIDER_ERROR retry on the SAME provider before
// failing over — RATE_LIMIT/TIMEOUT/MODEL_UNAVAILABLE failover immediately,
// since retrying against the same limited/slow/unavailable provider wastes
// the scarcest demo resource: time.
export const RETRYABLE_ON_SAME_PROVIDER = new Set([
  ERROR_CLASSES.NETWORK,
  ERROR_CLASSES.PROVIDER_ERROR,
]);

const NETWORK_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET']);

/**
 * Classify a thrown error from an LLM adapter into one of the §13.4 classes.
 * Adapters never classify their own errors (P2-T2/P2-T3 notes) — they throw
 * raw provider errors, and this is the one place that inspects them.
 *
 * @param {Error & {status?: number, code?: string}} err
 * @returns {keyof typeof ERROR_CLASSES}
 */
export function classifyError(err) {
  if (!err) return ERROR_CLASSES.PROVIDER_ERROR;

  const status = err.status;
  const code = err.code || err.cause?.code;
  const message = String(err.message || '').toLowerCase();

  // AbortSignal.timeout() rejects with a DOMException named "TimeoutError".
  if (err.name === 'TimeoutError') return ERROR_CLASSES.TIMEOUT;

  // Auth misconfiguration — fail fast, never failover (§13.4's most
  // important row; see P2-T4 notes).
  if (status === 401 || status === 403) return ERROR_CLASSES.AUTH;

  if (status === 429 || message.includes('rate_limit') || message.includes('quota')) {
    return ERROR_CLASSES.RATE_LIMIT;
  }

  if (status === 400) return ERROR_CLASSES.BAD_REQUEST;

  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return ERROR_CLASSES.PROVIDER_ERROR;
  }

  if (message.includes('model_not_found') || message.includes('model overloaded') || message.includes('overloaded')) {
    return ERROR_CLASSES.MODEL_UNAVAILABLE;
  }

  if (NETWORK_CODES.has(code)) return ERROR_CLASSES.NETWORK;

  // A bare `fetch` failure (DNS, connection refused before headers) surfaces
  // as a TypeError with no HTTP status.
  if (err instanceof TypeError && message.includes('fetch')) return ERROR_CLASSES.NETWORK;

  // Unknown shape: treat as a transient provider error rather than guessing
  // AUTH — guessing wrong on the fail-fast classes is the dangerous mistake
  // (§13.4), guessing wrong on a failover-eligible class merely costs time.
  return ERROR_CLASSES.PROVIDER_ERROR;
}
