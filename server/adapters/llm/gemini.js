// server/adapters/llm/gemini.js — the fallback LLMProvider adapter (§13, P2-T3).
//
// Gemini's request shape differs from DeepSeek's OpenAI-compatible one in two
// ways: the system prompt is a separate `systemInstruction` field rather than
// a message with role "system", and there is no `messages` array — just
// `contents`. Both differences are absorbed HERE, inside the adapter, so
// callers of generateStructured/generateText see the identical LLMProvider
// shape regardless of which provider answered (§13.1).
import { config } from '../../config.js';

function endpointFor(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

async function generateContent({ system, user, timeoutMs, jsonMode }) {
  const res = await fetch(endpointFor(config.GEMINI_MODEL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      ...(jsonMode ? { generationConfig: { responseMimeType: 'application/json' } } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs ?? config.LLM_TIMEOUT),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Gemini request failed: HTTP ${res.status} ${body}`.trim());
    err.status = res.status;
    err.provider = 'gemini';
    throw err;
  }

  const payload = await res.json();
  const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error('Gemini response missing candidates[0].content.parts[0].text');
  }
  return text;
}

export function createGeminiAdapter() {
  return {
    name: 'gemini',

    async generateStructured({ system, user, schema, timeoutMs }) {
      const schemaInstruction = `\n\nRespond with ONLY a JSON object matching this shape:\n${JSON.stringify(schema)}`;
      const text = await generateContent({
        system,
        user: user + schemaInstruction,
        timeoutMs,
        jsonMode: true,
      });
      // Never a regex scrape of model output — JSON.parse or fail, exactly
      // like the DeepSeek adapter, so callers cannot tell providers apart.
      return JSON.parse(text);
    },

    async generateText({ system, user, timeoutMs }) {
      return generateContent({ system, user, timeoutMs, jsonMode: false });
    },
  };
}
