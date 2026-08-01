// server/adapters/llm/deepseek.js — the primary LLMProvider adapter (§13, P2-T2).
//
// DeepSeek's chat completions endpoint is OpenAI-compatible, so plain `fetch`
// is enough — no SDK. This file never classifies errors: it throws whatever
// the fetch/HTTP failure is, and server/adapters/llm/resilientCall.js (P2-T4)
// is the only place that inspects the failure and decides whether to fail
// over. Keeping that split means every provider's errors are classified by
// one shared piece of code, not reimplemented per adapter.
import { config } from '../../config.js';

const CHAT_COMPLETIONS_URL = 'https://api.deepseek.com/chat/completions';

async function chatCompletion({ system, user, timeoutMs, jsonMode }) {
  const res = await fetch(CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: config.DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(timeoutMs ?? config.LLM_TIMEOUT),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`DeepSeek request failed: HTTP ${res.status} ${body}`.trim());
    err.status = res.status;
    err.provider = 'deepseek';
    throw err;
  }

  const payload = await res.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('DeepSeek response missing choices[0].message.content');
  }
  return content;
}

export function createDeepSeekAdapter() {
  return {
    name: 'deepseek',

    async generateStructured({ system, user, schema, timeoutMs }) {
      // DeepSeek's json_object mode does not accept a JSON Schema directly —
      // the schema is folded into the user prompt as an instruction, and the
      // caller (resilientCall) is responsible for validating the parsed
      // result against the real schema.
      const schemaInstruction = `\n\nRespond with ONLY a JSON object matching this shape:\n${JSON.stringify(schema)}`;
      const content = await chatCompletion({
        system,
        user: user + schemaInstruction,
        timeoutMs,
        jsonMode: true,
      });
      // Never a regex scrape of model output — JSON.parse or fail.
      return JSON.parse(content);
    },

    async generateText({ system, user, timeoutMs }) {
      return chatCompletion({ system, user, timeoutMs, jsonMode: false });
    },
  };
}
