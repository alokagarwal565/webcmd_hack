// Screenshots for the group's job timeline (§14.4, P3-T5). Best-effort and
// non-blocking by design: a screenshot is supplementary evidence for humans
// (per the webcmd-browser skill: "screenshots are for humans, not for
// agents"), never a correctness signal the booking depends on — a failed
// capture logs a warning and the automation continues; it never fails the
// job (§14.6-style graceful degradation).
//
// Verified via `webcmd browser --help` / `screenshot --help` /
// `tab --help`: `webcmd browser <session> tab list` enumerates open tabs
// with target ids; `webcmd browser <session> screenshot [path] --tab
// <targetId>` captures a specific one directly — no `bind` step needed for
// a one-off capture. district commands are invoked with `--keep-tab true`
// (see checkout.js) so the tab they used survives long enough to be found
// and captured here afterward.
// Sandbox caveat: this could not be exercised against a live browser tab —
// district.in is unreachable from this sandbox (same limitation documented
// in district.js's resolveShowArgs). The argv shapes below are verified
// against the CLI's own --help output; the end-to-end tab-discovery flow
// (tab list -> most recent target -> screenshot) is the documented pattern
// but untested live.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { webcmdExec } from '../../adapters/booking/webcmdExec.js';
import { config } from '../../config.js';
import { logJobEvent } from '../../services/jobService.js';
import { logger } from '../../lib/logger.js';

function screenshotDir(jobId) {
  const dir = join(process.cwd(), 'screenshots', jobId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

async function findMostRecentTargetId() {
  const tabs = await webcmdExec({
    adapter: 'browser',
    command: config.WEBCMD_SESSION,
    args: ['tab', 'list'],
  }).catch(() => []);
  if (!Array.isArray(tabs) || tabs.length === 0) return undefined;
  return tabs[tabs.length - 1]?.targetId;
}

/**
 * Captures a screenshot and links it as a JOB_EVENTS row. Never throws —
 * a capture failure is logged as a warning event and the function resolves
 * with null, so it can never block the booking it's documenting.
 * @param {object} job
 * @param {string} step - the job_events.step label this screenshot belongs to
 * @param {string} label - short human-readable description
 * @returns {Promise<string|null>} the saved file path, or null on failure
 */
export async function captureScreenshot(job, step, label) {
  try {
    const dir = screenshotDir(job.id);
    const filePath = join(dir, `${step}-${Date.now()}.png`);

    const targetId = await findMostRecentTargetId();
    const args = [filePath];
    if (targetId) args.push('--tab', targetId);

    await webcmdExec({
      adapter: 'browser',
      command: config.WEBCMD_SESSION,
      args: ['screenshot', ...args],
      jobId: job.id,
      step,
    });

    await logJobEvent(job.id, {
      step,
      level: 'info',
      message: label,
      screenshotPath: filePath,
    });
    return filePath;
  } catch (err) {
    logger.warn({ event: 'screenshot.failed', jobId: job.id, step, message: err.message });
    await logJobEvent(job.id, {
      step,
      level: 'warn',
      message: `Screenshot capture failed (non-blocking): ${err.message}`,
    });
    return null;
  }
}
