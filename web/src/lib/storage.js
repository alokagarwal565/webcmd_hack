// Thin localStorage wrapper (§20.2). Organizer and participant tokens are
// NEVER placed in a URL — only stored here, keyed by session id.

const organizerKey = (sessionId) => `seatsync:organizer:${sessionId}`;
const participantKey = (sessionId) => `seatsync:participant:${sessionId}`;

export function saveOrganizerToken(sessionId, organizerToken) {
  localStorage.setItem(organizerKey(sessionId), organizerToken);
}

export function getOrganizerToken(sessionId) {
  return localStorage.getItem(organizerKey(sessionId));
}

export function saveParticipant(sessionId, { participantId, displayName, participantToken }) {
  localStorage.setItem(
    participantKey(sessionId),
    JSON.stringify({ participantId, displayName, participantToken })
  );
}

export function getParticipant(sessionId) {
  const raw = localStorage.getItem(participantKey(sessionId));
  return raw ? JSON.parse(raw) : null;
}
