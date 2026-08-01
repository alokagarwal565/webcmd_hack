// server/adapters/booking/webcmdExec.js — the ONE wrapper every webcmd call
// goes through (§14.2). Verified behaviour of webcmd@0.5.2:
//   - success: `-f json` prints a clean JSON array/object to stdout.
//   - failure: stdout/stderr is a human-readable YAML error block (NOT
//     JSON), even with `-f json` — so the failure path below classifies
//     from the exit code and raw text, and never attempts JSON.parse on it.
//
// Windows note (verified on this machine): npm installs `webcmd` globally as
// a `.cmd` shim. `execFile('webcmd.cmd', argv)` without a shell fails with
// EINVAL — Windows can only run `.cmd` files through `cmd.exe`. Using
// `execFile(..., {shell: true})` was tested and is UNSAFE here: an argument
// containing `&` reached cmd.exe as a real command separator and executed,
// despite being a single array element (confirmed by writing a canary file
// with `district search "a & echo INJECTED > x.txt"`). The safe fix is to
// bypass the `.cmd` shim entirely and invoke the shim's own target — the
// package's real Node entry point — directly with `node <entry> [...argv]`,
// which never touches a shell. POSIX is unaffected: `webcmd` there is a
// shebang script that `execFile` runs directly without a shell.
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../../config.js';
import { AppError } from '../../lib/AppError.js';
import { logger } from '../../lib/logger.js';

const REDACT_FLAG_PATTERN = /^--?(.*-)?(token|secret|password|auth)([-=].*)?$/i;

// Redacts the VALUE following a sensitive-looking flag, not flag names
// themselves — a naive per-element match on `/key/i` would also redact
// harmless flags like `--city-key` or `--content-id`, which is worse than
// useless (it destroys the audit log for ordinary calls). None of the
// verified district commands actually take a secret as a CLI argument
// (auth is a persisted browser session), but this stays as the safety net
// §14.2 calls for.
function scrubArgv(argv) {
  return argv.map((value, i) => {
    const prev = argv[i - 1];
    if (typeof prev === 'string' && REDACT_FLAG_PATTERN.test(prev)) return '[REDACTED]';
    return value;
  });
}

// Resolves the real Node entry point behind the `webcmd` global .cmd shim,
// by reading @agentrhq/webcmd's own package.json "bin" field out of the
// global npm root — never by parsing or shelling out to the .cmd file
// itself. Cached for the process lifetime; returns null if resolution fails
// (e.g. a non-default WEBCMD_BIN, or a layout this heuristic doesn't cover),
// in which case callers fail loudly rather than falling back to a shell.
let cachedWindowsEntry;
function resolveWindowsEntryPoint() {
  if (cachedWindowsEntry !== undefined) return cachedWindowsEntry;
  try {
    // npm itself is also a `.cmd` shim on Windows, which cannot be spawned
    // without a shell at all (EINVAL). `shell: true` is safe ONLY here
    // because every argument is a fixed constant, never user-controlled
    // input — the injection risk that rules out `shell: true` elsewhere in
    // this file does not apply to a hardcoded `npm root -g`.
    const globalRoot = execFileSync('npm', ['root', '-g'], {
      encoding: 'utf8',
      timeout: 10_000,
      shell: process.platform === 'win32',
    }).trim();
    const pkgDir = join(globalRoot, '@agentrhq', 'webcmd');
    const pkgJsonPath = join(pkgDir, 'package.json');
    if (!existsSync(pkgJsonPath)) {
      cachedWindowsEntry = null;
      return null;
    }
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
    const binField = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.webcmd;
    if (!binField) {
      cachedWindowsEntry = null;
      return null;
    }
    cachedWindowsEntry = join(pkgDir, binField);
    return cachedWindowsEntry;
  } catch {
    cachedWindowsEntry = null;
    return null;
  }
}

function buildInvocation(bin, argv) {
  if (process.platform === 'win32') {
    const entry = resolveWindowsEntryPoint();
    if (entry) return { file: process.execPath, args: [entry, ...argv] };
    return null; // caller raises RUNTIME_UNAVAILABLE
  }
  return { file: bin, args: argv };
}

function run(file, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        exitCode: error ? (typeof error.code === 'number' ? error.code : 1) : 0,
        timedOut: Boolean(error?.killed || error?.signal === 'SIGTERM'),
        stdout: stdout ?? '',
        stderr: stderr ?? '',
      });
    });
  });
}

/**
 * Invokes `webcmd <adapter> <command> [...args] -f json --window <mode>`.
 * ALWAYS an argument array, NEVER a shell string (§14.2, §21.1 rule 3) — no
 * shell metacharacter in a movie title or seat label can ever be interpreted.
 *
 * `browser` must be true only for commands that drive an actual browser tab
 * (verified per-command in §14.1: showtimes/seats/checkout/set-location/login)
 * — `--window` is not a recognized flag on the non-browser read commands
 * (search/locations/whoami), and passing it there is a hard CLI error.
 *
 * @param {{adapter: string, command: string, args?: string[], timeoutMs?: number, browser?: boolean, window?: 'background'|'foreground', jobId?: string, step?: string}} opts
 * @returns {Promise<any>} the parsed JSON output
 */
export async function webcmdExec({ adapter, command, args = [], timeoutMs, browser = false, window, jobId, step }) {
  const effectiveTimeout = timeoutMs ?? config.AUTOMATION_STEP_TIMEOUT;
  const argv = [
    adapter,
    command,
    ...args,
    '-f',
    'json',
    ...(browser ? ['--window', window ?? config.WEBCMD_WINDOW] : []),
  ];

  const invocation = buildInvocation(config.WEBCMD_BIN, argv);
  if (!invocation) {
    throw new AppError(
      'RUNTIME_UNAVAILABLE',
      `Could not resolve the webcmd executable ("${config.WEBCMD_BIN}") on this platform. Run "webcmd doctor".`,
      503
    );
  }

  const startedAt = Date.now();
  const { exitCode, timedOut, stdout, stderr } = await run(invocation.file, invocation.args, effectiveTimeout);
  const durationMs = Date.now() - startedAt;

  logger.info({
    event: 'webcmd.exec',
    jobId,
    step,
    command: `${adapter} ${command}`,
    argv: scrubArgv(argv),
    exitCode,
    durationMs,
  });

  if (timedOut) {
    throw new AppError(
      'RUNTIME_UNAVAILABLE',
      `webcmd ${adapter} ${command} exceeded its ${effectiveTimeout}ms timeout`,
      503
    );
  }
  if (exitCode !== 0) {
    const detail = (stderr || stdout || '').trim().slice(0, 500);
    throw new AppError('ADAPTER_MISMATCH', `webcmd ${adapter} ${command} exited ${exitCode}: ${detail}`, 502);
  }

  try {
    return JSON.parse(stdout);
  } catch {
    throw new AppError(
      'ADAPTER_MISMATCH',
      `webcmd ${adapter} ${command} returned unparseable JSON: ${stdout.slice(0, 200)}`,
      502
    );
  }
}
