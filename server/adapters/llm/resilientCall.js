// server/adapters/llm/resilientCall.js — implements §13.3 (failover flow)
// and §13.5 (retry semantics) exactly. This is the ONLY place in the
// codebase that calls an LLMProvider adapter directly; aggregationService
// and recommendationService call resilientCall(), never a provider (§13.1).
import { getPrimary, getFallback } from './index.js';
import { classifyError, FAILFAST_CLASSES, RETRYABLE_ON_SAME_PROVIDER } from './classifyError.js';
import { logger } from '../../lib/logger.js';
import { config } from '../../config.js';
import { AppError } from '../../lib/AppError.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exponential backoff + jitter, base 500ms (§23) — NETWORK/PROVIDER_ERROR only.
function backoffDelay(attempt) {
  const base = 500 * 2 ** (attempt - 1);
  return base + Math.random() * base * 0.5;
}

class LLMFailFastError extends Error {
  constructor(errorClass, cause) {
    super(`LLM call failed fast (${errorClass}): ${cause.message}`);
    this.name = 'LLMFailFastError';
    this.errorClass = errorClass;
  }
}

// Minimal structural validator for the plain-JSON schemas used by §12.2-style
// prompts: {type, required, properties, items}. Deliberately not a full JSON
// Schema implementation — SeatSync's LLM outputs are small, fixed shapes,
// and pulling in a schema library is not repaid at this scope.
export function validateAgainstSchema(value, schema, path = '$') {
  if (!schema) return { valid: true };

  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { valid: false, reason: `${path} must be an object` };
    }
    for (const key of schema.required ?? []) {
      if (!(key in value)) return { valid: false, reason: `${path}.${key} is required` };
    }
    for (const [key, subSchema] of Object.entries(schema.properties ?? {})) {
      if (key in value) {
        const result = validateAgainstSchema(value[key], subSchema, `${path}.${key}`);
        if (!result.valid) return result;
      }
    }
    return { valid: true };
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) return { valid: false, reason: `${path} must be an array` };
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const result = validateAgainstSchema(value[i], schema.items, `${path}[${i}]`);
        if (!result.valid) return result;
      }
    }
    return { valid: true };
  }

  if (schema.type === 'string' && typeof value !== 'string') {
    return { valid: false, reason: `${path} must be a string` };
  }
  if (schema.type === 'number' && typeof value !== 'number') {
    return { valid: false, reason: `${path} must be a number` };
  }
  if (schema.type === 'boolean' && typeof value !== 'boolean') {
    return { valid: false, reason: `${path} must be a boolean` };
  }
  return { valid: true };
}

// Attempts one provider, retrying NETWORK/PROVIDER_ERROR on the same
// provider up to LLM_MAX_RETRIES times (§13.5). Any other failover-eligible
// class, or retry exhaustion, bubbles up so the caller moves to the next
// provider. FAILFAST classes (AUTH/BAD_REQUEST) bubble up as
// LLMFailFastError so the caller never tries the next provider (§13.4).
async function callOneProvider({ provider, task, mode, system, user, schema, timeoutMs, requestId, failedOver }) {
  let attempt = 0;
  while (true) {
    attempt++;
    const startedAt = Date.now();
    try {
      const result =
        mode === 'text'
          ? await provider.generateText({ system, user, timeoutMs })
          : await provider.generateStructured({ system, user, schema, timeoutMs });
      logger.info({
        event: 'llm.call',
        requestId,
        task,
        provider: provider.name,
        model: undefined,
        attempt,
        durationMs: Date.now() - startedAt,
        outcome: 'success',
        failedOver,
      });
      return result;
    } catch (err) {
      const errorClass = classifyError(err);
      logger.info({
        event: 'llm.call',
        requestId,
        task,
        provider: provider.name,
        attempt,
        durationMs: Date.now() - startedAt,
        outcome: 'error',
        errorClass,
        failedOver,
      });

      if (FAILFAST_CLASSES.has(errorClass)) {
        throw new LLMFailFastError(errorClass, err);
      }
      if (RETRYABLE_ON_SAME_PROVIDER.has(errorClass) && attempt <= config.LLM_MAX_RETRIES) {
        await sleep(backoffDelay(attempt));
        continue;
      }
      err.errorClass = errorClass;
      throw err;
    }
  }
}

/**
 * The provider-agnostic entry point every AI call in SeatSync goes through.
 * Tries the primary, classifies failures, fails over to the fallback,
 * validates structured output against `schema` (one bounded re-ask on
 * mismatch), and logs every attempt (§13.6).
 *
 * `providers` defaults to [primary, fallback] from the registry and exists
 * as a parameter purely so tests can inject fakes without mocking modules.
 *
 * @param {{task: string, mode?: 'structured'|'text', system: string, user: string, schema?: object, timeoutMs?: number, requestId?: string, providers?: import('../../ports/llmProvider.js').LLMProvider[]}} opts
 * @returns {Promise<{result: any, provider: string}>}
 */
export async function resilientCall({
  task,
  mode = 'structured',
  system,
  user,
  schema,
  timeoutMs,
  requestId,
  providers,
}) {
  const chain = providers ?? [getPrimary(), getFallback()];
  let lastError;

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];
    const failedOver = i > 0;

    if (failedOver) {
      logger.info({
        event: 'llm.failover',
        requestId,
        task,
        fromProvider: chain[i - 1].name,
        toProvider: provider.name,
        errorClass: lastError?.errorClass,
      });
    }

    let raw;
    try {
      raw = await callOneProvider({ provider, task, mode, system, user, schema, timeoutMs, requestId, failedOver });
    } catch (err) {
      if (err instanceof LLMFailFastError) {
        // Never failover on a misconfiguration — a wrong key that silently
        // falls through to the fallback hides the problem until the
        // fallback also fails, at the worst possible moment (§13.4).
        throw new AppError('LLM_PROVIDER_MISCONFIGURED', err.message, 502);
      }
      lastError = err;
      continue;
    }

    if (mode === 'text' || !schema) {
      return { result: raw, provider: provider.name };
    }

    const firstCheck = validateAgainstSchema(raw, schema);
    if (firstCheck.valid) {
      return { result: raw, provider: provider.name };
    }

    // One bounded re-ask, stricter instruction, same provider (§13.3).
    let reaskRaw;
    try {
      reaskRaw = await callOneProvider({
        provider,
        task,
        mode,
        schema,
        timeoutMs,
        requestId,
        failedOver,
        system,
        user: `${user}\n\nSTRICT: your previous response was invalid (${firstCheck.reason}). Return ONLY valid JSON matching the required schema exactly — no prose, no markdown fences.`,
      });
    } catch (err) {
      if (err instanceof LLMFailFastError) {
        throw new AppError('LLM_PROVIDER_MISCONFIGURED', err.message, 502);
      }
      lastError = err;
      continue;
    }

    const secondCheck = validateAgainstSchema(reaskRaw, schema);
    if (secondCheck.valid) {
      return { result: reaskRaw, provider: provider.name };
    }

    // Schema failure is never silently accepted and never triggers a
    // failover to the other provider — it fails cleanly, per §12.2.
    throw new AppError(
      'LLM_SCHEMA_INVALID',
      `Model output failed schema validation twice: ${secondCheck.reason}`,
      502
    );
  }

  throw new AppError(
    'LLM_ALL_PROVIDERS_FAILED',
    `All LLM providers failed. Last error: ${lastError?.message ?? 'unknown'}`,
    502
  );
}
