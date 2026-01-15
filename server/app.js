const path = require('path');
const express = require('express');

require('dotenv').config({
  path: path.join(__dirname, `../.env.${process.env.NODE_ENV || 'development'}`)
});

const apiRoutes = require('./routes/api');
const authRoutes = require('./routes/auth');
const { getSessionFromRequest } = require('./session');

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/api/auth', authRoutes);

app.use('/api', (req, res, next) => {
  if (req.path === '/health') return next();
  const user = getSessionFromRequest(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = user;
  if (String(user.role).toLowerCase() === 'coach') {
    const allowedPost = ['/attendance', '/assessments'];
    const allowedGet = [
      '/classes',
      '/coaches',
      '/players',
      '/registrations',
      '/attendance',
      '/assessments',
      '/sessions',
      '/locations',
      '/session-blackouts',
      '/dashboard',
      '/plans',
      '/activities'
    ];
    if (req.method !== 'GET' && !allowedPost.includes(req.path)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const isSessionParticipants = req.path.startsWith('/sessions/') && req.path.endsWith('/participants');
    if (req.method === 'GET' && !allowedGet.includes(req.path) && !isSessionParticipants) {
      return res.status(403).json({ error: 'Forbidden' });
    }
  }
  return next();
});

app.use('/api', apiRoutes);

app.use((req, res, next) => {
  if (req.path === '/login.html' || req.path.startsWith('/api')) {
    return next();
  }
  if (req.path === '/' || req.path.endsWith('.html')) {
    const user = getSessionFromRequest(req);
    if (!user) {
      return res.redirect('/login.html');
    }
  }
  return next();
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(port, () => {
  console.log(`Sports Academy app running on http://localhost:${port}`);
});
