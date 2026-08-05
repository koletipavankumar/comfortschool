const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const sqlite3 = require('sqlite3').verbose();

const useMySql = Boolean(process.env.MYSQL_HOST || process.env.MYSQL_URL || process.env.MYSQL_DATABASE);
const dbPath = path.join(__dirname, 'data', 'school.db');
let sqliteDb = null;
let pool = null;

function createSqliteDb() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  sqliteDb = new sqlite3.Database(dbPath);
}

async function createMySqlPool() {
  const mysqlUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;
  const mysqlConfig = {
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'comfort_school',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4_unicode_ci'
  };

  if (mysqlUrl) {
    const parsed = new URL(mysqlUrl);
    mysqlConfig.host = parsed.hostname || mysqlConfig.host;
    mysqlConfig.port = parseInt(parsed.port || mysqlConfig.port, 10);
    mysqlConfig.user = parsed.username || mysqlConfig.user;
    mysqlConfig.password = parsed.password || mysqlConfig.password;
    mysqlConfig.database = parsed.pathname.replace(/^\//, '') || mysqlConfig.database;
  }

  pool = mysql.createPool(mysqlConfig);
  await pool.execute('SELECT 1');
}

async function connectDb() {
  if (useMySql) {
    await createMySqlPool();
  } else {
    createSqliteDb();
  }
}

async function query(sql, params = []) {
  if (useMySql) {
    const [rows] = await pool.execute(sql, params);
    return rows;
  }

  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function dbRun(sql, params = []) {
  if (useMySql) {
    const [result] = await pool.execute(sql, params);
    return result;
  }

  return new Promise((resolve, reject) => {
    sqliteDb.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

async function dbGet(sql, params = []) {
  const rows = await query(sql, params);
  if (!Array.isArray(rows)) return rows;
  return rows[0] || null;
}

async function dbAll(sql, params = []) {
  return query(sql, params);
}

function isMySql() {
  return useMySql;
}

function isSqliteFallback() {
  return !useMySql;
}

module.exports = {
  connectDb,
  dbRun,
  dbGet,
  dbAll,
  isMySql,
  isSqliteFallback,
  dbPath
};
