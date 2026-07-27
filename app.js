const express = require('express');
const session = require('express-session');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;
const uploadDir = path.join(__dirname, 'public', 'uploads');
const dbPath = path.join(__dirname, 'data', 'school.db');

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new sqlite3.Database(dbPath);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'comfort-school-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, toSafeFileName(file.originalname))
});
const upload = multer({ storage });

function toSafeFileName(name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `${Date.now()}-${base || 'image'}${ext}`;
}

function dbRun(query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) {
        reject(err);
      } else {
        resolve(this);
      }
    });
  });
}

function dbGet(query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row);
      }
    });
  });
}

function dbAll(query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
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

async function initDb() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
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

  const defaults = [
    ['school_name', 'Comfort Grammar School'],
    ['school_tagline', 'A nurturing learning community for excellence and values'],
    ['address', 'H.No 5, 100/1, Kamanpur, near police station, Peddapalli, Telangana 505188'],
    ['phone', '+91 99499 00300'],
    ['email', 'vinay.comfort@gmail.com'],
    ['working_hours', 'Mon - Sat: 8:30 AM - 4:00 PM'],
    ['classes_offered', 'Nursery\nLKG\nUKG\nClass 1 - 10'],
    ['transport_details', 'Safe transport service is available through selected routes and villages.'],
    ['about_history', 'Comfort Grammar School has been shaping young minds with quality instruction, discipline, and care for over two decades.'],
    ['mission', 'To create a joyful, inclusive and inspiring learning environment that helps every child grow academically and personally.'],
    ['vision', 'To become a leading school that develops confident, responsible and future-ready learners.'],
    ['highlights', 'Experienced faculty\nModern classrooms\nSafe campus\nValue-based education\nStrong co-curricular focus'],
    ['leadership_message', 'We believe every child deserves academic excellence, moral strength, and the confidence to thrive.'],
    ['academics_content', 'Our academics focus on conceptual understanding, language development, STEM exposure, and individualized support.'],
    ['admissions_content', 'Admissions are open for Nursery to Class 10. Parents can visit campus or use the admissions form to start the process.'],
    ['facilities_content', 'The school offers smart classrooms, a library, science and computer labs, transport services, sports facilities, and a safe campus.'],
    ['achievements_content', 'Students consistently excel in academics, sports, cultural events, and public speaking through well-rounded school programs.'],
    ['contact_intro', 'We welcome visits, inquiries, and admissions requests from parents and guardians.'],
    ['hero_title', 'Excellence in learning, leadership and care'],
    ['hero_subtitle', 'Comfort Grammar School offers modern education, value-based teaching, and a nurturing environment for every learner.'],
    ['hero_cta', 'Apply Now']
  ];

  for (const [key, value] of defaults) {
    await dbRun('INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)', [key, value]);
  }

  const contentPages = await dbGet('SELECT COUNT(*) AS count FROM content_pages');
  if (!contentPages || contentPages.count === 0) {
    await dbRun(`
      INSERT INTO content_pages (title, slug, content) VALUES
      ('About the School', 'about', '<p>We blend rigorous academics with a warm learning environment where each child can grow in confidence and character.</p>'),
      ('Admissions', 'admissions', '<p>Admissions are open for a range of classes. Reach out to our team to arrange a campus tour or begin your application.</p>'),
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
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  }
  return res.redirect('/admin/login');
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
    user: req.session.admin ? { username: req.session.adminUsername } : null,
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

app.get('/contact', async (req, res) => {
  const data = await getPageData(req, { page: 'contact', pageTitle: 'Contact' });
  res.render('contact', data);
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

app.get('/admin/login', async (req, res) => {
  const data = await getPageData(req, { page: 'admin', pageTitle: 'Admin Login' });
  res.render('login', { ...data, error: req.query.error ? '1' : null });
});

app.post('/admin/login', (req, res) => {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'comfortschool';

  if (req.body.username === username && req.body.password === password) {
    req.session.admin = true;
    req.session.adminUsername = username;
    return res.redirect('/admin');
  }

  return res.redirect('/admin/login?error=1');
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

app.get('/admin', requireAdmin, async (req, res) => {
  const data = await getPageData(req, { page: 'admin', pageTitle: 'Admin Dashboard' });
  res.render('admin', data);
});

app.post('/admin/banners', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const { title, subtitle } = req.body;
    const imagePath = req.file ? `/uploads/${req.file.filename}` : '/uploads/banner-1.svg';
    await dbRun('INSERT INTO banners (title, subtitle, image_path) VALUES (?, ?, ?)', [title, subtitle, imagePath]);
    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to create banner.');
  }
});

app.post('/admin/banners/:id/toggle', requireAdmin, async (req, res) => {
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

app.post('/admin/banners/:id/delete', requireAdmin, async (req, res) => {
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

app.post('/admin/gallery', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    const { title, caption } = req.body;
    const imagePath = req.file ? `/uploads/${req.file.filename}` : '/uploads/gallery-1.svg';
    await dbRun('INSERT INTO gallery_images (title, caption, image_path) VALUES (?, ?, ?)', [title, caption, imagePath]);
    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to create gallery image.');
  }
});

app.post('/admin/gallery/:id/delete', requireAdmin, async (req, res) => {
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

app.post('/admin/staff', requireAdmin, upload.single('photo'), async (req, res) => {
  try {
    const { name, role, description } = req.body;
    const photoPath = req.file ? `/uploads/${req.file.filename}` : '/uploads/staff-1.svg';
    await dbRun('INSERT INTO staff_members (name, role, photo_path, description) VALUES (?, ?, ?, ?)', [name, role, photoPath, description]);
    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to create staff member.');
  }
});

app.post('/admin/staff/:id/delete', requireAdmin, async (req, res) => {
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

app.post('/admin/pages', requireAdmin, async (req, res) => {
  try {
    const title = req.body.title || 'Untitled page';
    const slug = slugify(req.body.slug || title);
    const content = req.body.content || 'Add content for this page here.';
    await dbRun('INSERT INTO content_pages (title, slug, content, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)', [title, slug, content]);
    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to create content page.');
  }
});

app.post('/admin/pages/:id/delete', requireAdmin, async (req, res) => {
  try {
    await dbRun('DELETE FROM content_pages WHERE id = ?', [req.params.id]);
    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to delete content page.');
  }
});

app.post('/admin/upload', requireAdmin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.redirect('/admin?error=1');
    }
    const { title, category } = req.body;
    await dbRun('INSERT INTO media_items (title, category, file_name, file_path, mime_type) VALUES (?, ?, ?, ?, ?)', [title || 'Uploaded image', category || 'gallery', req.file.filename, `/uploads/${req.file.filename}`, req.file.mimetype]);
    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to upload image.');
  }
});

app.post('/admin/replace', requireAdmin, upload.single('replacement'), async (req, res) => {
  try {
    const { mediaId } = req.body;
    if (!req.file || !mediaId) {
      return res.redirect('/admin?error=1');
    }

    const media = await dbGet('SELECT id, title, file_name, file_path FROM media_items WHERE id = ?', [mediaId]);
    if (!media) {
      return res.redirect('/admin?error=1');
    }

    deleteFileIfExists(media.file_path);
    await dbRun('UPDATE media_items SET title = ?, file_name = ?, file_path = ?, mime_type = ? WHERE id = ?', [media.title, req.file.filename, `/uploads/${req.file.filename}`, req.file.mimetype, mediaId]);
    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to replace image.');
  }
});

app.post('/admin/content', requireAdmin, async (req, res) => {
  try {
    const contentFields = [
      'school_name', 'school_tagline', 'address', 'phone', 'email', 'working_hours', 'classes_offered', 'transport_details',
      'about_history', 'mission', 'vision', 'highlights', 'leadership_message', 'academics_content', 'admissions_content',
      'facilities_content', 'achievements_content', 'contact_intro', 'hero_title', 'hero_subtitle', 'hero_cta'
    ];

    for (const field of contentFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        await dbRun('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [field, req.body[field]]);
      }
    }

    res.redirect('/admin?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to update content.');
  }
});

app.post('/admin/media/:id/delete', requireAdmin, async (req, res) => {
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

app.post('/contact', async (req, res) => {
  try {
    const { name, email, phone, message } = req.body;
    if (!name || !email || !message) {
      return res.redirect('/contact?error=1');
    }

    await dbRun('INSERT INTO contact_messages (name, email, phone, message) VALUES (?, ?, ?, ?)', [name, email, phone || '', message]);
    res.redirect('/contact?success=1');
  } catch (error) {
    console.error(error);
    res.status(500).send('Unable to submit contact form.');
  }
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

module.exports = { app, db };
