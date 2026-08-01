// server/services/recommendationService.js — constraint -> provider query ->
// deterministic scoring -> LLM-narrated reasoning (§17, P2-T8). Per §8.2,
// this file imports only ports (the booking registry's public functions and
// resilientCall), never a concrete adapter by name.
import { getBookingProvider } from '../adapters/booking/index.js';
import { resilientCall } from '../adapters/llm/resilientCall.js';
import { buildOptionReasoningPrompt } from '../prompts/optionReasoning.js';
import { logger } from '../lib/logger.js';

// §17.2 weights — sum to 100. The formula is code, not a model, so the same
// input always yields the same ranking (a hard requirement for a demo and
// for user trust).
const WEIGHTS = { availability: 35, budget: 30, seat: 20, content: 10, convenience: 5 };

function scoreAvailability(option, { intersection, partySize }) {
  if (!option.showTime || !intersection) return 0;
  const t = Date.parse(option.showTime);
  if (Number.isNaN(t)) return 0;

  const inWindow = (w) => t >= Date.parse(w.start) && t <= Date.parse(w.end);

  if (intersection.full_overlap?.some(inWindow)) return 100;

  const partial = intersection.partial_overlap?.find(inWindow);
  if (partial && partySize > 0) {
    return Math.round((partial.participant_count / partySize) * 100);
  }
  return 0;
}

/** @returns {{score: number, disqualified: boolean}} */
function scoreBudget(option, { maxPricePerSeat }) {
  if (typeof maxPricePerSeat !== 'number') return { score: 100, disqualified: false };
  if (typeof option.price !== 'number') return { score: 50, disqualified: false }; // unknown price: neutral, not a violation
  // Budget overrun is disqualifying rather than merely penalized (§17.2) —
  // a group that set a ceiling means it.
  if (option.price > maxPricePerSeat) return { score: 0, disqualified: true };
  const ratio = option.price / maxPricePerSeat;
  if (ratio <= 0.7) return { score: 100, disqualified: false };
  const score = Math.round(100 * (1 - (ratio - 0.7) / 0.3));
  return { score: Math.max(0, score), disqualified: false };
}

// Seat-level adjacency is only verified later, live, during actual seat
// selection (§18 — Phase 3 territory). At ranking time all that is known is
// the showtime's own `available` flag, so this dimension is a documented
// heuristic, not a promise: available -> likely bookable (100), explicitly
// sold out -> 0, unknown -> the spec's own "available but not adjacent"
// midpoint (60).
function scoreSeatViability(option) {
  if (option.raw?.available === true) return 100;
  if (option.raw?.available === false) return 0;
  return 60;
}

// District's verified showtimes output has no genre/rating field (§14.1),
// so content fit is title-keyword overlap — a weak but honest signal from
// the data actually available, not a fabricated one.
function scoreContent(option, { contentPreferences }) {
  if (!contentPreferences?.length) return 100;
  const title = (option.title ?? '').toLowerCase();
  const hits = contentPreferences.filter((term) => title.includes(String(term).toLowerCase())).length;
  return hits === 0 ? 30 : Math.min(100, 60 + hits * 20);
}

function scoreConvenience(option, { location, window }) {
  let score = 50;
  if (location && option.venue) {
    score = option.venue.toLowerCase().includes(location.toLowerCase()) ? 100 : 50;
  }
  if (window && option.showTime) {
    const t = Date.parse(option.showTime);
    const start = Date.parse(window.start);
    const end = Date.parse(window.end);
    if (!Number.isNaN(t) && !Number.isNaN(start) && !Number.isNaN(end) && end > start) {
      const position = Math.min(1, Math.max(0, (t - start) / (end - start)));
      score = Math.min(100, score + Math.round((1 - position) * 20));
    }
  }
  return score;
}

function scoreOne(option, ctx) {
  const availability = scoreAvailability(option, ctx);
  const budget = scoreBudget(option, ctx);
  const seat = scoreSeatViability(option);
  const content = scoreContent(option, ctx);
  const convenience = scoreConvenience(option, ctx);
  const breakdown = { availability, budget: budget.score, seat, content, convenience };

  if (budget.disqualified) {
    return { score: 0, disqualified: true, breakdown };
  }

  const score = Math.round(
    (breakdown.availability * WEIGHTS.availability +
      breakdown.budget * WEIGHTS.budget +
      breakdown.seat * WEIGHTS.seat +
      breakdown.content * WEIGHTS.content +
      breakdown.convenience * WEIGHTS.convenience) /
      100
  );

  return { score, disqualified: false, breakdown };
}

/**
 * Deterministic scoring + ranking (§17.2). Pure function — identical input
 * always yields identical output. No LLM call anywhere in this function.
 *
 * @param {import('../ports/bookingProvider.js').BookingOption[]} options
 * @param {{constraintSet: object, intersection: object}} ctx
 */
