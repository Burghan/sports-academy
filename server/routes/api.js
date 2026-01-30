const express = require('express');
const db = require('../db');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const PIN_REGEX = /^\d{4,6}$/;
const ROLE_SET = new Set(['admin', 'owner', 'supervisor', 'coach']);

const paymentColumns = db.prepare(`PRAGMA table_info(payments)`).all();
if (!paymentColumns.some((col) => col.name === 'receipt_no')) {
  db.prepare(`ALTER TABLE payments ADD COLUMN receipt_no TEXT`).run();
}

function requireAdminOrOwner(req, res) {
  const role = String(req.user?.role || '').toLowerCase();
  if (role !== 'admin' && role !== 'owner') {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

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

router.get('/users', (req, res) => {
  if (!requireAdminOrOwner(req, res)) return;
  const rows = db.prepare(`
    SELECT id, name, role, active
    FROM users
    ORDER BY LOWER(name)
  `).all();
  res.json(rows);
});

router.post('/users', (req, res) => {
  if (!requireAdminOrOwner(req, res)) return;
  const name = String(req.body?.name || '').trim();
  const role = String(req.body?.role || '').trim().toLowerCase();
  const pin = String(req.body?.pin || '').trim();
  const active = req.body?.active === 0 || req.body?.active === false ? 0 : 1;

  if (!name || !role || !pin) {
    return res.status(400).json({ error: 'Name, role, and PIN required' });
  }

  if (!ROLE_SET.has(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  if (!PIN_REGEX.test(pin)) {
    return res.status(400).json({ error: 'PIN must be 4-6 digits' });
  }

  try {
    db.prepare(`
      INSERT INTO users (name, role, pin, active)
      VALUES (?, ?, ?, ?)
    `).run(name, role, pin, active);
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'User name already exists' });
    }
    return res.status(500).json({ error: 'Failed to create user' });
  }

  return res.json({ ok: true });
});

router.put('/users/:id', (req, res) => {
  if (!requireAdminOrOwner(req, res)) return;
  const id = req.params.id;
  const name = String(req.body?.name || '').trim();
  const role = String(req.body?.role || '').trim().toLowerCase();
  const pin = String(req.body?.pin || '').trim();
  const active = req.body?.active === 0 || req.body?.active === false ? 0 : 1;

  if (!name || !role) {
    return res.status(400).json({ error: 'Name and role required' });
  }

  if (!ROLE_SET.has(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  if (pin && !PIN_REGEX.test(pin)) {
    return res.status(400).json({ error: 'PIN must be 4-6 digits' });
  }

  try {
    db.prepare(`
      UPDATE users
      SET name = ?,
          role = ?,
          pin = COALESCE(NULLIF(?, ''), pin),
          active = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, role, pin || '', active, id);
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE')) {
      return res.status(409).json({ error: 'User name already exists' });
    }
    return res.status(500).json({ error: 'Failed to update user' });
  }

  return res.json({ ok: true });
});

router.delete('/users/:id', (req, res) => {
  if (!requireAdminOrOwner(req, res)) return;
  if (String(req.user?.id || '') === String(req.params.id)) {
    return res.status(400).json({ error: 'Cannot delete current user' });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  return res.json({ ok: true });
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

router.get('/players/export', async (req, res) => {
  const rows = db.prepare(`
    SELECT id, name, status, parent_name, parent_phone, start_date, payment_status
    FROM players
    ORDER BY id
  `).all();

  const dateLabel = new Date().toISOString().split('T')[0];
  const title = `Student List as of ${dateLabel}`;
  const subtitle = '2RSA Badminton Academy';
  const headerRow = [
    'No',
    'Player ID',
    'Player Name',
    'Status',
    'Parent',
    'Parent Phone',
    'Start Date',
    'Payment Status'
  ];

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Students');

  sheet.columns = [
    { key: 'no', width: 6 },
    { key: 'id', width: 12 },
    { key: 'name', width: 24 },
    { key: 'status', width: 12 },
    { key: 'parent', width: 18 },
    { key: 'phone', width: 16 },
    { key: 'start', width: 14 },
    { key: 'payment', width: 16 }
  ];

  sheet.mergeCells('C1:H1');
  sheet.mergeCells('C2:H2');
  sheet.getCell('C1').value = title;
  sheet.getCell('C2').value = subtitle;
  sheet.getRow(1).height = 28;
  sheet.getRow(2).height = 20;
  sheet.getRow(3).height = 8;

  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F4F7' } };
  const titleStyle = { bold: true, size: 16, color: { argb: 'FF1F2937' } };
  const subtitleStyle = { bold: true, size: 12, color: { argb: 'FF4B5563' } };

  sheet.getCell('C1').font = titleStyle;
  sheet.getCell('C2').font = subtitleStyle;
  sheet.getCell('C1').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell('C2').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell('C1').fill = headerFill;
  sheet.getCell('C2').fill = headerFill;

  sheet.mergeCells('A1:B3');
  sheet.getCell('A1').fill = headerFill;

  const logoPath = path.join(__dirname, '../../public/2rsa-logo.jpg');
  if (fs.existsSync(logoPath)) {
    const logoId = workbook.addImage({ filename: logoPath, extension: 'jpeg' });
    sheet.addImage(logoId, {
      tl: { col: 0.1, row: 0.1 },
      br: { col: 2.2, row: 2.9 }
    });
  }

  sheet.addRow([]);
  sheet.addRow(headerRow);
  const headerRowIndex = sheet.lastRow.number;
  sheet.getRow(headerRowIndex).font = { bold: true };
  sheet.getRow(headerRowIndex).alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(headerRowIndex).fill = headerFill;

  rows.forEach((row, index) => {
    sheet.addRow([
      index + 1,
      row.id || '',
      row.name || '',
      row.status || '',
      row.parent_name || '',
      row.parent_phone || '',
      row.start_date || '',
      row.payment_status || ''
    ]);
  });

  const buffer = await workbook.xlsx.writeBuffer();

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="students_${dateLabel}.xlsx"`);
  return res.send(buffer);
});

router.get('/reports/students-by-class', async (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.name, p.status, p.parent_name, p.parent_phone, p.start_date, p.payment_status,
           c.name AS class_name, p.class_id
    FROM players p
    LEFT JOIN classes c ON c.id = p.class_id
    ORDER BY p.id
  `).all();

  const dateLabel = new Date().toISOString().split('T')[0];
  const title = `Student List as of ${dateLabel}`;
  const subtitle = '2RSA Badminton Academy';
  const headerRow = [
    'No',
    'Player ID',
    'Player Name',
    'Status',
    'Parent',
    'Parent Phone',
    'Start Date',
    'Payment Status'
  ];

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Student List');

  sheet.columns = [
    { key: 'no', width: 6 },
    { key: 'id', width: 12 },
    { key: 'name', width: 24 },
    { key: 'status', width: 12 },
    { key: 'parent', width: 18 },
    { key: 'phone', width: 16 },
    { key: 'start', width: 14 },
    { key: 'payment', width: 16 }
  ];

  sheet.mergeCells('C1:H1');
  sheet.mergeCells('C2:H2');
  sheet.getCell('C1').value = title;
  sheet.getCell('C2').value = subtitle;
  sheet.getRow(1).height = 28;
  sheet.getRow(2).height = 20;
  sheet.getRow(3).height = 8;

  const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F4F7' } };
  const titleStyle = { bold: true, size: 16, color: { argb: 'FF1F2937' } };
  const subtitleStyle = { bold: true, size: 12, color: { argb: 'FF4B5563' } };

  sheet.getCell('C1').font = titleStyle;
  sheet.getCell('C2').font = subtitleStyle;
  sheet.getCell('C1').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell('C2').alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getCell('C1').fill = headerFill;
  sheet.getCell('C2').fill = headerFill;

  sheet.mergeCells('A1:B3');
  sheet.getCell('A1').fill = headerFill;

  const logoPath = path.join(__dirname, '../../public/2rsa-logo.jpg');
  if (fs.existsSync(logoPath)) {
    const logoId = workbook.addImage({ filename: logoPath, extension: 'jpeg' });
    sheet.addImage(logoId, {
      tl: { col: 0.1, row: 0.1 },
      br: { col: 2.2, row: 2.9 }
    });
  }

  sheet.addRow([]);
  sheet.addRow(headerRow);
  const headerRowIndex = sheet.lastRow.number;
  sheet.getRow(headerRowIndex).font = { bold: true };
  sheet.getRow(headerRowIndex).alignment = { horizontal: 'center', vertical: 'middle' };
  sheet.getRow(headerRowIndex).fill = headerFill;

  rows.forEach((row, index) => {
    sheet.addRow([
      index + 1,
      row.id || '',
      row.name || '',
      row.status || '',
      row.parent_name || '',
      row.parent_phone || '',
      row.start_date || '',
      row.payment_status || ''
    ]);
  });

  const buffer = await workbook.xlsx.writeBuffer();

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="students_${dateLabel}.xlsx"`);
  return res.send(buffer);
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
  const { registration_id, amount, date, method, notes, receipt_no } = req.body || {};
  if (!registration_id || !amount || !date) {
    return res.status(400).json({ error: 'Registration, amount, and date required' });
  }
  let finalReceipt = String(receipt_no || '').trim();
  if (!finalReceipt) {
    const row = db.prepare(`
      SELECT COALESCE(MAX(CAST(SUBSTR(receipt_no, 5) AS INTEGER)), 0) AS max_no
      FROM payments
      WHERE receipt_no LIKE 'RCP-%'
    `).get();
    const nextNo = (row?.max_no || 0) + 1;
    finalReceipt = `RCP-${String(nextNo).padStart(6, '0')}`;
  }
  db.prepare(`
    INSERT INTO payments (registration_id, amount, date, method, notes, receipt_no)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(registration_id, amount, date, method || null, notes || null, finalReceipt);
  return res.json({ ok: true });
});

router.put('/payments/:id', (req, res) => {
  const { registration_id, amount, date, method, notes, receipt_no } = req.body || {};
  if (!registration_id || !amount || !date) {
    return res.status(400).json({ error: 'Registration, amount, and date required' });
  }
  db.prepare(`
    UPDATE payments
    SET registration_id = ?, amount = ?, date = ?, method = ?, notes = ?,
        receipt_no = COALESCE(NULLIF(?, ''), receipt_no),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(registration_id, amount, date, method || null, notes || null, receipt_no || '', req.params.id);
  return res.json({ ok: true });
});

router.delete('/payments/:id', (req, res) => {
  db.prepare('DELETE FROM payments WHERE id = ?').run(req.params.id);
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
