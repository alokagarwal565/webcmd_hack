import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getProvider } from '../index.js';

test('fixture provider returns normalized options', async () => {
  const provider = getProvider('fixture');
  const options = await provider.searchOptions({
    content_preferences: [],
    max_price_per_seat: 300,
    location: 'Bengaluru',
    preferred_time_windows: [],
  });

  assert.ok(options.length > 0);
  for (const opt of options) {
    assert.ok(opt.externalId);
    assert.ok(opt.title);
    assert.ok(opt.raw && typeof opt.raw === 'object');
  }
});

test('fixture provider filters by content_preferences', async () => {
  const provider = getProvider('fixture');
  const options = await provider.searchOptions({ content_preferences: ['Spider-Man'] });
  assert.ok(options.length > 0);
  assert.ok(options.every((o) => o.title.includes('Spider-Man')));
});

test('unknown booking provider name throws synchronously', () => {
  assert.throws(() => getProvider('nope'), /Unknown booking provider/);
});
