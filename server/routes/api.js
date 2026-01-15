const express = require('express');
const db = require('../db');

const router = express.Router();

function parseDateOnly(value) {
  if (!value) return null;
  let normalized = String(value).trim();
  const slashMatch = normalized.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  if (slashMatch) {
    const [, dd, mm, yyyy] = slashMatch;
    normalized = `${yyyy}-${mm}-${dd}`;
  }
  const date = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayMatches(value, weekday) {
  if (!value) return true;
  const day = String(value).trim().slice(0, 3).toLowerCase();
  const map = {
    sun: 0,
    mon: 1,
    tue: 2,
    wed: 3,
    thu: 4,
    fri: 5,
    sat: 6
  };
  if (map[day] === undefined) return true;
  return map[day] === weekday;
}

router.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

router.get('/locations', (req, res) => {
  const rows = db.prepare('SELECT * FROM locations ORDER BY id').all();
  res.json(rows);
});

router.get('/session-blackouts', (req, res) => {
  const rows = db.prepare(`
    SELECT sb.*, l.name AS location_name
    FROM session_blackouts sb
    LEFT JOIN locations l ON l.id = sb.location_id
    ORDER BY sb.start_date DESC, sb.id DESC
  `).all();
  res.json(rows);
});

router.post('/session-blackouts', (req, res) => {
  const { start_date, end_date, reason, location_id } = req.body || {};
  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'Date range required' });
  }
  db.prepare(`
    INSERT INTO session_blackouts (start_date, end_date, reason, location_id)
    VALUES (?, ?, ?, ?)
  `).run(start_date, end_date, reason || null, location_id || null);

  const targetLocation = location_id || null;
  db.prepare(`
    UPDATE sessions
    SET status = 'Cancelled',
        notes = CASE
          WHEN notes LIKE '%Cancelled: blackout%' THEN notes
          WHEN notes IS NULL OR notes = '' THEN 'Cancelled: blackout'
          ELSE notes || ' | Cancelled: blackout'
        END,
        updated_at = CURRENT_TIMESTAMP
    WHERE date BETWEEN ? AND ?
      AND (? IS NULL OR location_id = ?)
  `).run(start_date, end_date, targetLocation, targetLocation);

  return res.json({ ok: true });
});

router.delete('/session-blackouts/:id', (req, res) => {
  db.prepare('DELETE FROM session_blackouts WHERE id = ?').run(req.params.id);
  return res.json({ ok: true });
});

router.post('/locations', (req, res) => {
  const { id, name } = req.body || {};
  if (!id || !name) {
    return res.status(400).json({ error: 'Location ID and name required' });
  }
  db.prepare(`
    INSERT INTO locations (id, name)
    VALUES (?, ?)
  `).run(id, name);
  return res.json({ ok: true });
});

router.put('/locations/:id', (req, res) => {
  const { name } = req.body || {};
  if (!name) {
    return res.status(400).json({ error: 'Location name required' });
  }
  db.prepare(`
    UPDATE locations
    SET name = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(name, req.params.id);
  return res.json({ ok: true });
});

router.delete('/locations/:id', (req, res) => {
  db.prepare(`DELETE FROM locations WHERE id = ?`).run(req.params.id);
  return res.json({ ok: true });
});

router.get('/classes', (req, res) => {
  const rows = db.prepare(`
    SELECT c.*, l.name AS location_name
    FROM classes c
    LEFT JOIN locations l ON l.id = c.location_id
    ORDER BY c.id
  `).all();
  res.json(rows);
});

router.post('/classes', (req, res) => {
  const { id, name, status, location_id, day, court } = req.body || {};
  if (!id || !name || !location_id) {
    return res.status(400).json({ error: 'Batch ID, name, and location required' });
  }
  db.prepare(`
    INSERT INTO classes (id, name, status, location_id, day, court)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, name, status || null, location_id || null, day || null, court || null);
  return res.json({ ok: true });
});

