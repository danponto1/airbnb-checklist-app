const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Database = require('better-sqlite3');
const dayjs = require('dayjs');

const app = express();
const PORT = process.env.PORT || 3030;

const dataDir = path.join(__dirname, 'data');
const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });

const db = new Database(path.join(dataDir, 'checklists.db'));
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'checklist.schema.json'), 'utf8'));

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      property_id TEXT NOT NULL,
      cleaner_name TEXT NOT NULL,
      cleaning_date TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      item_key TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      condition TEXT,
      notes TEXT,
      issue_note TEXT,
      FOREIGN KEY(submission_id) REFERENCES submissions(id)
    );

    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      submission_id INTEGER NOT NULL,
      item_key TEXT NOT NULL,
      file_path TEXT NOT NULL,
      original_name TEXT,
      is_issue INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(submission_id) REFERENCES submissions(id)
    );
  `);
}

initDb();

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, uploadDir),
  filename: (_, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  }
});

const upload = multer({ storage });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));

function allItems() {
  return schema.sections.flatMap(section => section.items.map(item => ({ ...item, sectionId: section.id, sectionName: section.name })));
}

function needsIssueEvidence(condition) {
  return ['Damaged', 'Not Working'].includes(condition);
}

app.get('/', (_, res) => {
  res.redirect('/form');
});

app.get('/form', (_, res) => {
  res.render('form', { schema, error: null, formData: {} });
});

app.get('/submit', (_, res) => {
  res.redirect('/form');
});

app.post('/submit', upload.any(), (req, res) => {
  const { property_id, cleaner_name, cleaning_date } = req.body;

  if (!property_id || !cleaner_name) {
    return res.status(400).render('form', { schema, error: 'Property and cleaner name are required.', formData: req.body || {} });
  }

  const filesByField = {};
  (req.files || []).forEach(file => {
    if (!filesByField[file.fieldname]) filesByField[file.fieldname] = [];
    filesByField[file.fieldname].push(file);
  });

  const items = allItems();

  for (const item of items) {
    const condition = req.body[`condition__${item.key}`];
    if (item.requiresPhoto) {
      const photos = filesByField[`photos__${item.key}`] || [];
      if (photos.length < (item.minPhotos || 1)) {
        return res.status(400).render('form', { schema, error: `Missing required photo(s) for: ${item.label}`, formData: req.body || {} });
      }
    }

    if (needsIssueEvidence(condition)) {
      const issueNote = req.body[`issue_note__${item.key}`];
      const issuePhotos = filesByField[`issue_photos__${item.key}`] || [];
      if (!issueNote || !issueNote.trim()) {
        return res.status(400).render('form', { schema, error: `Issue note required for: ${item.label}`, formData: req.body || {} });
      }
      if (!issuePhotos.length) {
        return res.status(400).render('form', { schema, error: `Issue photo required for: ${item.label}`, formData: req.body || {} });
      }
    }
  }

  const now = dayjs().toISOString();
  const insertSubmission = db.prepare('INSERT INTO submissions (property_id, cleaner_name, cleaning_date, created_at) VALUES (?, ?, ?, ?)');
  const submissionId = insertSubmission.run(property_id, cleaner_name, cleaning_date || null, now).lastInsertRowid;

  const insertResponse = db.prepare(
    'INSERT INTO responses (submission_id, item_key, completed, condition, notes, issue_note) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertPhoto = db.prepare(
    'INSERT INTO photos (submission_id, item_key, file_path, original_name, is_issue, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );

  for (const item of items) {
    const completed = req.body[`complete__${item.key}`] ? 1 : 0;
    const condition = req.body[`condition__${item.key}`] || null;
    const notes = req.body[`notes__${item.key}`] || null;
    const issueNote = req.body[`issue_note__${item.key}`] || null;

    insertResponse.run(submissionId, item.key, completed, condition, notes, issueNote);

    (filesByField[`photos__${item.key}`] || []).forEach(file => {
      insertPhoto.run(submissionId, item.key, `/uploads/${path.basename(file.path)}`, file.originalname, 0, now);
    });

    (filesByField[`issue_photos__${item.key}`] || []).forEach(file => {
      insertPhoto.run(submissionId, item.key, `/uploads/${path.basename(file.path)}`, file.originalname, 1, now);
    });
  }

  res.redirect(`/submitted/${submissionId}`);
});

app.get('/submitted/:id', (req, res) => {
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!submission) return res.status(404).send('Submission not found');
  res.render('submitted', { submission, schema });
});

app.get('/admin', (_, res) => {
  const submissions = db
    .prepare('SELECT * FROM submissions ORDER BY created_at DESC LIMIT 200')
    .all();
  res.render('admin', { submissions, schema });
});

app.get('/admin/submissions/:id', (req, res) => {
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!submission) return res.status(404).send('Submission not found');

  const responses = db.prepare('SELECT * FROM responses WHERE submission_id = ?').all(req.params.id);
  const photos = db.prepare('SELECT * FROM photos WHERE submission_id = ?').all(req.params.id);

  const responseMap = Object.fromEntries(responses.map(r => [r.item_key, r]));
  const photoMap = photos.reduce((acc, p) => {
    if (!acc[p.item_key]) acc[p.item_key] = { regular: [], issue: [] };
    acc[p.item_key][p.is_issue ? 'issue' : 'regular'].push(p);
    return acc;
  }, {});

  res.render('submission-detail', { submission, schema, responseMap, photoMap });
});

app.listen(PORT, () => {
  console.log(`Checklist app running on http://localhost:${PORT}`);
});
