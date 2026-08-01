import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreOptions, identifyBindingConstraint, recommend } from '../recommendationService.js';

const INTERSECTION = {
  full_overlap: [{ start: '2026-08-07T18:00:00.000Z', end: '2026-08-07T23:00:00.000Z', participant_count: 3 }],
  partial_overlap: [],
  min_slot_minutes: 120,
};

const CONSTRAINT_SET = {
  party_size: 3,
  max_price_per_seat: 300,
  seat_class: null,
  seats_together: true,
  location: 'Bengaluru',
  preferred_time_windows: [{ start: '2026-08-07T18:00:00.000Z', end: '2026-08-07T23:00:00.000Z' }],
  content_preferences: ['spider'],
};

function option(overrides = {}) {
  return {
    externalId: 'x1',
    title: 'Spider-Man: Brand New Day',
    venue: 'PVR Forum Mall, Bengaluru',
    showTime: '2026-08-07T19:00:00.000Z',
    price: 250,
    raw: { available: true },
    ...overrides,
  };
}

test('an option above the budget ceiling scores 0 and is disqualified', () => {
  const [scored] = scoreOptions([option({ price: 350 })], { constraintSet: CONSTRAINT_SET, intersection: INTERSECTION });
  assert.equal(scored.score, 0);
  assert.equal(scored.disqualified, true);
});

test('an option at or under the ceiling is never disqualified', () => {
  const [scored] = scoreOptions([option({ price: 300 })], { constraintSet: CONSTRAINT_SET, intersection: INTERSECTION });
  assert.equal(scored.disqualified, false);
  assert.ok(scored.score > 0);
});

test('the top eligible option is marked recommended, disqualified options never are', () => {
  const scored = scoreOptions(
    [option({ externalId: 'cheap', price: 200 }), option({ externalId: 'over', price: 999 })],
    { constraintSet: CONSTRAINT_SET, intersection: INTERSECTION }
  );
  const cheap = scored.find((o) => o.externalId === 'cheap');
  const over = scored.find((o) => o.externalId === 'over');
  assert.equal(cheap.recommended, true);
  assert.equal(over.recommended, false);
});

test('ranking is deterministic across repeated runs on identical input', () => {
  const input = [
    option({ externalId: 'a', price: 220 }),
    option({ externalId: 'b', price: 280 }),
    option({ externalId: 'c', price: 260 }),
  ];
  const run1 = scoreOptions(input, { constraintSet: CONSTRAINT_SET, intersection: INTERSECTION }).map((o) => o.externalId);
  const run2 = scoreOptions(input, { constraintSet: CONSTRAINT_SET, intersection: INTERSECTION }).map((o) => o.externalId);
  assert.deepEqual(run1, run2);
});

test('an option outside every availability window scores 0 on that dimension', () => {
  const [scored] = scoreOptions([option({ showTime: '2026-08-09T10:00:00.000Z' })], {
    constraintSet: CONSTRAINT_SET,
    intersection: INTERSECTION,
  });
  assert.equal(scored.scoreBreakdown.availability, 0);
});

test('identifyBindingConstraint names budget when every candidate is over ceiling', () => {
  const raw = [option({ price: 400 }), option({ price: 500 })];
  const result = identifyBindingConstraint(raw, CONSTRAINT_SET);
  assert.equal(result.binding, 'budget');
  assert.equal(result.suggestedMaxPricePerSeat, 400);
});

test('identifyBindingConstraint reports no_candidates on an empty provider result', () => {
  const result = identifyBindingConstraint([], CONSTRAINT_SET);
  assert.equal(result.binding, 'no_candidates');
});

test('recommend() end-to-end with a fake provider and fake LLM reasoning', async () => {
  const fakeProvider = {
    name: 'fake',
    async searchOptions() {
      return [option({ externalId: 'a', price: 220 }), option({ externalId: 'b', price: 999 })];
    },
  };
  const fakeLlmCall = async () => ({ result: 'A great pick within budget.', provider: 'fake' });

  const { options, binding } = await recommend({
    constraintSet: CONSTRAINT_SET,
    intersection: INTERSECTION,
    bookingProvider: fakeProvider,
    llmCall: fakeLlmCall,
  });

  assert.equal(binding, null);
  const winner = options.find((o) => o.externalId === 'a');
  const loser = options.find((o) => o.externalId === 'b');
  assert.equal(winner.recommended, true);
  assert.equal(winner.reasoning, 'A great pick within budget.');
  assert.match(loser.reasoning, /Excluded/);
});

test('recommend() falls back to a templated reasoning sentence when the LLM fails', async () => {
  const fakeProvider = {
    name: 'fake',
    async searchOptions() {
      return [option({ price: 220 })];
    },
  };
  const failingLlmCall = async () => {
    const err = new Error('down');
    err.code = 'LLM_ALL_PROVIDERS_FAILED';
    throw err;
  };

  const { options } = await recommend({
    constraintSet: CONSTRAINT_SET,
    intersection: INTERSECTION,
    bookingProvider: fakeProvider,
    llmCall: failingLlmCall,
  });

  assert.ok(options[0].reasoning);
  assert.doesNotMatch(options[0].reasoning, /undefined/);
});

test('recommend() reports the binding constraint when zero options survive', async () => {
  const fakeProvider = {
    name: 'fake',
    async searchOptions() {
      return [option({ price: 9999 })];
    },
  };
  const { options, binding } = await recommend({
    constraintSet: CONSTRAINT_SET,
    intersection: INTERSECTION,
    bookingProvider: fakeProvider,
    llmCall: async () => ({ result: 'unused', provider: 'fake' }),
  });
  assert.equal(binding.binding, 'budget');
  assert.equal(options[0].disqualified, true);
});
