const express = require('express');
const session = require('express-session');
const multer = require('multer');
const helmet = require('helmet');
const csurf = require('csurf');
const bcrypt = require('bcrypt');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { connectDb, dbRun, dbGet, dbAll, isMySql, dbPath } = require('./db');

const app = express();
const port = process.env.PORT || 3000;
const uploadDir = path.join(__dirname, 'public', 'uploads');

fs.mkdirSync(uploadDir, { recursive: true });

app.use(helmet());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());


const SESSION_MAX_AGE_MS = 1000 * 60 * 30;

// When the app is behind a reverse proxy (load balancer / TLS terminator),
// enable trust proxy so express can detect req.secure correctly and
// express-session will send secure cookies appropriately.
// Using 'true' trusts the first proxy in front or honors X-Forwarded-* headers
// from the proxy chain. Adjust as needed for your deployment topology.
app.set('trust proxy', true);

app.use(session({
  secret: process.env.SESSION_SECRET || 'comfort-school-session-secret',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    maxAge: SESSION_MAX_AGE_MS,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

const csrfProtection = csurf();
// Note: csurf is applied per-route below. For multipart (file upload) routes we apply csrfProtection after multer so multer can parse the body first.

app.use((req, res, next) => {
  res.locals.sessionMaxAgeMs = SESSION_MAX_AGE_MS;
  res.locals.isAdmin = !!req.session.adminUser;
  res.locals.adminUser = req.session.adminUser || null;
  res.locals.csrfToken = req.csrfToken ? req.csrfToken() : null;
  next();
});

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = [process.env.CORS_ORIGIN, 'http://localhost:3000'].filter(Boolean);
  if (origin && allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use('/admin', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

const allowedImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml'];
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, toSafeFileName(file.originalname))
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!allowedImageTypes.includes(file.mimetype)) {
      return cb(new Error('Only PNG, JPEG, WebP and SVG images are allowed.'));
    }
    cb(null, true);
  }
});

function toSafeFileName(name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `${Date.now()}-${base || 'image'}${ext}`;
}

