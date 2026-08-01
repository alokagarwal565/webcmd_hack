import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intersect } from '../availability.js';

// The seven cases from §27.2, written first — "the engine's most
// consequential decisions" per the plan. Case 3 is the one most likely to
// be implemented wrong and the one whose failure is most visible in a demo.

function w(startIso, endIso) {
  return { start: startIso, end: endIso };
}

test('case 1: full overlap across all participants -> one window', () => {
  const result = intersect([
    { name: 'Priya', windows: [w('2026-08-07T18:00:00Z', '2026-08-07T23:00:00Z')] },
    { name: 'Arjun', windows: [w('2026-08-07T19:00:00Z', '2026-08-07T22:00:00Z')] },
  ]);

  assert.equal(result.full_overlap.length, 1);
  assert.equal(result.full_overlap[0].start, '2026-08-07T19:00:00.000Z');
  assert.equal(result.full_overlap[0].end, '2026-08-07T22:00:00.000Z');
  assert.equal(result.full_overlap[0].participant_count, 2);
  assert.equal(result.partial_overlap.length, 0);
});

test('case 2: no overlap -> empty full_overlap, partial_overlap names who is missing', () => {
  const result = intersect([
    { name: 'Priya', windows: [w('2026-08-07T18:00:00Z', '2026-08-07T20:00:00Z')] },
    { name: 'Arjun', windows: [w('2026-08-08T18:00:00Z', '2026-08-08T20:00:00Z')] },
  ]);

  assert.equal(result.full_overlap.length, 0);
  assert.ok(result.partial_overlap.length >= 2);
  const priyaWindow = result.partial_overlap.find((p) => p.missing.includes('Arjun'));
  const arjunWindow = result.partial_overlap.find((p) => p.missing.includes('Priya'));
  assert.ok(priyaWindow);
  assert.ok(arjunWindow);
});

test('case 3: a participant with zero windows counts as always-available (Rahul)', () => {
  const result = intersect([
    { name: 'Priya', windows: [w('2026-08-07T18:00:00Z', '2026-08-07T23:00:00Z')] },
    { name: 'Arjun', windows: [w('2026-08-07T19:00:00Z', '2026-08-07T22:00:00Z')] },
    { name: 'Rahul', windows: [] },
  ]);

  // Rahul's absence of windows must NOT collapse the intersection to empty.
  assert.equal(result.full_overlap.length, 1);
  assert.equal(result.full_overlap[0].participant_count, 3);
  assert.equal(result.full_overlap[0].start, '2026-08-07T19:00:00.000Z');
  assert.equal(result.full_overlap[0].end, '2026-08-07T22:00:00.000Z');
});

test('case 3b: everyone unconstrained still does not crash and yields no anchored window', () => {
  const result = intersect([
    { name: 'Rahul', windows: [] },
    { name: 'Sam', windows: [] },
  ]);
  assert.deepEqual(result.full_overlap, []);
  assert.deepEqual(result.partial_overlap, []);
});

test('case 4: single participant -> their own windows', () => {
  const result = intersect([
    { name: 'Sneha', windows: [w('2026-08-07T20:00:00Z', '2026-08-07T23:00:00Z')] },
  ]);
  assert.equal(result.full_overlap.length, 1);
  assert.equal(result.full_overlap[0].participant_count, 1);
  assert.equal(result.full_overlap[0].start, '2026-08-07T20:00:00.000Z');
  assert.equal(result.full_overlap[0].end, '2026-08-07T23:00:00.000Z');
});

test('case 5: adjacent windows merge; overlapping windows deduplicate', () => {
  const result = intersect([
    {
      name: 'Priya',
      windows: [
        w('2026-08-07T18:00:00Z', '2026-08-07T20:00:00Z'), // adjacent to next
        w('2026-08-07T20:00:00Z', '2026-08-07T22:00:00Z'),
        w('2026-08-07T21:00:00Z', '2026-08-07T23:00:00Z'), // overlaps previous
      ],
    },
  ]);
  assert.equal(result.full_overlap.length, 1);
  assert.equal(result.full_overlap[0].start, '2026-08-07T18:00:00.000Z');
  assert.equal(result.full_overlap[0].end, '2026-08-07T23:00:00.000Z');
});

test('case 6: windows shorter than MIN_SLOT_MINUTES are discarded', () => {
  const result = intersect(
    [
      { name: 'Priya', windows: [w('2026-08-07T18:00:00Z', '2026-08-07T23:00:00Z')] },
      { name: 'Arjun', windows: [w('2026-08-07T18:50:00Z', '2026-08-07T19:10:00Z')] }, // 20 min overlap
    ],
    120
  );
  assert.equal(result.full_overlap.length, 0);
  // The 20-minute sliver must not appear anywhere in the output.
  const allWindows = [...result.full_overlap, ...result.partial_overlap];
  for (const win of allWindows) {
    const durationMinutes = (new Date(win.end) - new Date(win.start)) / 60000;
    assert.ok(durationMinutes >= 120, `window shorter than MIN_SLOT_MINUTES leaked: ${durationMinutes}min`);
  }
});

test('case 7: windows spanning midnight and DST boundaries behave correctly', () => {
  // Spans midnight.
  const midnight = intersect([
    { name: 'Priya', windows: [w('2026-08-07T22:00:00Z', '2026-08-08T02:00:00Z')] },
    { name: 'Arjun', windows: [w('2026-08-07T23:00:00Z', '2026-08-08T01:00:00Z')] },
  ]);
  assert.equal(midnight.full_overlap.length, 1);
  assert.equal(midnight.full_overlap[0].start, '2026-08-07T23:00:00.000Z');
  assert.equal(midnight.full_overlap[0].end, '2026-08-08T01:00:00.000Z');

  // DST transition (US: 2026-03-08 02:00 local skips to 03:00). Windows are
  // absolute instants (ISO with offset), so epoch-ms arithmetic is immune to
  // the local wall-clock jump by construction.
  const dst = intersect([
    { name: 'Priya', windows: [w('2026-03-08T06:00:00Z', '2026-03-08T10:00:00Z')] },
    { name: 'Arjun', windows: [w('2026-03-08T07:00:00Z', '2026-03-08T09:00:00Z')] },
  ]);
  assert.equal(dst.full_overlap.length, 1);
  assert.equal(dst.full_overlap[0].start, '2026-03-08T07:00:00.000Z');
  assert.equal(dst.full_overlap[0].end, '2026-03-08T09:00:00.000Z');
});

test('partial overlap sorts by coverage descending, then earliest start', () => {
  const result = intersect([
    { name: 'A', windows: [w('2026-08-07T10:00:00Z', '2026-08-07T14:00:00Z')] },
    { name: 'B', windows: [w('2026-08-07T12:00:00Z', '2026-08-07T16:00:00Z')] },
    { name: 'C', windows: [w('2026-08-07T20:00:00Z', '2026-08-07T23:00:00Z')] },
  ]);
  // No full overlap (C is disjoint from A/B). Best partial window is A+B
  // overlap [12:00,14:00) with count 2; should sort ahead of count-1 windows.
  assert.equal(result.full_overlap.length, 0);
  assert.equal(result.partial_overlap[0].participant_count, 2);
  assert.deepEqual(result.partial_overlap[0].missing, ['C']);
});
