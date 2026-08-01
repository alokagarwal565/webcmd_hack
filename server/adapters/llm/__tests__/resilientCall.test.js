import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resilientCall } from '../resilientCall.js';

// Fake providers so these tests never touch the network and never depend on
// which real adapters are registered. `providers` is accepted by
// resilientCall specifically to make this possible.

function okProvider(name, result) {
  return {
    name,
    async generateStructured() {
      return result;
    },
    async generateText() {
      return result;
    },
  };
}

function failingProvider(name, err) {
  return {
    name,
    async generateStructured() {
      throw err;
    },
    async generateText() {
      throw err;
    },
  };
}

function httpError(status, message = 'boom') {
  const e = new Error(message);
  e.status = status;
  return e;
}

const SCHEMA = {
  type: 'object',
  required: ['party_size'],
  properties: { party_size: { type: 'number' } },
};

test('primary success — no failover', async () => {
  const primary = okProvider('deepseek', { party_size: 4 });
  const fallback = failingProvider('gemini', httpError(500));

  const { result, provider } = await resilientCall({
    task: 'aggregate',
    system: 's',
    user: 'u',
    schema: SCHEMA,
    providers: [primary, fallback],
  });

  assert.equal(provider, 'deepseek');
  assert.deepEqual(result, { party_size: 4 });
});

test('primary 5xx fails over to fallback, which succeeds', async () => {
  const primary = failingProvider('deepseek', httpError(503));
  const fallback = okProvider('gemini', { party_size: 4 });

  const { result, provider } = await resilientCall({
    task: 'aggregate',
    system: 's',
    user: 'u',
    schema: SCHEMA,
    providers: [primary, fallback],
  });

  assert.equal(provider, 'gemini');
  assert.deepEqual(result, { party_size: 4 });
});

test('primary 429 fails over immediately to fallback', async () => {
  const primary = failingProvider('deepseek', httpError(429));
  const fallback = okProvider('gemini', { party_size: 4 });

  const { provider } = await resilientCall({
    task: 'aggregate',
    system: 's',
    user: 'u',
    schema: SCHEMA,
    providers: [primary, fallback],
  });

  assert.equal(provider, 'gemini');
});

test('primary AUTH failure fails fast — never tries fallback', async () => {
  let fallbackCalled = false;
  const primary = failingProvider('deepseek', httpError(401));
  const fallback = {
    name: 'gemini',
    async generateStructured() {
      fallbackCalled = true;
      return { party_size: 4 };
    },
  };

  await assert.rejects(
    () =>
      resilientCall({
        task: 'aggregate',
        system: 's',
        user: 'u',
        schema: SCHEMA,
        providers: [primary, fallback],
      }),
    (err) => err.code === 'LLM_PROVIDER_MISCONFIGURED'
  );
  assert.equal(fallbackCalled, false);
});

test('primary BAD_REQUEST fails fast — never tries fallback', async () => {
  const primary = failingProvider('deepseek', httpError(400));
  const fallback = okProvider('gemini', { party_size: 4 });

  await assert.rejects(
    () =>
      resilientCall({
        task: 'aggregate',
        system: 's',
        user: 'u',
        schema: SCHEMA,
        providers: [primary, fallback],
      }),
    (err) => err.code === 'LLM_PROVIDER_MISCONFIGURED'
  );
});

test('both providers fail -> LLM_ALL_PROVIDERS_FAILED', async () => {
  const primary = failingProvider('deepseek', httpError(500));
  const fallback = failingProvider('gemini', httpError(503));

  await assert.rejects(
    () =>
      resilientCall({
        task: 'aggregate',
        system: 's',
        user: 'u',
        schema: SCHEMA,
        providers: [primary, fallback],
      }),
    (err) => err.code === 'LLM_ALL_PROVIDERS_FAILED'
  );
});

test('NETWORK error retries on the same provider before failing over', async () => {
  let calls = 0;
  const flaky = {
    name: 'deepseek',
    async generateStructured() {
      calls++;
      if (calls < 2) {
        const e = new TypeError('fetch failed');
        throw e;
      }
      return { party_size: 4 };
    },
  };
  const fallback = failingProvider('gemini', httpError(500));

  const { provider } = await resilientCall({
    task: 'aggregate',
    system: 's',
    user: 'u',
    schema: SCHEMA,
    providers: [flaky, fallback],
  });

  assert.equal(provider, 'deepseek');
  assert.equal(calls, 2);
});

test('malformed schema response triggers one re-ask, then succeeds', async () => {
  let calls = 0;
  const provider = {
    name: 'deepseek',
    async generateStructured() {
      calls++;
      return calls === 1 ? { wrong_field: true } : { party_size: 4 };
    },
  };

  const { result } = await resilientCall({
    task: 'aggregate',
    system: 's',
    user: 'u',
    schema: SCHEMA,
    providers: [provider, failingProvider('gemini', httpError(500))],
  });

  assert.equal(calls, 2);
  assert.deepEqual(result, { party_size: 4 });
});

test('malformed schema response twice -> LLM_SCHEMA_INVALID, never failed over', async () => {
  let fallbackCalled = false;
  const provider = {
    name: 'deepseek',
    async generateStructured() {
      return { wrong_field: true };
    },
  };
  const fallback = {
    name: 'gemini',
    async generateStructured() {
      fallbackCalled = true;
      return { party_size: 4 };
    },
  };

  await assert.rejects(
    () =>
      resilientCall({
        task: 'aggregate',
        system: 's',
        user: 'u',
        schema: SCHEMA,
        providers: [provider, fallback],
      }),
    (err) => err.code === 'LLM_SCHEMA_INVALID'
  );
  assert.equal(fallbackCalled, false);
});

test('text mode returns the raw string with no schema validation', async () => {
  const provider = okProvider('deepseek', 'a plain sentence');
  const { result } = await resilientCall({
    task: 'reasoning',
    mode: 'text',
    system: 's',
    user: 'u',
    providers: [provider, failingProvider('gemini', httpError(500))],
  });
  assert.equal(result, 'a plain sentence');
});
