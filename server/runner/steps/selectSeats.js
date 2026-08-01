import { queryDistrictSeats } from '../../adapters/booking/district.js';
import { logJobEvent } from '../../services/jobService.js';
import { AppError } from '../../lib/AppError.js';

// §18.3 — relax in a fixed order, cheapest social cost first. Rungs 0-2 are
// single attempts at the full party size; rung 3 (contiguous pairs) is
// handled separately below since it changes the shape of the request, not
// just its parameters.
const RUNGS = [
  { rung: 0, label: 'exact constraints', dropTogether: false, dropClass: false },
  { rung: 1, label: 'drop sit-together, prefer same row', dropTogether: true, dropClass: false },
  { rung: 2, label: 'widen seat class to any at or below the price ceiling', dropTogether: true, dropClass: true },
];

// Rung 4's two prohibitions are absolute (§18.3) — the product's promise to
// Arjun. Enforced here, in code, on every exit path of this function, not by
// convention and not just on the final rung.
function satisfiesAbsolutes(seats, partySize, maxPriceCeiling) {
  if (seats.length < partySize) return false;
  if (maxPriceCeiling == null) return true;
  return seats.every((s) => s.price == null || s.price <= maxPriceCeiling);
}

async function tryRung(job, option, constraintSet, rung, fetchSeats) {
  const seats = await fetchSeats(option, {
    count: constraintSet.party_size,
    maxPrice: constraintSet.max_price_per_seat,
    seatClass: rung.dropClass ? null : constraintSet.seat_class,
    together: rung.dropTogether ? false : constraintSet.seats_together,
    jobId: job.id,
  });
  return seats.slice(0, constraintSet.party_size);
}

async function tryContiguousPairs(job, option, constraintSet, fetchSeats) {
  const chosen = [];
  let remaining = constraintSet.party_size;
  while (remaining > 0) {
    const groupSize = Math.min(2, remaining);
    const seats = await fetchSeats(option, {
      count: groupSize,
      maxPrice: constraintSet.max_price_per_seat,
      seatClass: null,
      together: groupSize > 1,
      jobId: job.id,
    });
    if (seats.length < groupSize) break;
    if (!satisfiesAbsolutes(seats, groupSize, constraintSet.max_price_per_seat)) break;
    chosen.push(...seats.slice(0, groupSize));
    remaining -= groupSize;
  }
  return chosen;
}

/**
 * Turns a constraint set into chosen seat labels by walking the §18.3
 * relaxation ladder. Returns `{ seats, rungReached }` on success, where
 * `seats` is an array of seat-label strings of length === party_size.
 * Throws AppError('SEATS_UNAVAILABLE') if the ladder is exhausted.
 *
 * `fetchSeats` defaults to the real District adapter call; tests inject a
 * synthetic fetcher so the ladder's progression and the rung-4 absolutes can
 * be verified deterministically without a live browser/network dependency.
 */
export async function selectSeats(job, option, constraintSet, fetchSeats = queryDistrictSeats) {
  const partySize = constraintSet.party_size;
  const maxPrice = constraintSet.max_price_per_seat;

  for (const rung of RUNGS) {
    if (rung.rung > 0) {
      await logJobEvent(job.id, {
        step: 'select_seats',
        level: 'warn',
        message: `Relaxing constraints (rung ${rung.rung}): ${rung.label}`,
      });
    }
    const seats = await tryRung(job, option, constraintSet, rung, fetchSeats);
    if (satisfiesAbsolutes(seats, partySize, maxPrice)) {
      return { seats: seats.map((s) => s.seat), rungReached: rung.rung };
    }
  }

  await logJobEvent(job.id, {
    step: 'select_seats',
    level: 'warn',
    message: 'Relaxing constraints (rung 3): allow split into contiguous pairs',
  });
  const paired = await tryContiguousPairs(job, option, constraintSet, fetchSeats);
  if (satisfiesAbsolutes(paired, partySize, maxPrice)) {
    return { seats: paired.map((s) => s.seat), rungReached: 3 };
  }

  // Rung 4: stop. Never breach the budget ceiling. Never book fewer seats
  // than the party size. Failure is recoverable; a broken promise is not.
  await logJobEvent(job.id, {
    step: 'select_seats',
    level: 'error',
    message: `Relaxation ladder exhausted (rung 4) — no ${partySize}-seat combination satisfies the party size within the budget ceiling.`,
  });
  throw new AppError(
    'SEATS_UNAVAILABLE',
    'No seat combination satisfies the party size within budget after exhausting the relaxation ladder.',
    409
  );
}
