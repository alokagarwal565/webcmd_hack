import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Minimal .env loader — no dependency needed for a flat KEY=VALUE file.
function loadDotenv(path) {
  if (!existsSync(path)) return;
  const lines = readFileSync(path, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotenv(join(__dirname, '..', '.env'));

// Variables required unconditionally, from app startup, regardless of phase.
const REQUIRED_ALWAYS = ['DATABASE_URL'];

const missing = REQUIRED_ALWAYS.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(
    `[config] Missing required environment variable(s): ${missing.join(', ')}\n` +
      `[config] Copy .env.example to .env and fill these in before starting the server.`
  );
  process.exit(1);
}

// Every variable from the §26.4 environment contract is represented here.
// Phase-gated variables (Dodo, Google, Sentry, Runner) are optional until
// their phase is enabled — they are read as empty string, not defaulted,
// so no secret ever has a default value.
export const config = Object.freeze({
  // Core
  DATABASE_URL: process.env.DATABASE_URL,
  PORT: Number(process.env.PORT) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // LLM (Phase 2)
  MAIN_LLM_PROVIDER: process.env.MAIN_LLM_PROVIDER || 'deepseek',
  FALLBACK_LLM_PROVIDER: process.env.FALLBACK_LLM_PROVIDER || 'gemini',
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  LLM_TIMEOUT: Number(process.env.LLM_TIMEOUT) || 20000,
  LLM_MAX_RETRIES: Number(process.env.LLM_MAX_RETRIES) || 2,

  // Booking automation (Phase 3)
  WEBCMD_BIN: process.env.WEBCMD_BIN || 'webcmd',
  WEBCMD_SESSION: process.env.WEBCMD_SESSION || 'seatsync',
  WEBCMD_WINDOW: process.env.WEBCMD_WINDOW || 'background',
  BOOKING_PROVIDER: process.env.BOOKING_PROVIDER || 'district',
  AUTOMATION_STEP_TIMEOUT: Number(process.env.AUTOMATION_STEP_TIMEOUT) || 45000,

  // Payments (Phase 4) — optional
  DODO_PAYMENTS_API_KEY: process.env.DODO_PAYMENTS_API_KEY || '',
  DODO_PAYMENTS_ENVIRONMENT: process.env.DODO_PAYMENTS_ENVIRONMENT || 'test_mode',
  DODO_WEBHOOK_SECRET: process.env.DODO_WEBHOOK_SECRET || '',

  // Google Calendar (Phase 6) — optional
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_REDIRECT_URI:
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback',

  // Deployment (Phase 5) — optional
  SENTRY_DSN: process.env.SENTRY_DSN || '',
  RUNNER_TOKEN: process.env.RUNNER_TOKEN || '',
  SEATSYNC_API_URL: process.env.SEATSYNC_API_URL || 'http://localhost:3000',
});
