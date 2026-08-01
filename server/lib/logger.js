// Structured JSON logger — one object per line (§24.1).
// Redaction happens HERE, never at call sites (§24.3): any key matching
// /token|key|secret|password|authorization/i is replaced before serialization,
// recursively, so a leaked secret can never reach a log line by omission.

const REDACT_PATTERN = /token|key|secret|password|authorization/i;

function redact(value) {
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACT_PATTERN.test(k) ? '[REDACTED]' : redact(v);
    }
    return out;
  }
  return value;
}

function emit(level, fields) {
  const record = {
    ts: new Date().toISOString(),
    level,
    ...redact(fields),
  };
  const line = JSON.stringify(record);
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (fields) => emit('info', fields),
  warn: (fields) => emit('warn', fields),
  error: (fields) => emit('error', fields),
};
