const express = require('express');
const db = require('../db');
const { SESSION_TTL_MS, createSession, destroySession, getSessionFromRequest } = require('../session');

const router = express.Router();
const PIN_REGEX = /^\d{4,6}$/;

router.get('/me', (req, res) => {
  const user = getSessionFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return res.json(user);
});

router.post('/login', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const pin = String(req.body?.pin || '').trim();

  if (!name || !pin) {
    return res.status(400).json({ error: 'Name and PIN required' });
  }

  if (!PIN_REGEX.test(pin)) {
    return res.status(400).json({ error: 'PIN must be 4-6 digits' });
  }

  const user = db.prepare(`
    SELECT id, name, role
    FROM users
    WHERE LOWER(name) = LOWER(?) AND pin = ? AND active = 1
  `).get(name, pin);

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const sessionId = createSession(user);
  res.cookie('sa_session', sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS
  });

  return res.json(user);
});

router.post('/logout', (req, res) => {
  const user = getSessionFromRequest(req);
  if (user) {
    const cookie = req.headers.cookie || '';
    const match = cookie.match(/sa_session=([^;]+)/);
    if (match) destroySession(match[1]);
  }
  res.clearCookie('sa_session');
  return res.json({ ok: true });
});

module.exports = router;
