// server/runner/steps/detectHumanStep.js — the pre-flight login check and
// OTP/CAPTCHA interstitial detection that drive the `awaiting_human` pause
// (§14.3, §14.4, P3-T6). `awaiting_human` is a designed feature, not an
// error path — this is the most likely live-demo state.
import { webcmdExec } from '../../adapters/booking/webcmdExec.js';
import { checkDistrictLogin, triggerDistrictLogin } from '../../adapters/booking/district.js';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';

// Verified live: `whoami` called immediately after a login navigation can
// transiently throw "Execution context was destroyed, most likely because
// of a navigation" — the page hadn't settled yet, NOT a genuine auth
// failure. Retrying once after a short delay resolved it in testing (a
// second call, ~3s later, correctly returned `logged_in: true`). Without
// this, a real Resume-right-after-login click false-pauses the job again,
// which is exactly the confusing demo moment this feature exists to avoid.
const TRANSIENT_ERROR_PATTERNS = [/execution context was destroyed/i, /navigation/i, /detached frame/i];
const TRANSIENT_RETRY_DELAY_MS = 2000;

function isTransientError(err) {
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(err.message));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `district whoami` before booking (§ P3-T6 acceptance criteria). Returns
 * true if logged in. A confirmed auth failure (or a clean `logged_in: false`
 * response) means "not logged in"; a transient navigation-race error gets
 * one retry before falling back to "not logged in".
 */
export async function isLoggedIn(job) {
  try {
    const result = await checkDistrictLogin(job.id);
    return Boolean(result?.logged_in);
  } catch (err) {
    if (isTransientError(err)) {
      logger.info({ event: 'district.whoami_transient_retry', jobId: job.id, message: err.message });
      await delay(TRANSIENT_RETRY_DELAY_MS);
      try {
        const retryResult = await checkDistrictLogin(job.id);
        return Boolean(retryResult?.logged_in);
      } catch (retryErr) {
        logger.info({ event: 'district.whoami_failed', jobId: job.id, message: retryErr.message });
        return false;
      }
    }
    logger.info({ event: 'district.whoami_failed', jobId: job.id, message: err.message });
    return false;
  }
}

export async function triggerLogin(job) {
  await triggerDistrictLogin(job.id);
}

// Heuristic OTP/CAPTCHA interstitial detection via generic page state
// (§ P3-T6 notes: "use `webcmd browser <session> state` to detect
// interstitials"). Sandbox caveat: unverified against a live OTP/CAPTCHA
// screen (network unreachable here — see district.js's resolveShowArgs
// comment for the same limitation); the keyword heuristic below is a
// best-effort pattern match on the page's visible text, not a confirmed
// District-specific selector.
const INTERSTITIAL_PATTERNS = [
  { pattern: /\botp\b/i, instruction: 'Enter the OTP shown in the browser window, then press Resume.' },
  { pattern: /captcha/i, instruction: 'Solve the CAPTCHA in the browser window, then press Resume.' },
  {
    pattern: /verify.*(phone|mobile|number)/i,
    instruction: 'Verify your phone number in the browser window, then press Resume.',
  },
];

export async function detectInterstitial(job) {
  let state;
  try {
    state = await webcmdExec({
      adapter: 'browser',
      command: config.WEBCMD_SESSION,
      args: ['state'],
      jobId: job.id,
      step: job.current_step,
    });
  } catch (err) {
    // State inspection failing is not itself an interstitial — surfacing an
    // AutomationError from a diagnostic read would be worse than skipping it.
    logger.warn({ event: 'detect_interstitial.state_failed', jobId: job.id, message: err.message });
    return null;
  }

  const pageText = JSON.stringify(state ?? {});
  for (const { pattern, instruction } of INTERSTITIAL_PATTERNS) {
    if (pattern.test(pageText)) {
      return instruction;
    }
  }
  return null;
}
