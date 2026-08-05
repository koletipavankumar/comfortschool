/*
  migrate-sqlite-to-mysql.js

  Safe, idempotent migration of common tables from the local SQLite file to MySQL.
  Usage:
    - Set MySQL connection via env (MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE) or MYSQL_URL
    - Ensure app is stopped or DB not being written concurrently
    - node scripts/migrate-sqlite-to-mysql.js

  Notes:
  - This script attempts to map common tables used by the app: site_settings, admins, media_items,
    contact_messages, banners, gallery_images, staff_members, content_pages
  - It uses ON DUPLICATE KEY UPDATE semantics for MySQL to avoid creating duplicates.
  - It does not remove data from SQLite; run on demand and keep backups.
*/

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const mysql = require('mysql2/promise');
require('dotenv').config();

const projectRoot = path.resolve(__dirname, '..');
const sqlitePath = path.join(projectRoot, 'data', 'school.db');

async function mysqlPool() {
  const mysqlUrl = process.env.MYSQL_URL || process.env.DATABASE_URL;
  if (mysqlUrl) {
    const url = new URL(mysqlUrl);
    return mysql.createPool({
      host: url.hostname,
      port: url.port || 3306,
      user: url.username,
      password: url.password,
      database: url.pathname.replace(/^\//, ''),
      waitForConnections: true,
      connectionLimit: 10
    });
  }

  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306', 10),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'comfort_school',
    waitForConnections: true,
    connectionLimit: 10
  });
  return pool;
}

function openSqlite() {
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite DB not found at ${sqlitePath}`);
  }
  return new sqlite3.Database(sqlitePath, sqlite3.OPEN_READONLY);
}

function sqliteAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function migrate() {
  console.log('Starting migration from SQLite -> MySQL');
  const pool = await mysqlPool();
  const sqliteDb = openSqlite();

  try {
    // site_settings
    try {
      const rows = await sqliteAll(sqliteDb, 'SELECT key, value FROM site_settings');
      for (const row of rows) {
        await pool.execute('INSERT INTO site_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)', [row.key, row.value]);
      }
      console.log(`Migrated site_settings: ${rows.length}`);
    } catch (e) {
      console.warn('site_settings missing or failed:', e.message || e);
    }

    // admins
    try {
      const admins = await sqliteAll(sqliteDb, 'SELECT username, full_name, password_hash, password FROM admins');
      for (const a of admins) {
        const username = a.username || (a.email && a.email.split('@')[0]) || `admin_${Date.now()}`;
        const full = a.full_name || a.name || username;
        const hash = a.password_hash || a.password || null; // app expects password_hash
        if (!hash) {
          console.warn(`Skipping admin ${username}: no password hash available`);
          continue;
        }
        await pool.execute('INSERT INTO admins (username, full_name, password_hash) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), password_hash = VALUES(password_hash)', [username, full, hash]);
      }
      console.log(`Migrated admins: ${admins.length}`);
    } catch (e) {
      console.warn('admins missing or failed:', e.message || e);
    }

    // media_items
    try {
      const media = await sqliteAll(sqliteDb, 'SELECT id, title, category, file_name, file_path, mime_type, created_at FROM media_items');
      for (const m of media) {
        const file_path = m.file_path || (m.file_name ? `/uploads/${m.file_name}` : '/uploads/placeholder.png');
        await pool.execute('INSERT INTO media_items (id, title, category, file_name, file_path, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE title=VALUES(title), category=VALUES(category), file_name=VALUES(file_name), file_path=VALUES(file_path), mime_type=VALUES(mime_type), created_at=VALUES(created_at)', [m.id || null, m.title || 'Media', m.category || 'gallery', m.file_name || path.basename(file_path), file_path, m.mime_type || null, m.created_at || new Date()]);
      }
      console.log(`Migrated media_items: ${media.length}`);
    } catch (e) {
      console.warn('media_items missing or failed:', e.message || e);
    }

    // contact_messages
    try {
      const messages = await sqliteAll(sqliteDb, 'SELECT id, name, email, phone, message, created_at FROM contact_messages');
      for (const msg of messages) {
        await pool.execute('INSERT INTO contact_messages (id, name, email, phone, message, created_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), email=VALUES(email), phone=VALUES(phone), message=VALUES(message), created_at=VALUES(created_at)', [msg.id || null, msg.name, msg.email, msg.phone || null, msg.message, msg.created_at || new Date()]);
      }
      console.log(`Migrated contact_messages: ${messages.length}`);
    } catch (e) {
      console.warn('contact_messages missing or failed:', e.message || e);
    }

    // banners
    try {
      const rows = await sqliteAll(sqliteDb, 'SELECT id, title, subtitle, image_path, is_active, created_at FROM banners');
      for (const b of rows) {
        await pool.execute('INSERT INTO banners (id, title, subtitle, image_path, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE title=VALUES(title), subtitle=VALUES(subtitle), image_path=VALUES(image_path), is_active=VALUES(is_active), created_at=VALUES(created_at)', [b.id || null, b.title || 'Banner', b.subtitle || '', b.image_path || '/uploads/banner-1.svg', b.is_active == null ? 1 : b.is_active, b.created_at || new Date()]);
      }
      console.log(`Migrated banners: ${rows.length}`);
    } catch (e) {
      console.warn('banners missing or failed:', e.message || e);
    }

    // gallery_images
    try {
      const rows = await sqliteAll(sqliteDb, 'SELECT id, title, caption, image_path, created_at FROM gallery_images');
      for (const g of rows) {
        await pool.execute('INSERT INTO gallery_images (id, title, caption, image_path, created_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE title=VALUES(title), caption=VALUES(caption), image_path=VALUES(image_path), created_at=VALUES(created_at)', [g.id || null, g.title || 'Gallery', g.caption || '', g.image_path || '/uploads/gallery-1.svg', g.created_at || new Date()]);
      }
      console.log(`Migrated gallery_images: ${rows.length}`);
    } catch (e) {
      console.warn('gallery_images missing or failed:', e.message || e);
    }

    // staff_members
    try {
      const rows = await sqliteAll(sqliteDb, 'SELECT id, name, role, photo_path, description, created_at FROM staff_members');
      for (const s of rows) {
        await pool.execute('INSERT INTO staff_members (id, name, role, photo_path, description, created_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name=VALUES(name), role=VALUES(role), photo_path=VALUES(photo_path), description=VALUES(description), created_at=VALUES(created_at)', [s.id || null, s.name || 'Staff', s.role || 'Staff', s.photo_path || '/uploads/staff-1.svg', s.description || '', s.created_at || new Date()]);
      }
      console.log(`Migrated staff_members: ${rows.length}`);
    } catch (e) {
      console.warn('staff_members missing or failed:', e.message || e);
    }

    // content_pages
    try {
      const rows = await sqliteAll(sqliteDb, 'SELECT id, title, slug, content, created_at, updated_at FROM content_pages');
      for (const p of rows) {
        await pool.execute('INSERT INTO content_pages (id, title, slug, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE title=VALUES(title), content=VALUES(content), updated_at=VALUES(updated_at)', [p.id || null, p.title || 'Page', p.slug || `page-${p.id || Date.now()}`, p.content || '', p.created_at || new Date(), p.updated_at || p.created_at || new Date()]);
      }
      console.log(`Migrated content_pages: ${rows.length}`);
    } catch (e) {
      console.warn('content_pages missing or failed:', e.message || e);
    }

    console.log('Migration completed. Verify data in MySQL and keep backups of SQLite DB.');
  } finally {
    sqliteDb.close();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message || err);
  process.exit(1);
});