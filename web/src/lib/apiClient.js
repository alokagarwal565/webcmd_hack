// Single centralized API client (§11.1). Every request goes through here so
// base URL, JSON handling, and token headers are never duplicated per call site.

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

/**
 * @param {string} path - e.g. '/api/sessions'
 * @param {object} [opts]
 * @param {string} [opts.method]
 * @param {object} [opts.body]
 * @param {string} [opts.organizerToken]
 * @param {string} [opts.participantToken]
 */
export async function apiFetch(path, opts = {}) {
  const { method = 'GET', body, organizerToken, participantToken } = opts;

  const headers = { 'Content-Type': 'application/json' };
  if (organizerToken) headers['X-Organizer-Token'] = organizerToken;
  if (participantToken) headers['X-Participant-Token'] = participantToken;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const requestId = res.headers.get('X-Request-Id');
  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const error = data?.error || { code: 'UNKNOWN_ERROR', message: 'Request failed.' };
    const err = new Error(error.message);
    err.code = error.code;
    err.status = res.status;
    err.requestId = requestId;
    throw err;
  }

  return data;
}

export const apiClient = {
  get: (path, opts) => apiFetch(path, { ...opts, method: 'GET' }),
  post: (path, body, opts) => apiFetch(path, { ...opts, method: 'POST', body }),
  put: (path, body, opts) => apiFetch(path, { ...opts, method: 'PUT', body }),
};
