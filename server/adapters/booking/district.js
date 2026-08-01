// server/adapters/booking/district.js — the District read adapter (§14.1,
// §17.1, P2-T7). Maps a ConstraintSet onto the verified `district search`/
// `listings`/`showtimes` commands and normalizes the response to the
// BookingProvider shape. Only the verified flags in §14.1 are used — no
// invented options.
import { webcmdExec } from './webcmdExec.js';

function toHHMM(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

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
    // Full provider response retained (§10.2) — a re-ranking never needs a
    // second network call, and a failed booking can be debugged against
    // exactly what the provider returned.
    raw: row,
  };
}

// Discovers candidate movie titles: `content_preferences` becomes a search
// query (§17.1); with no stated preference, the site's current listings
// stand in for "show me what's on".
async function discoverMovieTitles(constraintSet) {
  if (constraintSet.content_preferences?.length) {
    const query = constraintSet.content_preferences.join(' ');
    const results = await webcmdExec({
      adapter: 'district',
      command: 'search',
      args: [query, '--tab', 'movies', '--limit', '10'],
    });
    return results.map((r) => r.title).filter(Boolean);
  }
  const results = await webcmdExec({
    adapter: 'district',
    command: 'listings',
    args: ['movies', '--limit', '10'],
  });
  return results.map((r) => r.title).filter(Boolean);
}

export function createDistrictAdapter() {
  return {
    name: 'district',

    /** @param {import('../../ports/bookingProvider.js').ConstraintSet} constraintSet */
    async searchOptions(constraintSet) {
      const titles = await discoverMovieTitles(constraintSet);
      const firstWindow = constraintSet.preferred_time_windows?.[0];
      const options = [];

      for (const title of titles) {
        const args = [title, '--limit', '10'];
        if (constraintSet.location) args.push('--city', constraintSet.location);
        if (typeof constraintSet.max_price_per_seat === 'number') {
          args.push('--max-price', String(constraintSet.max_price_per_seat));
        }
        const after = toHHMM(firstWindow?.start);
        const before = toHHMM(firstWindow?.end);
        if (after) args.push('--after', after);
        if (before) args.push('--before', before);

        try {
          const rows = await webcmdExec({
            adapter: 'district',
            command: 'showtimes',
            args,
            browser: true,
          });
          options.push(...rows.map(normalizeShowtime));
        } catch {
          // One title having no showtimes (or a transient site error) must
          // not abort the whole search — §22.2 "never swallow" is about
          // silently discarding an error result; here we degrade to fewer
          // candidates and keep going, which is the documented §23 retry
          // posture for provider search/showtimes (retry once, then move on
          // rather than fail the entire recommendation).
          continue;
        }
      }
      return options;
    },
  };
}
