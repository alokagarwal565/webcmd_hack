// server/services/availability.js — the deterministic availability
// intersection engine (§16.2). Pure interval arithmetic; NO LLM call
// anywhere in this file, ever (§8.2, §12.1) — the answer is provably
// correct, so delegating it to a model would be slower, costlier, and
// occasionally wrong.
//
// Internally everything is epoch milliseconds (R13): converting once at the
// boundary is what makes midnight/DST spans "just work" — an absolute
// instant has no timezone to get wrong.

const DEFAULT_MIN_SLOT_MINUTES = 120;

/** @typedef {{start: string, end: string}} TimeWindow */
/** @typedef {{name: string, windows: TimeWindow[]}} ParticipantWindows */

function toMs(iso) {
  return new Date(iso).getTime();
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

// Merge a single participant's own overlapping/adjacent windows (§27.2 case
// 5) so their own duplicate coverage never distorts the sweep below.
function mergeOwnWindows(windows) {
  const sorted = windows
    .map((w) => ({ start: toMs(w.start), end: toMs(w.end) }))
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) {
      last.end = Math.max(last.end, w.end);
    } else {
      merged.push({ ...w });
    }
  }
  return merged;
}

/**
 * @param {ParticipantWindows[]} participants
 * @param {number} [minSlotMinutes]
 * @returns {{
 *   full_overlap: {start: string, end: string, participant_count: number}[],
 *   partial_overlap: {start: string, end: string, participant_count: number, missing: string[]}[],
 *   min_slot_minutes: number
 * }}
 */
export function intersect(participants, minSlotMinutes = DEFAULT_MIN_SLOT_MINUTES) {
  const minSlotMs = minSlotMinutes * 60_000;
  const total = participants.length;

  const prepared = participants.map((p) => ({
    name: p.name,
    windows: mergeOwnWindows(p.windows ?? []),
    // §16.2 step 1 — the single most consequential line in the engine: a
    // participant with NO windows is always-available, never absent.
    unconstrained: (p.windows ?? []).length === 0,
  }));

  // Boundaries only come from constrained participants — an unconstrained
  // participant contributes no edges of their own, they simply cover
  // whatever elementary interval other participants define.
  const boundarySet = new Set();
  for (const p of prepared) {
    if (p.unconstrained) continue;
    for (const w of p.windows) {
      boundarySet.add(w.start);
      boundarySet.add(w.end);
    }
  }

  if (boundarySet.size === 0) {
    // Nobody stated a constraint — there is no anchored time range to
    // intersect against. Not an error; just nothing to report.
    return { full_overlap: [], partial_overlap: [], min_slot_minutes: minSlotMinutes };
  }

  const boundaries = [...boundarySet].sort((a, b) => a - b);

  // Elementary intervals between consecutive boundaries, each tagged with
  // its covering-participant set.
  const elementary = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    if (end <= start) continue;

    const covering = new Set();
    for (const p of prepared) {
      if (p.unconstrained) {
        covering.add(p.name);
        continue;
      }
      const covers = p.windows.some((w) => w.start <= start && end <= w.end);
      if (covers) covering.add(p.name);
    }
    elementary.push({ start, end, covering });
  }

  // Merge adjacent elementary intervals with an identical covering set.
  const merged = [];
  for (const interval of elementary) {
    const last = merged[merged.length - 1];
    if (last && last.end === interval.start && sameSet(last.covering, interval.covering)) {
      last.end = interval.end;
    } else {
      merged.push({ ...interval, covering: new Set(interval.covering) });
    }
  }

  // Discard intervals below the minimum slot length, then split into
  // full vs. partial overlap.
  const fullOverlap = [];
  const partialOverlap = [];
  for (const interval of merged) {
    if (interval.end - interval.start < minSlotMs) continue;
    if (interval.covering.size === 0) continue;

    const entry = {
      start: toIso(interval.start),
      end: toIso(interval.end),
      participant_count: interval.covering.size,
    };

    if (interval.covering.size === total) {
      fullOverlap.push(entry);
    } else {
      entry.missing = prepared.filter((p) => !interval.covering.has(p.name)).map((p) => p.name);
      partialOverlap.push(entry);
    }
  }

  // §16.2 step 6 — sort by coverage descending, then earliest start.
  const byCoverageThenStart = (a, b) =>
    b.participant_count - a.participant_count || toMs(a.start) - toMs(b.start);
  fullOverlap.sort(byCoverageThenStart);
  partialOverlap.sort(byCoverageThenStart);

  return { full_overlap: fullOverlap, partial_overlap: partialOverlap, min_slot_minutes: minSlotMinutes };
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