function sanitizeInput(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/`/g, '&#x60;');
}

function parseList(value) {
  if (!value) return [];
  return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'page';
}

function deleteFileIfExists(filePath) {
  if (!filePath) return;
  const absolutePath = path.join(__dirname, 'public', filePath.replace(/^\//, ''));
  if (fs.existsSync(absolutePath)) {
    fs.unlinkSync(absolutePath);
  }
}

function sqliteAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    const sqliteDb = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
    sqliteDb.all(sql, params, (err, rows) => {
      sqliteDb.close();
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function sqliteGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    const sqliteDb = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
    sqliteDb.get(sql, params, (err, row) => {
      sqliteDb.close();
      if (err) return reject(err);
      resolve(row);
    });
  });
}

async function migrateSqliteDataToMySql() {
  if (!fs.existsSync(dbPath)) return;

  const sqliteDb = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
  const sqliteAllRows = (sql, params = []) => new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
  const sqliteGetRow = (sql, params = []) => new Promise((resolve, reject) => {
    sqliteDb.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });

  const tableExists = async (name) => {
    const row = await sqliteGetRow("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [name]);
    return !!row;
  };

  try {
    if (await tableExists('site_settings')) {
      const rows = await sqliteAllRows('SELECT key, value FROM site_settings');
      for (const row of rows) {
        await dbRun('INSERT INTO site_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)', [row.key, row.value]);
      }
    }

    if (await tableExists('admins')) {
      const adminCols = await sqliteAllRows('PRAGMA table_info(admins)');
      const hasPasswordHash = adminCols.some((col) => col.name === 'password_hash');
      const admins = await sqliteAllRows('SELECT * FROM admins');
      for (const admin of admins) {
        const username = admin.username || admin.user || admin.email;
        const fullName = admin.full_name || admin.name || username;
        let passwordHash = admin.password_hash || admin.password || admin.pass || '';
        if (passwordHash && !hasPasswordHash) {
          passwordHash = await bcrypt.hash(String(passwordHash), 12);
        }
        if (!username || !passwordHash) continue;
        await dbRun('INSERT INTO admins (username, full_name, password_hash) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), password_hash = VALUES(password_hash)', [username, fullName, passwordHash]);
      }
    }

    if (await tableExists('media_items')) {
      const items = await sqliteAllRows('SELECT * FROM media_items');
      for (const item of items) {
        const filePath = item.file_path || item.image_path || item.file_name ? `/uploads/${item.file_name}` : '/uploads/placeholder.png';
        await dbRun('INSERT INTO media_items (id, title, category, file_name, file_path, mime_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE title = VALUES(title), category = VALUES(category), file_name = VALUES(file_name), file_path = VALUES(file_path), mime_type = VALUES(mime_type), created_at = VALUES(created_at)', [item.id, item.title || 'Media item', item.category || 'gallery', item.file_name || path.basename(filePath), filePath, item.mime_type || null, item.created_at || new Date()]);
      }
    }

    if (await tableExists('contact_messages')) {
      const messages = await sqliteAllRows('SELECT * FROM contact_messages');
      for (const message of messages) {
        await dbRun('INSERT INTO contact_messages (id, name, email, phone, message, created_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), email = VALUES(email), phone = VALUES(phone), message = VALUES(message), created_at = VALUES(created_at)', [message.id, message.name, message.email, message.phone, message.message, message.created_at || new Date()]);
      }
    }

    if (await tableExists('banners')) {
      const banners = await sqliteAllRows('SELECT * FROM banners');
      for (const banner of banners) {
        const imagePath = banner.image_path || banner.file_path || '/uploads/banner-1.svg';
        await dbRun('INSERT INTO banners (id, title, subtitle, image_path, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE title = VALUES(title), subtitle = VALUES(subtitle), image_path = VALUES(image_path), is_active = VALUES(is_active), created_at = VALUES(created_at)', [banner.id, banner.title || 'Banner', banner.subtitle || '', imagePath, banner.is_active ?? 1, banner.created_at || new Date()]);
      }
    }

    if (await tableExists('gallery_images')) {
      const gallery = await sqliteAllRows('SELECT * FROM gallery_images');
      for (const item of gallery) {
        const imagePath = item.image_path || item.file_path || '/uploads/gallery-1.svg';
        await dbRun('INSERT INTO gallery_images (id, title, caption, image_path, created_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE title = VALUES(title), caption = VALUES(caption), image_path = VALUES(image_path), created_at = VALUES(created_at)', [item.id, item.title || 'Gallery image', item.caption || '', imagePath, item.created_at || new Date()]);
      }
    }

    if (await tableExists('staff_members')) {
      const staff = await sqliteAllRows('SELECT * FROM staff_members');
      for (const person of staff) {
        const photoPath = person.photo_path || person.file_path || '/uploads/staff-1.svg';
        await dbRun('INSERT INTO staff_members (id, name, role, photo_path, description, created_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), role = VALUES(role), photo_path = VALUES(photo_path), description = VALUES(description), created_at = VALUES(created_at)', [person.id, person.name || 'Staff', person.role || 'Staff', photoPath, person.description || '', person.created_at || new Date()]);
      }
    }

    if (await tableExists('content_pages')) {
      const pages = await sqliteAllRows('SELECT * FROM content_pages');
      for (const page of pages) {
        await dbRun('INSERT INTO content_pages (id, title, slug, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE title = VALUES(title), content = VALUES(content), updated_at = VALUES(updated_at)', [page.id, page.title || 'Page', page.slug || `page-${page.id}`, page.content || '', page.created_at || new Date(), page.updated_at || page.created_at || new Date()]);
      }
    }
  } catch (error) {
    console.warn('SQLite to MySQL migration skipped or failed:', error.message || error);
  } finally {
    sqliteDb.close();
  }
}

async function initDb() {
  await connectDb();

  const mysqlMode = isMySql();

  if (mysqlMode) {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS site_settings (
        \`key\` VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS admins (
        id INT AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(100) NOT NULL UNIQUE,
        full_name VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS media_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL,
        file_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        mime_type VARCHAR(100),
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        message TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS banners (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        subtitle VARCHAR(255),
        image_path VARCHAR(255) NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS gallery_images (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        caption TEXT,
        image_path VARCHAR(255) NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS staff_members (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(255) NOT NULL,
        photo_path VARCHAR(255) NOT NULL,
        description TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS content_pages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        slug VARCHAR(255) NOT NULL UNIQUE,
        content TEXT NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await migrateSqliteDataToMySql();
  } else {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS site_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        full_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS media_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        category TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        mime_type TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        message TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS banners (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        subtitle TEXT,
        image_path TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS gallery_images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        caption TEXT,
        image_path TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS staff_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        photo_path TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS content_pages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  const defaults = [
    ['school_name', 'Comfort Grammar School'],
    ['school_tagline', 'A nurturing learning community for excellence and values'],
    ['address', 'H.No 5, 100/1, Kamanpur, near police station, Peddapalli, Telangana 505188'],
    ['phone', '+91 99499 00300'],
    ['email', 'vinay.comfort@gmail.com'],
    ['working_hours', 'Mon - Sat: 8:30 AM - 4:00 PM'],
    ['classes_offered', 'Nursery\nLKG\nUKG\nClass 1 - 7'],
    ['transport_details', 'Safe transport service is available through selected routes and villages.'],
    ['about_history', 'Comfort Grammar School has been shaping young minds with quality instruction, discipline, and care for over two decades.'],
    ['mission', 'To create a joyful, inclusive and inspiring learning environment that helps every child grow academically and personally.'],
    ['vision', 'To become a leading school that develops confident, responsible and future-ready learners.'],
    ['highlights', 'Experienced faculty\nModern classrooms\nSafe campus\nValue-based education\nStrong co-curricular focus'],
    ['leadership_message', 'We believe every child deserves academic excellence, moral strength, and the confidence to thrive.'],
    ['academics_content', 'Our academics focus on conceptual understanding, language development, STEM exposure, and individualized support.'],
    ['admissions_content', 'Admissions are open for Nursery to Class 7. Parents can visit campus or use the admissions form to start the process.'],
    ['facilities_content', 'The school offers smart classrooms, a library, science and computer labs, transport services, sports facilities, and a safe campus.'],
    ['achievements_content', 'Students consistently excel in academics, sports, cultural events, and public speaking through well-rounded school programs.'],
    ['contact_intro', 'We welcome visits, inquiries, and admissions requests from parents and guardians.'],
    ['hero_title', 'Excellence in learning, leadership and care'],
    ['hero_subtitle', 'Comfort Grammar School offers modern education, value-based teaching, and a nurturing environment for every learner.'],
    ['hero_cta', 'Apply Now'],
    ['about_school_image', '']
  ];

  for (const [key, value] of defaults) {
    if (mysqlMode) {
      await dbRun('INSERT INTO site_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `key` = `key`', [key, value]);
    } else {
      await dbRun('INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)', [key, value]);
    }
  }

  const contentPages = await dbGet('SELECT COUNT(*) AS count FROM content_pages');
  if (!contentPages || contentPages.count === 0) {
    await dbRun(`
      INSERT INTO content_pages (title, slug, content) VALUES
      ('About the School', 'about', '<p>We blend rigorous academics with a warm learning environment where each child can grow in confidence and character.</p>'),
      ('Admissions', 'admissions', '<p>Admissions are open for a range of classes. Parents can visit campus or use the admissions form to start the process.</p>'),
      ('Facilities', 'facilities', '<p>From smart classrooms to sports facilities, our campus supports every age group with modern infrastructure and student-centered care.</p>')
    `);
  }

  const banners = await dbGet('SELECT COUNT(*) AS count FROM banners');
  if (!banners || banners.count === 0) {
    await dbRun(`
      INSERT INTO banners (title, subtitle, image_path, is_active) VALUES
      ('Learn with Confidence', 'A welcoming school community focused on growth.', '/uploads/banner-1.svg', 1),
      ('Future Ready', 'Hands-on projects and inspiring educators.', '/uploads/banner-2.svg', 1),
      ('Discover Possibilities', 'A balanced curriculum for every learner.', '/uploads/banner-3.svg', 1)
    `);
  }

  const gallery = await dbGet('SELECT COUNT(*) AS count FROM gallery_images');
  if (!gallery || gallery.count === 0) {
    await dbRun(`
      INSERT INTO gallery_images (title, caption, image_path) VALUES
      ('Science Fair', 'Students showcase creativity at our science fair.', '/uploads/gallery-1.svg'),
      ('Sports Day', 'Community spirit shines on sports day.', '/uploads/gallery-2.svg'),
      ('Arts Showcase', 'Our classrooms come alive with student art.', '/uploads/gallery-3.svg')
    `);
  }

  const staff = await dbGet('SELECT COUNT(*) AS count FROM staff_members');
  if (!staff || staff.count === 0) {
    await dbRun(`
      INSERT INTO staff_members (name, role, photo_path, description) VALUES
      ('Maya Rivera', 'Principal', '/uploads/staff-1.svg', 'A leader who keeps the school community connected and inspired.'),
      ('James Chen', 'Head of Academics', '/uploads/staff-2.svg', 'Passionate about curriculum design and student support.'),
      ('Aisha Khan', 'Arts Coordinator', '/uploads/staff-3.svg', 'Creates engaging opportunities for creative expression.')
    `);
  }

  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminFullName = process.env.ADMIN_FULL_NAME || 'Administrator';
  const adminSecret = process.env.ADMIN_PASSWORD || 'comfortschool';
  const adminHash = process.env.ADMIN_PASSWORD_HASH || await bcrypt.hash(adminSecret, 12);

  const adminExists = await dbGet('SELECT id FROM admins WHERE username = ?', [adminUsername]);
  if (!adminExists) {
    await dbRun('INSERT INTO admins (username, full_name, password_hash) VALUES (?, ?, ?)', [adminUsername, adminFullName, adminHash]);
  }
}

function requireAdmin(req, res, next) {
  if (!req.session.adminUser) {
    return res.redirect('/admin/login');
  }

  const SESSION_TIMEOUT = SESSION_MAX_AGE_MS;

  if (
    req.session.lastActivity &&
    Date.now() - req.session.lastActivity > SESSION_TIMEOUT
  ) {
    return req.session.destroy(() => {
      res.redirect('/admin/login?expired=1');
    });
  }

  req.session.lastActivity = Date.now();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
}

async function getPageData(req, extra = {}) {
  const rows = await dbAll('SELECT key, value FROM site_settings');
  const site = {};
  rows.forEach((row) => {
    site[row.key] = row.value;
  });

  const banners = await dbAll('SELECT * FROM banners ORDER BY id ASC');
  const gallery = await dbAll('SELECT * FROM gallery_images ORDER BY id DESC');
  const staff = await dbAll('SELECT * FROM staff_members ORDER BY id ASC');
  const contentPages = await dbAll('SELECT id, title, slug FROM content_pages ORDER BY title ASC');
  const mediaItems = await dbAll('SELECT * FROM media_items ORDER BY created_at DESC');

  return {
    ...extra,
    site,
    banners: banners.map((banner) => ({
      ...banner,
      file_path: banner.image_path,
      active: banner.is_active === 1
    })),
    gallery: gallery.map((item) => ({
      ...item,
      file_path: item.image_path,
      title: item.title,
      caption: item.caption
    })),
    staff: staff.map((member) => ({
      ...member,
      title: member.name,
      file_path: member.photo_path,
      description: member.description,
      role: member.role
    })),
    pages: contentPages,
    mediaItems,
    isAdmin: !!req.session.adminUser,
    adminUser: req.session.adminUser || null,
    sessionMaxAgeMs: SESSION_MAX_AGE_MS,
    highlights: parseList(site.highlights),
    classes: parseList(site.classes_offered),
    facilities: parseList(site.facilities_content),
    transportDetails: parseList(site.transport_details),
    success: req.query && req.query.success ? req.query.success : null,
    error: req.query && req.query.error ? req.query.error : null
  };
}

app.get('/', async (req, res) => {
  const data = await getPageData(req, { page: 'home', pageTitle: 'Home' });
  res.render('home', data);
});

app.get('/about', async (req, res) => {
  const data = await getPageData(req, { page: 'about', pageTitle: 'About Us' });
  res.render('about', data);
});

app.get('/school-information', async (req, res) => {
  const data = await getPageData(req, { page: 'school-information', pageTitle: 'School Information' });
  res.render('school-information', data);
});

app.get('/academics', async (req, res) => {
  const data = await getPageData(req, { page: 'academics', pageTitle: 'Academics' });
  res.render('academics', data);
});

app.get('/admissions', async (req, res) => {
  const data = await getPageData(req, { page: 'admissions', pageTitle: 'Admissions' });
  res.render('admissions', data);
});

app.get('/facilities', async (req, res) => {
  const data = await getPageData(req, { page: 'facilities', pageTitle: 'Facilities' });
  res.render('facilities', data);
});

app.get('/achievements', async (req, res) => {
  const data = await getPageData(req, { page: 'achievements', pageTitle: 'Achievements' });
  res.render('achievements', data);
});

app.get('/gallery', async (req, res) => {
  const data = await getPageData(req, { page: 'gallery', pageTitle: 'Gallery' });
  res.render('gallery', data);
});

app.get('/staff', async (req, res) => {
  const data = await getPageData(req, { page: 'staff', pageTitle: 'Staff' });
  res.render('staff', data);
});

app.get('/contact', csrfProtection, async (req, res) => {
  const data = await getPageData(req, { page: 'contact', pageTitle: 'Contact' });
  res.render('contact', { ...data, csrfToken: req.csrfToken() });
});

app.get('/pages/:slug', async (req, res) => {
  try {
    const page = await dbGet('SELECT * FROM content_pages WHERE slug = ?', [req.params.slug]);
    if (!page) {
      return res.status(404).send('Content page not found.');
    }
    const data = await getPageData(req, { page: `page:${page.slug}`, pageTitle: page.title });
    res.render('page', { ...data, pageContent: page, content: page.content });
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to load the requested page.');
  }
});

app.get('/admin/login', csrfProtection, async (req, res) => {
  if (req.session.adminUser) {
    return res.redirect('/admin');
  }
  const data = await getPageData(req, { page: 'admin', pageTitle: 'Admin Login' });
  // ensure template has token available
  res.render('login', { ...data, csrfToken: req.csrfToken(), error: req.query.error ? '1' : null, expired: req.query.expired ? '1' : null });
});

app.post('/admin/login', csrfProtection, async (req, res) => {
  try {
    // Optional debug logging to aid diagnosing CSRF/session issues in production.
    // Enable by setting DEBUG_LOGIN=1 in the environment (do not enable long-term).
    if (process.env.DEBUG_LOGIN === '1') {
      console.log('LOGIN DEBUG', {
        secure: req.secure,
        xForwardedProto: req.headers['x-forwarded-proto'] || null,
        cookiePresent: !!req.headers.cookie,
        sessionID: req.sessionID || null
      });
    }

    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (!username || !password) {
      return res.redirect('/admin/login?error=1');
    }

    const admin = await dbGet('SELECT id, username, full_name, password_hash FROM admins WHERE username = ?', [username]);
    if (!admin) {
      return res.redirect('/admin/login?error=1');
    }

    const passwordMatches = await bcrypt.compare(password, admin.password_hash);
    if (!passwordMatches) {
      return res.redirect('/admin/login?error=1');
    }

    req.session.adminUser = {
      id: admin.id,
      username: admin.username,
      full_name: admin.full_name
    };
    req.session.loginTime = Date.now();
    req.session.lastActivity = Date.now();
    return res.redirect('/admin');
  } catch (error) {
    console.error(error);
    return res.redirect('/admin/login?error=1');
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});


app.get('/admin', requireAdmin, csrfProtection, async (req, res) => {
  const data = await getPageData(req, {
    page: 'admin',
    pageTitle: 'Admin Dashboard'
  });

  const bannerCount = await dbGet('SELECT COUNT(*) AS count FROM banners');
  const galleryCount = await dbGet('SELECT COUNT(*) AS count FROM gallery_images');
  const staffCount = await dbGet('SELECT COUNT(*) AS count FROM staff_members');
  const pageCount = await dbGet('SELECT COUNT(*) AS count FROM content_pages');
  const mediaCount = await dbGet('SELECT COUNT(*) AS count FROM media_items');
  const messageCount = await dbGet('SELECT COUNT(*) AS count FROM contact_messages');

  res.render('admin', {
    ...data,
    csrfToken: req.csrfToken(),
    stats: {
      banners: bannerCount?.count || 0,
      gallery: galleryCount?.count || 0,
      staff: staffCount?.count || 0,
      pages: pageCount?.count || 0,
      media: mediaCount?.count || 0,
      messages: messageCount?.count || 0
    }
  });
});

app.post('/admin/banners', requireAdmin, upload.any(), csrfProtection, async (req, res) => {
  try {
    const title = sanitizeInput(req.body.title || 'Banner');
    const subtitle = sanitizeInput(req.body.subtitle || '');
    const file = req.file || (req.files && req.files[0]);
    const imagePath = file ? `/uploads/${file.filename}` : '/uploads/banner-1.svg';
    await dbRun('INSERT INTO banners (title, subtitle, image_path) VALUES (?, ?, ?)', [title, subtitle, imagePath]);
    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to create banner.');
  }
});

app.post('/admin/banners/:id/toggle', requireAdmin, csrfProtection, async (req, res) => {
  try {
    const banner = await dbGet('SELECT is_active FROM banners WHERE id = ?', [req.params.id]);
    if (!banner) return res.status(404).send('Banner not found.');
    const nextState = banner.is_active === 1 ? 0 : 1;
    await dbRun('UPDATE banners SET is_active = ? WHERE id = ?', [nextState, req.params.id]);
    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to update banner.');
  }
});

app.post('/admin/banners/:id/delete', requireAdmin, csrfProtection, async (req, res) => {
  try {
    const banner = await dbGet('SELECT image_path FROM banners WHERE id = ?', [req.params.id]);
    if (banner) {
      deleteFileIfExists(banner.image_path);
    }
    await dbRun('DELETE FROM banners WHERE id = ?', [req.params.id]);
    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to delete banner.');
  }
});

app.post('/admin/gallery', requireAdmin, upload.any(), csrfProtection, async (req, res) => {
  try {
    const title = sanitizeInput(req.body.title || 'Gallery image');
    const caption = sanitizeInput(req.body.caption || '');
    const file = req.file || (req.files && req.files[0]);
    if (!file) {
      return res.redirect('/admin?error=1');
    }
    const imagePath = `/uploads/${file.filename}`;
    await dbRun('INSERT INTO gallery_images (title, caption, image_path) VALUES (?, ?, ?)', [title, caption, imagePath]);
    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to create gallery image.');
  }
});

app.post('/admin/about-image', requireAdmin, upload.any(), csrfProtection, async (req, res) => {
  try {
    const file = req.file || (req.files && req.files[0]);
    if (!file) {
      return res.redirect('/admin?error=1');
    }
    const imagePath = `/uploads/${file.filename}`;
    const current = await dbGet('SELECT value FROM site_settings WHERE key = ?', ['about_school_image']);
    if (current && current.value) {
      deleteFileIfExists(current.value);
    }
    if (isMySql()) {
      await dbRun('INSERT INTO site_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)', ['about_school_image', imagePath]);
    } else {
      await dbRun('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', ['about_school_image', imagePath]);
    }
    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to upload about school image.');
  }
});

app.post('/admin/gallery/:id/delete', requireAdmin, csrfProtection, async (req, res) => {
  try {
    const item = await dbGet('SELECT image_path FROM gallery_images WHERE id = ?', [req.params.id]);
    if (item) {
      deleteFileIfExists(item.image_path);
    }
    await dbRun('DELETE FROM gallery_images WHERE id = ?', [req.params.id]);
    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to delete gallery image.');
  }
});

app.post('/admin/staff', requireAdmin, upload.any(), csrfProtection, async (req, res) => {
  try {
    const name = sanitizeInput(req.body.name || 'Staff member');
    const role = sanitizeInput(req.body.role || 'Staff');
    const description = sanitizeInput(req.body.description || '');
    const file = req.file || (req.files && req.files[0]);
    const photoPath = file ? `/uploads/${file.filename}` : '/uploads/staff-1.svg';
    await dbRun('INSERT INTO staff_members (name, role, photo_path, description) VALUES (?, ?, ?, ?)', [name, role, photoPath, description]);
    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to create staff member.');
  }
});

app.post('/admin/staff/:id/delete', requireAdmin, csrfProtection, async (req, res) => {
  try {
    const member = await dbGet('SELECT photo_path FROM staff_members WHERE id = ?', [req.params.id]);
    if (member) {
      deleteFileIfExists(member.photo_path);
    }
    await dbRun('DELETE FROM staff_members WHERE id = ?', [req.params.id]);
    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to delete staff member.');
  }
});

app.post('/admin/pages', requireAdmin, csrfProtection, async (req, res) => {
  try {
    const title = sanitizeInput(req.body.title || 'Untitled page');
    const slug = slugify(req.body.slug || title);
    const content = req.body.content || 'Add content for this page here.';
    const existingPage = await dbGet('SELECT id FROM content_pages WHERE slug = ?', [slug]);
    if (existingPage) {
      return res.redirect('/admin?error=1');
    }
    await dbRun('INSERT INTO content_pages (title, slug, content, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)', [title, slug, content]);
    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to create content page.');
  }
});

app.post('/admin/pages/:id/delete', requireAdmin, csrfProtection, async (req, res) => {
  try {
    await dbRun('DELETE FROM content_pages WHERE id = ?', [req.params.id]);
    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to delete content page.');
  }
});

app.post('/admin/upload', requireAdmin, upload.any(), csrfProtection, async (req, res) => {
  try {
    const file = req.file || (req.files && req.files[0]);
    if (!file) {
      return res.redirect('/admin?error=1');
    }
    const title = sanitizeInput(req.body.title || 'Uploaded image');
    const category = sanitizeInput(req.body.category || 'gallery');
    await dbRun('INSERT INTO media_items (title, category, file_name, file_path, mime_type) VALUES (?, ?, ?, ?, ?)', [title, category, file.filename, `/uploads/${file.filename}`, file.mimetype]);
    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to upload image.');
  }
});

app.post('/admin/replace', requireAdmin, upload.any(), csrfProtection, async (req, res) => {
  try {
    const mediaId = sanitizeInput(req.body.mediaId);
    const file = req.file || (req.files && req.files[0]);
    if (!file || !mediaId) {
      return res.redirect('/admin?error=1');
    }

    const media = await dbGet('SELECT id, title, file_path FROM media_items WHERE id = ?', [mediaId]);
    if (!media) {
      return res.redirect('/admin?error=1');
    }

    deleteFileIfExists(media.file_path);
    await dbRun('UPDATE media_items SET file_name = ?, file_path = ?, mime_type = ? WHERE id = ?', [file.filename, `/uploads/${file.filename}`, file.mimetype, mediaId]);
    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to replace image.');
  }
});

app.post('/admin/content', requireAdmin, csrfProtection, async (req, res) => {
  try {
    const contentFields = [
      'school_name', 'school_tagline', 'address', 'phone', 'email', 'working_hours', 'classes_offered', 'transport_details',
      'about_history', 'mission', 'vision', 'highlights', 'leadership_message', 'academics_content', 'admissions_content',
      'facilities_content', 'achievements_content', 'contact_intro', 'hero_title', 'hero_subtitle', 'hero_cta'
    ];

    for (const field of contentFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        const value = sanitizeInput(req.body[field]);
        if (isMySql()) {
          await dbRun('INSERT INTO site_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)', [field, value]);
        } else {
          await dbRun('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [field, value]);
        }
      }
    }

    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to update content.');
  }
});

app.post('/admin/media/:id/delete', requireAdmin, csrfProtection, async (req, res) => {
  try {
    const media = await dbGet('SELECT file_name, file_path FROM media_items WHERE id = ?', [req.params.id]);
    if (media) {
      deleteFileIfExists(media.file_path);
      await dbRun('DELETE FROM media_items WHERE id = ?', [req.params.id]);
    }
    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to delete media.');
  }
});

app.post('/contact', csrfProtection, async (req, res) => {
  try {
    const name = sanitizeInput(req.body.name || '');
    const email = sanitizeInput(req.body.email || '');
    const phone = sanitizeInput(req.body.phone || '');
    const message = sanitizeInput(req.body.message || '');

    if (!name || !email || !message || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.redirect('/contact?error=1');
    }

    await dbRun('INSERT INTO contact_messages (name, email, phone, message) VALUES (?, ?, ?, ?)', [name, email, phone, message]);
    res.redirect('/contact?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to submit contact form.');
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).send('Invalid form submission. Please refresh and try again.');
  }

  if (err instanceof multer.MulterError || err.message?.includes('Only PNG')) {
    return res.status(400).send('Uploaded file must be a PNG, JPEG, WebP, or SVG image and smaller than 5MB.');
  }

  res.status(500).send('An unexpected error occurred. Please try again later.');
});

(async () => {
  try {
    await initDb();
    app.listen(port, () => {
      console.log(`Comfort Grammar School website listening on http://localhost:${port}`);
    });
  } catch (error) {
    console.error('Database initialization failed:', error);
    process.exit(1);
  }
})();

module.exports = { app };
