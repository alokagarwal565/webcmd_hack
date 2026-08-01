import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyError,
  ERROR_CLASSES,
  FAILOVER_CLASSES,
  FAILFAST_CLASSES,
  RETRYABLE_ON_SAME_PROVIDER,
} from '../classifyError.js';

function err(props) {
  return Object.assign(new Error(props.message || 'x'), props);
}

// Every row of §13.4, exhaustively.

test('HTTP 429 -> RATE_LIMIT', () => {
  assert.equal(classifyError(err({ status: 429 })), ERROR_CLASSES.RATE_LIMIT);
});

test('rate_limit_exceeded message -> RATE_LIMIT', () => {
  assert.equal(classifyError(err({ message: 'rate_limit_exceeded' })), ERROR_CLASSES.RATE_LIMIT);
});

test('quota message -> RATE_LIMIT', () => {
  assert.equal(classifyError(err({ message: 'quota exceeded for this key' })), ERROR_CLASSES.RATE_LIMIT);
});

test('AbortSignal.timeout rejection -> TIMEOUT', () => {
  const e = new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  assert.equal(classifyError(e), ERROR_CLASSES.TIMEOUT);
});

test('HTTP 500/502/503/504 -> PROVIDER_ERROR', () => {
  for (const status of [500, 502, 503, 504]) {
    assert.equal(classifyError(err({ status })), ERROR_CLASSES.PROVIDER_ERROR);
  }
});

test('ECONNREFUSED / ENOTFOUND / ECONNRESET -> NETWORK', () => {
  for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET']) {
    assert.equal(classifyError(err({ code })), ERROR_CLASSES.NETWORK);
  }
});

test('bare fetch TypeError -> NETWORK', () => {
  const e = new TypeError('fetch failed');
  assert.equal(classifyError(e), ERROR_CLASSES.NETWORK);
});

test('model_not_found -> MODEL_UNAVAILABLE', () => {
  assert.equal(classifyError(err({ message: 'model_not_found' })), ERROR_CLASSES.MODEL_UNAVAILABLE);
});

test('model overloaded -> MODEL_UNAVAILABLE', () => {
  assert.equal(classifyError(err({ message: 'the model is overloaded, try again' })), ERROR_CLASSES.MODEL_UNAVAILABLE);
});

test('HTTP 401/403 -> AUTH (never failover)', () => {
  assert.equal(classifyError(err({ status: 401 })), ERROR_CLASSES.AUTH);
  assert.equal(classifyError(err({ status: 403 })), ERROR_CLASSES.AUTH);
});

test('HTTP 400 -> BAD_REQUEST (never failover)', () => {
  assert.equal(classifyError(err({ status: 400 })), ERROR_CLASSES.BAD_REQUEST);
});

test('unknown error shape defaults to PROVIDER_ERROR, not AUTH', () => {
  assert.equal(classifyError(err({ message: 'something weird happened' })), ERROR_CLASSES.PROVIDER_ERROR);
});

test('policy sets are mutually consistent with the table', () => {
  for (const cls of Object.values(ERROR_CLASSES)) {
    const inFailover = FAILOVER_CLASSES.has(cls);
    const inFailfast = FAILFAST_CLASSES.has(cls);
    // Every class is exactly one of failover-eligible or fail-fast.
    assert.notEqual(inFailover, inFailfast, `${cls} must be exactly one of failover/fail-fast`);
  }
  assert.ok(RETRYABLE_ON_SAME_PROVIDER.has(ERROR_CLASSES.NETWORK));
  assert.ok(RETRYABLE_ON_SAME_PROVIDER.has(ERROR_CLASSES.PROVIDER_ERROR));
  assert.ok(!RETRYABLE_ON_SAME_PROVIDER.has(ERROR_CLASSES.RATE_LIMIT));
  assert.ok(!RETRYABLE_ON_SAME_PROVIDER.has(ERROR_CLASSES.AUTH));
});
