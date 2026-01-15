const crypto = require('crypto');

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();

function createSession(user) {
  const id = crypto.randomUUID();
  sessions.set(id, {
    user,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  return id;
}

function getSession(sessionId) {
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return session.user;
}

function destroySession(sessionId) {
  sessions.delete(sessionId);
}

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  cookieHeader.split(';').forEach((pair) => {
    const [rawKey, ...rest] = pair.split('=');
    const key = rawKey?.trim();
    if (!key) return;
    cookies[key] = decodeURIComponent(rest.join('=').trim());
  });
  return cookies;
}

function getSessionFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return getSession(cookies.sa_session);
}

module.exports = {
  SESSION_TTL_MS,
  createSession,
  destroySession,
  getSessionFromRequest
};
