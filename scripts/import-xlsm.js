const path = require('path');
const xlsx = require('xlsx');
const db = require('../server/db');

const filePath = process.argv[2] || '/mnt/d/SportsAcademy/Badminton_Academy_SUPERVISOR_MASTER_COMPLETE2.xlsm';

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function toIsoDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function sheetToRows(sheet, minHeaders = 2) {
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true });
  let headerRowIndex = -1;
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const nonEmpty = row.filter((v) => v !== undefined && v !== null && String(v).trim() !== '');
    if (nonEmpty.length >= minHeaders) {
      headerRowIndex = i;
      break;
    }
  }
  if (headerRowIndex === -1) return { headers: [], data: [] };
  const headers = (rows[headerRowIndex] || []).map(normalizeHeader);
  const data = [];
  for (let i = headerRowIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];
    if (!row.some((v) => v !== undefined && v !== null && String(v).trim() !== '')) continue;
    const record = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      record[h] = row[idx];
    });
    data.push(record);
  }
  return { headers, data };
}

function getCell(record, ...keys) {
  for (const key of keys) {
    const normalized = normalizeHeader(key);
    if (record[normalized] !== undefined) return record[normalized];
  }
  return null;
}

function upsertLocations(records) {
  const stmt = db.prepare(`
    INSERT INTO locations (id, name)
    VALUES (@id, @name)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      updated_at = CURRENT_TIMESTAMP
  `);
  const tx = db.transaction((items) => items.forEach((item) => stmt.run(item)));
  tx(records);
}

function upsertClasses(records) {
  const stmt = db.prepare(`
    INSERT INTO classes (id, name, status, location_id, day, court)
    VALUES (@id, @name, @status, @location_id, @day, @court)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      status = excluded.status,
      location_id = excluded.location_id,
      day = excluded.day,
      court = excluded.court,
      updated_at = CURRENT_TIMESTAMP
  `);
  const tx = db.transaction((items) => items.forEach((item) => stmt.run(item)));
  tx(records);
}

function upsertCoaches(records) {
  const stmt = db.prepare(`
    INSERT INTO coaches (id, name, phone, status)
    VALUES (@id, @name, @phone, @status)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      phone = excluded.phone,
      status = excluded.status,
      updated_at = CURRENT_TIMESTAMP
  `);
  const tx = db.transaction((items) => items.forEach((item) => stmt.run(item)));
  tx(records);
}

function upsertPlayers(records) {
  const stmt = db.prepare(`
    INSERT INTO players (id, name, class_id, level, status, parent_name, parent_phone, start_date, payment_status)
    VALUES (@id, @name, @class_id, @level, @status, @parent_name, @parent_phone, @start_date, @payment_status)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      class_id = excluded.class_id,
      level = excluded.level,
      status = excluded.status,
      parent_name = excluded.parent_name,
      parent_phone = excluded.parent_phone,
      start_date = excluded.start_date,
      payment_status = excluded.payment_status,
      updated_at = CURRENT_TIMESTAMP
  `);
  const tx = db.transaction((items) => items.forEach((item) => stmt.run(item)));
  tx(records);
}

function insertRegistrations(records) {
  const stmt = db.prepare(`
    INSERT INTO registrations (player_id, class_id, start_date, parent_name, parent_phone, payment_plan, payment_status, notes)
    VALUES (@player_id, @class_id, @start_date, @parent_name, @parent_phone, @payment_plan, @payment_status, @notes)
  `);
  const tx = db.transaction((items) => items.forEach((item) => stmt.run(item)));
  tx(records);
}

function insertAttendance(records) {
  const stmt = db.prepare(`
    INSERT INTO attendance_log (date, year_month, location_id, class_id, coach_id, slot, player_id, player_name, present, late, remarks)
    VALUES (@date, @year_month, @location_id, @class_id, @coach_id, @slot, @player_id, @player_name, @present, @late, @remarks)
  `);
  const tx = db.transaction((items) => items.forEach((item) => stmt.run(item)));
  tx(records);
}

function insertAssessments(records) {
  const stmt = db.prepare(`
    INSERT INTO assessment_log (date, year_month, location_id, class_id, coach_id, slot, player_id, player_name, footwork, serve, smash, defense, stamina, remarks)
    VALUES (@date, @year_month, @location_id, @class_id, @coach_id, @slot, @player_id, @player_name, @footwork, @serve, @smash, @defense, @stamina, @remarks)
  `);
  const tx = db.transaction((items) => items.forEach((item) => stmt.run(item)));
  tx(records);
}

