const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, `../.env.${process.env.NODE_ENV || 'development'}`)
});

const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '../database/sports.db');

const db = new Database(dbPath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

module.exports = db;
