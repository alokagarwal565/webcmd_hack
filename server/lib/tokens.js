import { randomBytes, timingSafeEqual } from 'node:crypto';

// Capability tokens (§20.2): 256-bit, URL-safe, never sequential or derived.
export function generateToken() {
  return randomBytes(32).toString('base64url');
}

// Constant-time comparison so no route ever hand-rolls `===` on a secret.
// Length check first — timingSafeEqual throws on mismatched buffer lengths,
// and the length check itself leaks only length, not content.
export function tokensMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
