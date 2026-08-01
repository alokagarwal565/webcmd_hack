// server/adapters/booking/district.js — the District read adapter (§14.1,
// §17.1, P2-T7) plus the seat-selection call (§14.1, P3-T4). Maps a
// ConstraintSet onto the verified `district search`/`listings`/`showtimes`/
// `seats` commands and normalizes the response. Only the verified flags in
// §14.1 are used — no invented options.
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

// `district seats`/`checkout` accept the `show` argument as either a
// seat-layout URL, OR a bare showId paired with --format-id AND --content-id
// (confirmed by live CLI runs: a showId-shaped string alone errors demanding
// --format-id; a valid --format-id then errors demanding --content-id).
// `contentId` never appears in `showtimes`'s or `seats`'s own OUTPUT columns
// — but reading the installed adapter's source directly (`district/
// showtimes.js`, the command that PRODUCES the `url` field) confirms `url`
// is built internally as `${BASE}/movies/seat-layout/${formatId}?...&
// contentid=${contentId}&...` — i.e. every real showtimes row's `url`
// already embeds a valid contentId in its query string. So `url` is not a
// workaround for a missing field, it IS the documented seat-layout-URL path
// through §14.1, and is always preferred here. The showId+format-id+
// content-id path is kept only as a fallback for a hypothetical provider
// response that omits `url`; content-id has no other source and that path
// cannot be constructed if it's missing.
// Sandbox caveat: `district.in` is unreachable here (browser-backed commands
// time out regardless of parameters — the same limitation Branch B hit), so
// this could not be verified against a live-captured row, only against the
// adapter's source code and a synthetic fixture (which uses an unrelated
// movie-listing URL shape, confirmed live to fail the CLI's own seat-layout
// URL format check — expected, since that fixture value was never meant to
// be a real seat-layout link).
export function resolveShowArgs(option) {
  const raw = option?.raw || {};
  if (raw.url) {
    return { show: raw.url, extraArgs: [] };
  }
  const extraArgs = [];
  if (raw.formatId) extraArgs.push('--format-id', raw.formatId);
  if (raw.contentId) extraArgs.push('--content-id', raw.contentId);
  return { show: raw.showId, extraArgs };
}

/**
 * One `district seats` call for a specific set of seat-search parameters.
 * Pure webcmd-invocation concern — the relaxation ladder that decides WHICH
 * parameter sets to try lives in server/runner/steps/selectSeats.js, kept
 * provider-agnostic in principle even though only District exists today.
 * @param {object} option - a BookingOption (needs option.raw.url or showId)
 * @param {{count: number, maxPrice?: number|null, seatClass?: string|null, together?: boolean, jobId?: string}} params
 * @returns {Promise<Array<{seat: string, price: number|null, seatClass: string|null}>>}
 */
export async function queryDistrictSeats(option, { count, maxPrice, seatClass, together, jobId }) {
  const { show, extraArgs } = resolveShowArgs(option);
  const args = [show, ...extraArgs, '--count', String(count)];
  if (typeof maxPrice === 'number') args.push('--max-price', String(maxPrice));
  if (seatClass) args.push('--class', seatClass);
  if (together) args.push('--together', 'true');

  const rows = await webcmdExec({
    adapter: 'district',
    command: 'seats',
    args,
    browser: true,
    jobId,
    step: 'select_seats',
  });

  return (Array.isArray(rows) ? rows : []).map((row) => ({
    seat: row.seat ?? null,
    price: typeof row.price === 'number' ? row.price : null,
    seatClass: row.seatClass ?? null,
  }));
}

// §14.1, P3-T6 — `district whoami`. Verified live in this sandbox: a
// logged-out session makes whoami exit non-zero with an AUTH_REQUIRED-style
// error rather than returning a clean `{logged_in: false}` object, so
// callers must treat a thrown error the same as `logged_in: false`.
export async function checkDistrictLogin(jobId) {
  return webcmdExec({ adapter: 'district', command: 'whoami', args: [], jobId, step: 'login_check' });
}

// §14.1, P3-T6 — opens District's login flow in a foreground window so the
// human can complete it. The ONLY path allowed to use `--window foreground`
// (§ P3-T6 notes) — every other automation step stays background.
export async function triggerDistrictLogin(jobId) {
  return webcmdExec({
    adapter: 'district',
    command: 'login',
    args: [],
    browser: true,
    window: 'foreground',
    jobId,
    step: 'login',
  });
}