router.put('/classes/:id', (req, res) => {
  const { name, status, location_id, day, court } = req.body || {};
  if (!name || !location_id) {
    return res.status(400).json({ error: 'Batch name and location required' });
  }
  db.prepare(`
    UPDATE classes
    SET name = ?, status = ?, location_id = ?, day = ?, court = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(name, status || null, location_id || null, day || null, court || null, req.params.id);
  return res.json({ ok: true });
});

router.delete('/classes/:id', (req, res) => {
  db.prepare(`DELETE FROM classes WHERE id = ?`).run(req.params.id);
  return res.json({ ok: true });
});

router.get('/coaches', (req, res) => {
  const rows = db.prepare('SELECT * FROM coaches ORDER BY id').all();
  res.json(rows);
});

router.post('/coaches', (req, res) => {
  const { id, name, phone, status } = req.body || {};
  if (!id || !name) {
    return res.status(400).json({ error: 'Coach ID and name required' });
  }
  db.prepare(`
    INSERT INTO coaches (id, name, phone, status)
    VALUES (?, ?, ?, ?)
  `).run(id, name, phone || null, status || null);
  return res.json({ ok: true });
});

router.put('/coaches/:id', (req, res) => {
  const { name, phone, status } = req.body || {};
  db.prepare(`
    UPDATE coaches
    SET name = ?, phone = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(name, phone || null, status || null, req.params.id);
  return res.json({ ok: true });
});

router.delete('/coaches/:id', (req, res) => {
  db.prepare(`DELETE FROM coaches WHERE id = ?`).run(req.params.id);
  return res.json({ ok: true });
});

router.get('/players', (req, res) => {
  const rows = db.prepare('SELECT * FROM players ORDER BY id').all();
  res.json(rows);
});

router.post('/players', (req, res) => {
  const {
    id,
    name,
    class_id,
    level,
    status,
    parent_name,
    parent_phone,
    start_date,
    payment_status
  } = req.body || {};
  if (!id || !name) {
    return res.status(400).json({ error: 'Player ID and name required' });
  }
  db.prepare(`
    INSERT INTO players (id, name, class_id, level, status, parent_name, parent_phone, start_date, payment_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    name,
    class_id || null,
    level || null,
    status || null,
    parent_name || null,
    parent_phone || null,
    start_date || null,
    payment_status || null
  );
  return res.json({ ok: true });
});

router.put('/players/:id', (req, res) => {
  const {
    name,
    class_id,
    level,
    status,
    parent_name,
    parent_phone,
    start_date,
    payment_status
  } = req.body || {};
  db.prepare(`
    UPDATE players
    SET name = ?, class_id = ?, level = ?, status = ?, parent_name = ?, parent_phone = ?, start_date = ?, payment_status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    name,
    class_id || null,
    level || null,
    status || null,
    parent_name || null,
    parent_phone || null,
    start_date || null,
    payment_status || null,
    req.params.id
  );
  return res.json({ ok: true });
});

router.delete('/players/:id', (req, res) => {
  db.prepare(`DELETE FROM players WHERE id = ?`).run(req.params.id);
  return res.json({ ok: true });
});

router.get('/registrations', (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, p.name AS player_name, c.name AS class_name
    FROM registrations r
    LEFT JOIN players p ON p.id = r.player_id
    LEFT JOIN classes c ON c.id = r.class_id
    ORDER BY r.id DESC
  `).all();
  res.json(rows);
});

router.post('/registrations', (req, res) => {
  const {
    player_id,
    class_id,
    plan_id,
    start_date,
    parent_name,
    parent_phone,
    payment_plan,
    payment_status,
    notes
  } = req.body || {};
  if (!player_id || !class_id || !plan_id) {
    return res.status(400).json({ error: 'Player, batch, and plan required' });
  }
  db.prepare(`
    INSERT INTO registrations (player_id, class_id, plan_id, start_date, parent_name, parent_phone, payment_plan, payment_status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    player_id,
    class_id,
    plan_id,
    start_date || null,
    parent_name || null,
    parent_phone || null,
    payment_plan || null,
    payment_status || null,
    notes || null
  );
  return res.json({ ok: true });
});

router.put('/registrations/:id', (req, res) => {
  const {
    player_id,
    class_id,
    plan_id,
    start_date,
    parent_name,
    parent_phone,
    payment_plan,
    payment_status,
    notes
  } = req.body || {};
  if (!player_id || !class_id || !plan_id) {
    return res.status(400).json({ error: 'Player, batch, and plan required' });
  }
  db.prepare(`
    UPDATE registrations
    SET player_id = ?, class_id = ?, plan_id = ?, start_date = ?, parent_name = ?, parent_phone = ?, payment_plan = ?, payment_status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    player_id,
    class_id,
    plan_id,
    start_date || null,
    parent_name || null,
    parent_phone || null,
    payment_plan || null,
    payment_status || null,
    notes || null,
    req.params.id
  );
  return res.json({ ok: true });
});

router.delete('/registrations/:id', (req, res) => {
  db.prepare(`DELETE FROM registrations WHERE id = ?`).run(req.params.id);
  return res.json({ ok: true });
});

router.get('/attendance', (req, res) => {
  const rows = db.prepare('SELECT * FROM attendance_log ORDER BY date DESC, id DESC').all();
  res.json(rows);
});

router.post('/attendance', (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [];
  if (!rows.length) {
    return res.status(400).json({ error: 'No attendance rows provided' });
  }
  const stmt = db.prepare(`
    INSERT INTO attendance_log (date, year_month, location_id, session_id, class_id, coach_id, slot, player_id, player_name, present, late, over_limit, remarks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((items) => {
    items.forEach((row) => {
      stmt.run(
        row.date || null,
        row.year_month || null,
        row.location_id || null,
        row.session_id || null,
        row.class_id || null,
        row.coach_id || null,
        row.slot || null,
        row.player_id || null,
        row.player_name || null,
        row.present ? 1 : 0,
        row.late ? 1 : 0,
        row.over_limit ? 1 : 0,
        row.remarks || null
      );
    });
  });
  tx(rows);
  return res.json({ ok: true, count: rows.length });
});

router.get('/assessments', (req, res) => {
  const rows = db.prepare('SELECT * FROM assessment_log ORDER BY date DESC, id DESC').all();
  res.json(rows);
});

router.get('/plans', (req, res) => {
  const rows = db.prepare('SELECT * FROM plans ORDER BY id').all();
  res.json(rows);
});

router.post('/plans', (req, res) => {
  const { name, type, sessions_per_week, price_monthly, price_per_session, status } = req.body || {};
  if (!name || !type) {
    return res.status(400).json({ error: 'Plan name and type required' });
  }
  db.prepare(`
    INSERT INTO plans (name, type, sessions_per_week, price_monthly, price_per_session, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    name,
    type,
    sessions_per_week ?? null,
    price_monthly ?? null,
    price_per_session ?? null,
    status || 'Active'
  );
  return res.json({ ok: true });
});

router.put('/plans/:id', (req, res) => {
  const { name, type, sessions_per_week, price_monthly, price_per_session, status } = req.body || {};
  db.prepare(`
    UPDATE plans
    SET name = ?, type = ?, sessions_per_week = ?, price_monthly = ?, price_per_session = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    name,
    type,
    sessions_per_week ?? null,
    price_monthly ?? null,
    price_per_session ?? null,
    status || 'Active',
    req.params.id
  );
  return res.json({ ok: true });
});

router.delete('/plans/:id', (req, res) => {
  db.prepare('DELETE FROM plans WHERE id = ?').run(req.params.id);
  return res.json({ ok: true });
});

router.get('/sessions', (req, res) => {
  const rows = db.prepare(`
    SELECT s.*, c.name AS class_name, co.name AS coach_name, l.name AS location_name
    FROM sessions s
    LEFT JOIN classes c ON c.id = s.class_id
    LEFT JOIN coaches co ON co.id = s.coach_id
    LEFT JOIN locations l ON l.id = s.location_id
    ORDER BY s.date DESC, s.id DESC
  `).all();
  res.json(rows);
});

router.get('/sessions/:id/participants', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM session_participants
    WHERE session_id = ?
    ORDER BY id DESC
  `).all(req.params.id);
  res.json(rows);
});

router.post('/sessions/:id/participants', (req, res) => {
  const { player_id, player_name } = req.body || {};
  let name = String(player_name || '').trim();
  if (!name && player_id) {
    const player = db.prepare('SELECT name FROM players WHERE id = ?').get(player_id);
    name = player?.name || '';
  }
  if (!name) {
    return res.status(400).json({ error: 'Student name required' });
  }
  if (player_id) {
    const exists = db.prepare(`
      SELECT COUNT(*) AS count FROM session_participants
      WHERE session_id = ? AND player_id = ?
    `).get(req.params.id, player_id).count;
    if (exists > 0) {
      return res.json({ ok: true });
    }
  }
  db.prepare(`
    INSERT INTO session_participants (session_id, player_id, player_name)
    VALUES (?, ?, ?)
  `).run(req.params.id, player_id || null, name);
  return res.json({ ok: true });
});

router.delete('/sessions/:id/participants/:participantId', (req, res) => {
  db.prepare('DELETE FROM session_participants WHERE id = ? AND session_id = ?')
    .run(req.params.participantId, req.params.id);
  return res.json({ ok: true });
});

router.post('/sessions/generate', (req, res) => {
  const { start_date, end_date, class_id, location_id } = req.body || {};
  const start = parseDateOnly(start_date);
  const end = parseDateOnly(end_date);
  if (!start || !end) {
    return res.status(400).json({ error: 'Start and end date required' });
  }
  if (end < start) {
    return res.status(400).json({ error: 'End date must be after start date' });
  }
  const ensureSystemClass = () => {
    const systemId = 'SYS-SESSION';
    const existing = db.prepare('SELECT id FROM classes WHERE id = ?').get(systemId);
    if (!existing) {
      db.prepare(`
        INSERT INTO classes (id, name, status, location_id, day, court)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(systemId, 'General Session', 'System', null, null, null);
    }
    return systemId;
  };
  const sessionClassId = class_id || ensureSystemClass();
  const targetLocationId = location_id || null;
  const blackouts = db.prepare(`
    SELECT start_date, end_date, location_id FROM session_blackouts
  `).all();
  const isBlocked = (dateStr, locationId) =>
    blackouts.some((b) =>
      dateStr >= b.start_date &&
      dateStr <= b.end_date &&
      (!b.location_id || b.location_id === locationId)
    );
  const slots = [
    { name: 'Session 1', time: '15.30-17.00' },
    { name: 'Session 2', time: '17.00-18.30' }
  ];
  let created = 0;
  let skipped = 0;
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const weekday = d.getDay();
    if (weekday === 4 || weekday === 5) {
      skipped += slots.length;
      continue;
    }
    const dateStr = formatDate(d);
    if (isBlocked(dateStr, targetLocationId)) {
      skipped += slots.length;
      continue;
    }
    slots.forEach((slot) => {
      const exists = db.prepare(`
        SELECT 1 FROM sessions
        WHERE date = ? AND time = ?
          AND (status IS NULL OR LOWER(status) != 'cancelled')
          AND ((location_id IS NULL AND ? IS NULL) OR location_id = ?)
      `).get(dateStr, slot.time, targetLocationId, targetLocationId);
      if (exists) {
        skipped += 1;
        return;
      }
      db.prepare(`
        INSERT INTO sessions (name, class_id, coach_id, location_id, date, time, court, notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        slot.name,
        sessionClassId,
        null,
        targetLocationId,
        dateStr,
        slot.time,
        null,
        'Auto-generated',
        'Active'
      );
      created += 1;
    });
  }
  return res.json({ ok: true, created, skipped });
});

router.post('/sessions', (req, res) => {
  const { name, class_id, coach_id, location_id, date, time, court, notes } = req.body || {};
  if (!name || !class_id || !date) {
    return res.status(400).json({ error: 'Session name, batch, and date required' });
  }
  const sessionDate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(sessionDate.getTime())) {
    return res.status(400).json({ error: 'Invalid session date' });
  }
  const weekday = sessionDate.getDay();
  if (weekday === 4 || weekday === 5) {
    return res.status(400).json({ error: 'Sessions are blocked on Thursday and Friday' });
  }
  const classLocation = db.prepare('SELECT location_id FROM classes WHERE id = ?')
    .get(class_id)?.location_id || null;
  const effectiveLocation = location_id || classLocation || null;
  const blocked = db.prepare(`
    SELECT COUNT(*) AS count
    FROM session_blackouts
    WHERE ? BETWEEN start_date AND end_date
      AND (location_id IS NULL OR location_id = ?)
  `).get(date, effectiveLocation).count;
  if (blocked > 0) {
    return res.status(400).json({ error: 'Sessions are blocked on this date' });
  }
  db.prepare(`
    INSERT INTO sessions (name, class_id, coach_id, location_id, date, time, court, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    class_id,
    coach_id || null,
    effectiveLocation,
    date,
    time || null,
    court || null,
    notes || null,
    'Active'
  );
  return res.json({ ok: true });
});

router.put('/sessions/:id', (req, res) => {
  const { name, class_id, coach_id, location_id, date, time, court, notes } = req.body || {};
  if (!name || !class_id || !date) {
    return res.status(400).json({ error: 'Session name, batch, and date required' });
  }
  const sessionDate = new Date(`${date}T00:00:00`);
  if (Number.isNaN(sessionDate.getTime())) {
    return res.status(400).json({ error: 'Invalid session date' });
  }
  const weekday = sessionDate.getDay();
  if (weekday === 4 || weekday === 5) {
    return res.status(400).json({ error: 'Sessions are blocked on Thursday and Friday' });
  }
  const classLocation = db.prepare('SELECT location_id FROM classes WHERE id = ?')
    .get(class_id)?.location_id || null;
  const effectiveLocation = location_id || classLocation || null;
  const blocked = db.prepare(`
    SELECT COUNT(*) AS count
    FROM session_blackouts
    WHERE ? BETWEEN start_date AND end_date
      AND (location_id IS NULL OR location_id = ?)
  `).get(date, effectiveLocation).count;
  if (blocked > 0) {
    return res.status(400).json({ error: 'Sessions are blocked on this date' });
  }
  db.prepare(`
    UPDATE sessions
    SET name = ?, class_id = ?, coach_id = ?, location_id = ?, date = ?, time = ?, court = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    name,
    class_id,
    coach_id || null,
    effectiveLocation,
    date,
    time || null,
    court || null,
    notes || null,
    req.params.id
  );
  return res.json({ ok: true });
});

router.delete('/sessions/:id', (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);
  return res.json({ ok: true });
});

router.get('/payments', (req, res) => {
  const rows = db.prepare(`
    SELECT p.*, r.player_id, r.class_id
    FROM payments p
    LEFT JOIN registrations r ON r.id = p.registration_id
    ORDER BY p.date DESC, p.id DESC
  `).all();
  res.json(rows);
});

router.post('/payments', (req, res) => {
  const { registration_id, amount, date, method, notes } = req.body || {};
  if (!registration_id || !amount || !date) {
    return res.status(400).json({ error: 'Registration, amount, and date required' });
  }
  db.prepare(`
    INSERT INTO payments (registration_id, amount, date, method, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(registration_id, amount, date, method || null, notes || null);
  return res.json({ ok: true });
});

router.post('/assessments', (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [];
  if (!rows.length) {
    return res.status(400).json({ error: 'No assessment rows provided' });
  }
  const stmt = db.prepare(`
    INSERT INTO assessment_log (date, year_month, location_id, class_id, coach_id, slot, player_id, player_name, footwork, serve, smash, defense, stamina, remarks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((items) => {
    items.forEach((row) => {
      stmt.run(
        row.date || null,
        row.year_month || null,
        row.location_id || null,
        row.class_id || null,
        row.coach_id || null,
        row.slot || null,
        row.player_id || null,
        row.player_name || null,
        row.footwork ?? null,
        row.serve ?? null,
        row.smash ?? null,
        row.defense ?? null,
        row.stamina ?? null,
        row.remarks || null
      );
    });
  });
  tx(rows);
  return res.json({ ok: true, count: rows.length });
});

router.get('/dashboard', (req, res) => {
  const totalStudents = db.prepare('SELECT COUNT(*) AS count FROM players').get().count;
  const activeClasses = db.prepare(`
    SELECT COUNT(*) AS count FROM classes WHERE LOWER(status) = 'active'
  `).get().count;
  const totalRevenue = db.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payments').get().total;
  res.json({
    totalStudents,
    activeClasses,
    totalRevenue,
    pendingFees: 0
  });
});

router.get('/activities', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM activities ORDER BY id DESC LIMIT 10
  `).all();
  res.json(rows);
});

router.post('/activities', (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }
  db.prepare('INSERT INTO activities (message) VALUES (?)').run(message);
  return res.json({ ok: true });
});

module.exports = router;
