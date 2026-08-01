// server/adapters/llm/index.js — the LLM provider registry (§13.1, §13.2).
//
// Provider selection is by NAME, resolved here. Neither DeepSeek nor Gemini
// is hard-coded anywhere else; MAIN_LLM_PROVIDER=gemini works without a code
// change. Adding OpenAI/Claude/Groq/Ollama later is one factory added to this
// map — no service file changes.
import { config } from '../../config.js';
import { createDeepSeekAdapter } from './deepseek.js';
import { createGeminiAdapter } from './gemini.js';

const factories = new Map([
  ['deepseek', createDeepSeekAdapter],
  ['gemini', createGeminiAdapter],
]);

const instances = new Map();

function build(name) {
  const factory = factories.get(name);
  if (!factory) {
    throw new Error(
      `[llm] Unknown LLM provider: "${name}". Known providers: ${[...factories.keys()].join(', ')}`
    );
  }
  if (!instances.has(name)) instances.set(name, factory());
  return instances.get(name);
}

/** Resolve a provider by name. Throws synchronously if the name is unknown. */
export function getProvider(name) {
  return build(name);
}

/** The configured primary provider (MAIN_LLM_PROVIDER). */
export function getPrimary() {
  return build(config.MAIN_LLM_PROVIDER);
}

/** The configured fallback provider (FALLBACK_LLM_PROVIDER). */
export function getFallback() {
  return build(config.FALLBACK_LLM_PROVIDER);
}

// Fail closed at startup (i.e. when this module is first imported), not on
// first call: an unknown provider name in config is a misconfiguration that
// must be loud immediately, never a surprise mid-aggregation.
getPrimary();
getFallback();