export function scoreOptions(options, { constraintSet, intersection }) {
  const scoringContext = {
    intersection,
    partySize: constraintSet.party_size,
    maxPricePerSeat: constraintSet.max_price_per_seat,
    contentPreferences: constraintSet.content_preferences,
    location: constraintSet.location,
    window: constraintSet.preferred_time_windows?.[0],
  };

  const scored = options.map((option) => {
    const { score, disqualified, breakdown } = scoreOne(option, scoringContext);
    return { ...option, score, disqualified, scoreBreakdown: breakdown, recommended: false };
  });

  // §17.2 — deterministic; identical input always yields identical order.
  scored.sort((a, b) => b.score - a.score || (a.disqualified ? 1 : -1));

  const top = scored.find((o) => !o.disqualified && o.score > 0);
  if (top) top.recommended = true;

  return scored;
}

/**
 * §17.4 — when nothing scores above zero, name the binding constraint and
 * the smallest relaxation that would help, rather than a bare empty list.
 */
export function identifyBindingConstraint(rawOptions, constraintSet) {
  if (rawOptions.length === 0) {
    return {
      binding: 'no_candidates',
      message: 'The booking provider returned no candidates at all for this city/content preference — try broadening either.',
    };
  }

  const priced = rawOptions.filter((o) => typeof o.price === 'number');
  const ceiling = constraintSet.max_price_per_seat;

  if (typeof ceiling === 'number' && priced.length > 0 && priced.every((o) => o.price > ceiling)) {
    const cheapest = Math.min(...priced.map((o) => o.price));
    return {
      binding: 'budget',
      message: `Every option exceeds the ₹${ceiling} per-seat ceiling. Raising it to ₹${cheapest} would open at least one option.`,
      suggestedMaxPricePerSeat: cheapest,
    };
  }

  const window = constraintSet.preferred_time_windows?.[0];
  if (window) {
    const inWindow = rawOptions.filter((o) => {
      const t = Date.parse(o.showTime);
      return !Number.isNaN(t) && t >= Date.parse(window.start) && t <= Date.parse(window.end);
    });
    if (inWindow.length === 0) {
      return {
        binding: 'availability',
        message: "No showtime falls inside the group's common availability window — widening it would open options.",
      };
    }
  }

  return {
    binding: 'unknown',
    message: 'No option satisfies the current constraints for a reason not automatically identified — review the constraint set manually.',
  };
}

function templateReasoning(option, constraintSet) {
  const bits = [];
  if (option.scoreBreakdown.budget === 100) {
    bits.push(`comfortably within the group's ₹${constraintSet.max_price_per_seat} ceiling`);
  }
  if (option.scoreBreakdown.availability === 100) bits.push("inside everyone's shared free time");
  if (option.scoreBreakdown.seat >= 60) bits.push('seats likely available');
  return bits.length
    ? `${option.title} at ${option.venue}: ${bits.join(', ')}.`
    : `${option.title} at ${option.venue}: the best available match given the group's constraints.`;
}

async function explainOption(option, constraintSet, { requestId, llmCall = resilientCall } = {}) {
  const { system, user } = buildOptionReasoningPrompt({ option, constraintSet });
  try {
    const { result } = await llmCall({ task: 'option_reasoning', mode: 'text', system, user, requestId });
    return typeof result === 'string' && result.trim() ? result.trim() : templateReasoning(option, constraintSet);
  } catch (err) {
    // §17.3 — the ranking never depends on the model; a narration failure
    // degrades to a templated sentence, never an error surfaced to the user.
    logger.warn({ event: 'recommendation.reasoning_unavailable', requestId, code: err.code, message: err.message });
    return templateReasoning(option, constraintSet);
  }
}

/**
 * The full pipeline: constraint set -> live provider options -> deterministic
 * score/rank -> per-option reasoning (LLM, with a templated fallback).
 *
 * @param {{
 *   constraintSet: object,
 *   intersection: object,
 *   requestId?: string,
 *   bookingProvider?: import('../ports/bookingProvider.js').BookingProvider,
 *   llmCall?: typeof resilientCall,
 *   reasonTopN?: number,
 * }} opts
 */
export async function recommend({
  constraintSet,
  intersection,
  requestId,
  bookingProvider = getBookingProvider(),
  llmCall = resilientCall,
  reasonTopN = 5,
} = {}) {
  const rawOptions = await bookingProvider.searchOptions(constraintSet);

  if (rawOptions.length === 0) {
    return { options: [], binding: identifyBindingConstraint(rawOptions, constraintSet) };
  }

  const scored = scoreOptions(rawOptions, { constraintSet, intersection });

  if (!scored.some((o) => !o.disqualified && o.score > 0)) {
    return { options: scored, binding: identifyBindingConstraint(rawOptions, constraintSet) };
  }

  const eligible = scored.filter((o) => !o.disqualified);
  const reasonSet = new Set(eligible.slice(0, reasonTopN));

  const withReasoning = await Promise.all(
    scored.map(async (option) => {
      if (option.disqualified) {
        return {
          ...option,
          reasoning: `Excluded — ₹${option.price} exceeds the group's ₹${constraintSet.max_price_per_seat} per-seat ceiling.`,
        };
      }
      if (!reasonSet.has(option)) return { ...option, reasoning: null };
      return { ...option, reasoning: await explainOption(option, constraintSet, { requestId, llmCall }) };
    })
  );

  return { options: withReasoning, binding: null };
}
