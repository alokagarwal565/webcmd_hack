// server/adapters/booking/fixture.js — the offline BookingProvider (§27.3).
// Selected via BOOKING_PROVIDER=fixture. Replays captured/synthetic data
// (fixtures/showtimes.json — see that file's "_provenance" field for what
// was actually captured live vs. hand-built from verified output columns)
// instead of calling webcmd at all. This is a first-class adapter, not test
// scaffolding: it is the demo's fallback if the live site is unreachable
// during judging, and it is what the automated tests run against.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'showtimes.json');

function parsePriceFloor(priceRange) {
  if (!priceRange) return null;
  const match = String(priceRange).match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function normalizeShowtime(row) {
  return {
    externalId: row.showId ?? row.url ?? null,
    title: row.movie ?? null,
    venue: row.cinema ?? null,
    showTime: row.date && row.time ? `${row.date}T${row.time}:00` : null,
    price: parsePriceFloor(row.priceRange),
    raw: row,
  };
}

export function createFixtureAdapter() {
  return {
    name: 'fixture',

    /** @param {import('../../ports/bookingProvider.js').ConstraintSet} constraintSet */
    async searchOptions(constraintSet) {
      const data = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
      const titleFilters = (constraintSet.content_preferences ?? []).map((s) => s.toLowerCase());

      const rows = Object.entries(data)
        .filter(([key]) => key !== '_provenance')
        .filter(
          ([title]) => titleFilters.length === 0 || titleFilters.some((f) => title.toLowerCase().includes(f))
        )
        .flatMap(([, showtimes]) => showtimes);

      return rows.map(normalizeShowtime);
    },
  };
}