function run() {
  const workbook = xlsx.readFile(filePath, { cellDates: true });

  const locationsSheet = workbook.Sheets.LOCATIONS;
  if (locationsSheet) {
    const { data } = sheetToRows(locationsSheet, 2);
    const locations = data
      .map((row) => ({
        id: getCell(row, 'LocationID', 'Location Id', 'Location'),
        name: getCell(row, 'Location Name', 'LocationName', 'Name')
      }))
      .filter((row) => row.id && row.name);
    if (locations.length) upsertLocations(locations);
  }

  const classesSheet = workbook.Sheets.CLASSES;
  if (classesSheet) {
    const { data } = sheetToRows(classesSheet, 3);
    const classes = data
      .map((row) => ({
        id: getCell(row, 'ClassID', 'Class Id'),
        name: getCell(row, 'Class Name', 'ClassName'),
        status: getCell(row, 'Status'),
        location_id: getCell(row, 'Location', 'LocationID'),
        day: getCell(row, 'Day'),
        court: getCell(row, 'Court')
      }))
      .filter((row) => row.id && row.name);
    if (classes.length) upsertClasses(classes);
  }

  const coachesSheet = workbook.Sheets.COACHES;
  if (coachesSheet) {
    const { data } = sheetToRows(coachesSheet, 3);
    const coaches = data
      .map((row) => ({
        id: getCell(row, 'CoachID', 'Coach Id'),
        name: getCell(row, 'Coach Name', 'CoachName'),
        phone: getCell(row, 'Phone'),
        status: getCell(row, 'Status')
      }))
      .filter((row) => row.id && row.name);
    if (coaches.length) upsertCoaches(coaches);
  }

  const playersSheet = workbook.Sheets.PLAYERS;
  if (playersSheet) {
    const { data } = sheetToRows(playersSheet, 3);
    const players = data
      .map((row) => ({
        id: getCell(row, 'PlayerID', 'Player Id'),
        name: getCell(row, 'Player Name', 'PlayerName'),
        class_id: getCell(row, 'ClassID', 'Class Id'),
        level: getCell(row, 'Level'),
        status: getCell(row, 'Status'),
        parent_name: getCell(row, 'Parent Name', 'ParentName'),
        parent_phone: getCell(row, 'Parent Phone', 'ParentPhone'),
        start_date: toIsoDate(getCell(row, 'Start Date', 'StartDate')),
        payment_status: getCell(row, 'Payment Status', 'PaymentStatus')
      }))
      .filter((row) => row.id && row.name);
    if (players.length) upsertPlayers(players);
  }

  const registrationsSheet = workbook.Sheets.PLAYER_REGISTRATION;
  if (registrationsSheet) {
    const { data } = sheetToRows(registrationsSheet, 3);
    const registrations = data
      .map((row) => ({
        player_id: getCell(row, 'PlayerID', 'Player Id'),
        class_id: getCell(row, 'ClassID', 'Class Id'),
        start_date: toIsoDate(getCell(row, 'Start Date', 'StartDate')),
        parent_name: getCell(row, 'Parent Name', 'ParentName'),
        parent_phone: getCell(row, 'Parent Phone', 'ParentPhone'),
        payment_plan: getCell(row, 'Payment Plan', 'PaymentPlan'),
        payment_status: getCell(row, 'Payment Status', 'PaymentStatus'),
        notes: getCell(row, 'Notes')
      }))
      .filter((row) => row.player_id && row.class_id);
    if (registrations.length) insertRegistrations(registrations);
  }

  const attendanceSheet = workbook.Sheets.ATTENDANCE_LOG;
  if (attendanceSheet) {
    const { data } = sheetToRows(attendanceSheet, 5);
    const attendance = data
      .map((row) => ({
        date: toIsoDate(getCell(row, 'Date')),
        year_month: getCell(row, 'YearMonth', 'Year Month'),
        location_id: getCell(row, 'LocationID', 'Location Id'),
        class_id: getCell(row, 'ClassID', 'Class Id'),
        coach_id: getCell(row, 'CoachID', 'Coach Id'),
        slot: getCell(row, 'Slot'),
        player_id: getCell(row, 'PlayerID', 'Player Id'),
        player_name: getCell(row, 'PlayerName', 'Player Name'),
        present: getCell(row, 'Present'),
        late: getCell(row, 'Late'),
        remarks: getCell(row, 'Remarks')
      }))
      .filter((row) => row.date && row.player_id);
    if (attendance.length) insertAttendance(attendance);
  }

  const assessmentSheet = workbook.Sheets.ASSESSMENT_LOG;
  if (assessmentSheet) {
    const { data } = sheetToRows(assessmentSheet, 5);
    const assessments = data
      .map((row) => ({
        date: toIsoDate(getCell(row, 'Date')),
        year_month: getCell(row, 'YearMonth', 'Year Month'),
        location_id: getCell(row, 'LocationID', 'Location Id'),
        class_id: getCell(row, 'ClassID', 'Class Id'),
        coach_id: getCell(row, 'CoachID', 'Coach Id'),
        slot: getCell(row, 'Slot'),
        player_id: getCell(row, 'PlayerID', 'Player Id'),
        player_name: getCell(row, 'PlayerName', 'Player Name'),
        footwork: getCell(row, 'Footwork'),
        serve: getCell(row, 'Serve'),
        smash: getCell(row, 'Smash'),
        defense: getCell(row, 'Defense'),
        stamina: getCell(row, 'Stamina'),
        remarks: getCell(row, 'Remarks')
      }))
      .filter((row) => row.date && row.player_id);
    if (assessments.length) insertAssessments(assessments);
  }

  console.log('✅ Import complete');
}

run();
