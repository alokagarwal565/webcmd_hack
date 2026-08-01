// server/ports/llmProvider.js — the ONLY LLM surface business logic may import.
// Adapters (server/adapters/llm/*) implement this shape. Services import the
// registry in server/adapters/llm/index.js, never a concrete adapter (§8.2, §13.1).

/**
 * @typedef {{ start: string, end: string }} TimeWindow
 *
 * @typedef {Object} LLMProvider
 * @property {string} name
 * @property {(opts: {system: string, user: string, schema: object, timeoutMs: number}) => Promise<object>} generateStructured
 * @property {(opts: {system: string, user: string, timeoutMs: number}) => Promise<string>} generateText
 */

export {};
