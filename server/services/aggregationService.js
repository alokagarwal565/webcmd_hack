// server/services/aggregationService.js — preference reconciliation with
// deterministic clamping (§16.3, P2-T6). Per §8.2, no file under
// server/services/ may name a concrete provider or adapter — this file
// imports only resilientCall (the port-level entry point) and
// availability.js (pure arithmetic), never a concrete LLM adapter.
import { intersect } from './availability.js';
import { resilientCall } from '../adapters/llm/resilientCall.js';
import { buildAggregatePrompt, AGGREGATE_SCHEMA } from '../prompts/aggregate.js';
import { logger } from '../lib/logger.js';

// Verified against the booking adapter's documented seat-class example
// values (premium, premium xl, recliner) plus the two other classes
// District commonly exposes. A model-proposed class outside this set is
// clamped to null rather than reaching a seat-selection flag unchecked (§16.3).
const KNOWN_SEAT_CLASSES = new Set(['premium', 'premium xl', 'recliner', 'classic', 'executive']);

/**
 * The real defense against prompt injection (§12.3) and the FR-3.4
 * protective budget rule: every field the model returned is either
 * overwritten from ground truth or validated against a known-safe set.
 * Nothing here trusts a number or string the model produced.
 */
function clampConstraintSet(raw, { participants, intersection, sessionCity, organizerOverrideMaxPrice }) {
  const statedCeilings = participants
    .map((p) => p.preference?.budget_ceiling)
    .filter((v) => typeof v === 'number' && Number.isFinite(v) && v > 0);

  const maxPricePerSeat =
    typeof organizerOverrideMaxPrice === 'number'
      ? organizerOverrideMaxPrice
      : statedCeilings.length > 0
        ? Math.min(...statedCeilings)
        : null;

  // The deterministic intersection always wins over whatever the model
  // proposed — prefer full overlap, fall back to the best partial windows.
  const anchorWindows = intersection.full_overlap.length ? intersection.full_overlap : intersection.partial_overlap;
  const preferredTimeWindows = anchorWindows.map((w) => ({ start: w.start, end: w.end }));

  // Safer default: a group that wanted to sit together and didn't has a
  // worse outcome than the reverse.
  const seatsTogether = participants.some((p) => p.preference?.seats_together === true);

  const rawClass = typeof raw?.seat_class === 'string' ? raw.seat_class.trim().toLowerCase() : null;
  const seatClass = rawClass && KNOWN_SEAT_CLASSES.has(rawClass) ? rawClass : null;

  const rawLocation = typeof raw?.location === 'string' ? raw.location.trim() : '';
  const location = rawLocation || sessionCity || null;

  const contentPreferences = Array.isArray(raw?.content_preferences)
    ? raw.content_preferences.filter((v) => typeof v === 'string')
    : [];

  return {
    // Overwritten with the actual participant count — the model must not
    // guess a countable fact (§16.3).
    party_size: participants.length,
    max_price_per_seat: maxPricePerSeat,
    seat_class: seatClass,
    seats_together: seatsTogether,
    location,
    preferred_time_windows: preferredTimeWindows,
    content_preferences: contentPreferences,
  };
}

function deterministicFallback({ participants, intersection, sessionCity, organizerOverrideMaxPrice }) {
  // §16.4: if both LLM providers fail, aggregation still produces a valid
  // constraint set — lowest ceiling, strict intersection, seats_together if
  // anyone asked, seat class null, no prose summary. The product books
  // either way.
  const constraintSet = clampConstraintSet(null, {
    participants,
    intersection,
    sessionCity,
    organizerOverrideMaxPrice,
  });

  return {
    constraint_set: constraintSet,
    conflicts: [],
    summary: null,
    intersection,
    llm_unavailable: true,
    llm_provider_used: null,
  };
}

/**
 * Reconciles a session's participant preferences into a single, clamped
 * constraint set. Pure function of its inputs plus one LLM call — no
 * database access, no route wiring; callers (bookingService/routes, owned by
 * Branch A) are responsible for loading participants and persisting the
 * CONSENSUS row.
 *
 * @param {{
 *   participants: Array<{name: string, windows?: {start:string,end:string}[], preference?: object}>,
 *   sessionCity?: string,
 *   organizerOverrideMaxPrice?: number,
 *   requestId?: string,
 *   llmCall?: typeof resilientCall,
 * }} opts
 */
export async function reconcile({
  participants,
  sessionCity,
  organizerOverrideMaxPrice,
  requestId,
  llmCall = resilientCall,
} = {}) {
  if (!Array.isArray(participants) || participants.length === 0) {
    throw new Error('reconcile() requires at least one participant');
  }

  // §16.2 — deterministic, never the LLM.
  const intersection = intersect(participants.map((p) => ({ name: p.name, windows: p.windows ?? [] })));

  const { system, user } = buildAggregatePrompt({ participants, intersection, sessionCity });

  let raw;
  let providerUsed = null;
  try {
    const { result, provider } = await llmCall({
      task: 'aggregate',
      system,
      user,
      schema: AGGREGATE_SCHEMA,
      requestId,
    });
    raw = result;
    providerUsed = provider;
  } catch (err) {
    logger.warn({
      event: 'aggregation.llm_unavailable',
      requestId,
      code: err.code,
      message: err.message,
    });
    return deterministicFallback({ participants, intersection, sessionCity, organizerOverrideMaxPrice });
  }

  const constraintSet = clampConstraintSet(raw.constraint_set, {
    participants,
    intersection,
    sessionCity,
    organizerOverrideMaxPrice,
  });

  return {
    constraint_set: constraintSet,
    conflicts: Array.isArray(raw.conflicts) ? raw.conflicts : [],
    summary: typeof raw.summary === 'string' ? raw.summary : null,
    intersection,
    llm_unavailable: false,
    llm_provider_used: providerUsed,
  };
}
