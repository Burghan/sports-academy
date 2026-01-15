const db = require('./db');

db.exec(`
  CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS classes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT,
    location_id TEXT,
    day TEXT,
    court TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (location_id) REFERENCES locations(id)
  );

  CREATE TABLE IF NOT EXISTS coaches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    status TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    class_id TEXT,
    level TEXT,
    status TEXT,
    parent_name TEXT,
    parent_phone TEXT,
    start_date TEXT,
    payment_status TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (class_id) REFERENCES classes(id)
  );

  CREATE TABLE IF NOT EXISTS registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id TEXT,
    class_id TEXT,
    plan_id INTEGER,
    start_date TEXT,
    parent_name TEXT,
    parent_phone TEXT,
    payment_plan TEXT,
    payment_status TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES players(id),
    FOREIGN KEY (class_id) REFERENCES classes(id)
  );

  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    sessions_per_week INTEGER,
    price_monthly REAL,
    price_per_session REAL,
    status TEXT DEFAULT 'Active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    class_id TEXT NOT NULL,
    coach_id TEXT,
    location_id TEXT,
    date TEXT NOT NULL,
    time TEXT,
    court TEXT,
    notes TEXT,
    status TEXT DEFAULT 'Active',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (class_id) REFERENCES classes(id),
    FOREIGN KEY (coach_id) REFERENCES coaches(id),
    FOREIGN KEY (location_id) REFERENCES locations(id)
  );

  CREATE TABLE IF NOT EXISTS attendance_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    year_month TEXT,
    location_id TEXT,
    session_id INTEGER,
    class_id TEXT,
    coach_id TEXT,
    slot INTEGER,
    player_id TEXT,
    player_name TEXT,
    present INTEGER,
    late INTEGER,
    over_limit INTEGER,
    remarks TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS assessment_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    year_month TEXT,
    location_id TEXT,
    class_id TEXT,
    coach_id TEXT,
    slot INTEGER,
    player_id TEXT,
    player_name TEXT,
    footwork INTEGER,
    serve INTEGER,
    smash INTEGER,
    defense INTEGER,
    stamina INTEGER,
    remarks TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    registration_id INTEGER,
    amount REAL,
    date TEXT,
    method TEXT,
    notes TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (registration_id) REFERENCES registrations(id)
  );

  CREATE TABLE IF NOT EXISTS activities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS session_blackouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    reason TEXT,
    location_id TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS session_participants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    player_id TEXT,
    player_name TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL,
    pin TEXT NOT NULL,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance_log(date);
  CREATE INDEX IF NOT EXISTS idx_attendance_class ON attendance_log(class_id);
  CREATE INDEX IF NOT EXISTS idx_attendance_player ON attendance_log(player_id);
  CREATE INDEX IF NOT EXISTS idx_assessment_date ON assessment_log(date);
  CREATE INDEX IF NOT EXISTS idx_assessment_class ON assessment_log(class_id);
  CREATE INDEX IF NOT EXISTS idx_assessment_player ON assessment_log(player_id);
`);

const registrationColumns = db.prepare(`PRAGMA table_info(registrations)`).all();
if (!registrationColumns.some((col) => col.name === 'plan_id')) {
  db.prepare(`ALTER TABLE registrations ADD COLUMN plan_id INTEGER`).run();
}

const attendanceColumns = db.prepare(`PRAGMA table_info(attendance_log)`).all();
if (!attendanceColumns.some((col) => col.name === 'session_id')) {
  db.prepare(`ALTER TABLE attendance_log ADD COLUMN session_id INTEGER`).run();
}
if (!attendanceColumns.some((col) => col.name === 'over_limit')) {
  db.prepare(`ALTER TABLE attendance_log ADD COLUMN over_limit INTEGER`).run();
}

const sessionColumns = db.prepare(`PRAGMA table_info(sessions)`).all();
if (!sessionColumns.some((col) => col.name === 'name')) {
  db.prepare(`ALTER TABLE sessions ADD COLUMN name TEXT`).run();
}
if (!sessionColumns.some((col) => col.name === 'status')) {
  db.prepare(`ALTER TABLE sessions ADD COLUMN status TEXT DEFAULT 'Active'`).run();
}
db.prepare(`UPDATE sessions SET status = 'Active' WHERE status IS NULL`).run();

const blackoutColumns = db.prepare(`PRAGMA table_info(session_blackouts)`).all();
if (!blackoutColumns.some((col) => col.name === 'location_id')) {
  db.prepare(`ALTER TABLE session_blackouts ADD COLUMN location_id TEXT`).run();
}

const existingUsers = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
if (existingUsers === 0) {
  db.prepare(`
    INSERT INTO users (name, role, pin, active)
    VALUES (?, ?, ?, 1), (?, ?, ?, 1), (?, ?, ?, 1)
  `).run('Owner', 'admin', '1234', 'Supervisor', 'supervisor', '2222', 'Coach', 'coach', '1111');
}

const existingPlans = db.prepare('SELECT COUNT(*) AS count FROM plans').get().count;
if (existingPlans === 0) {
  db.prepare(`
    INSERT INTO plans (name, type, sessions_per_week, price_monthly, price_per_session, status)
    VALUES
      ('Regular 1x/week', 'regular', 1, 0, 0, 'Active'),
      ('Regular 2x/week', 'regular', 2, 0, 0, 'Active'),
      ('Regular 3x/week', 'regular', 3, 0, 0, 'Active'),
      ('Private', 'private', NULL, 0, 0, 'Active')
  `).run();
}

console.log('✅ Database initialized');
