const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const dayjs = require('dayjs');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3030;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || 'checklist-photos';

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || crypto.randomBytes(24).toString('hex');
const ADMIN_COOKIE_NAME = 'checklist_admin';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
  console.warn('Admin auth env vars missing: ADMIN_USERNAME / ADMIN_PASSWORD. Admin routes will be inaccessible.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const rawSchema = JSON.parse(fs.readFileSync(path.join(__dirname, 'checklist.schema.json'), 'utf8'));

const storage = multer.memoryStorage();
const upload = multer({ storage });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));

function getChecklistForProperty(propertyId) {
  const sections = (rawSchema.sections || []).map(section => ({
    ...section,
    items: (section.items || []).filter(item => {
      if (!item.propertyIds || !Array.isArray(item.propertyIds) || item.propertyIds.length === 0) return true;
      return item.propertyIds.includes(propertyId);
    })
  })).filter(section => section.items.length > 0);

  return {
    properties: rawSchema.properties || [],
    sections
  };
}

function allItems(schema) {
  return schema.sections.flatMap(section => section.items.map(item => ({ ...item, sectionId: section.id, sectionName: section.name })));
}

function needsIssueEvidence(condition) {
  return ['Damaged', 'Not Working'].includes(condition);
}

function safeFileName(name = 'upload.jpg') {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return acc;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function makeAdminToken() {
  return crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(`${ADMIN_USERNAME}:${ADMIN_PASSWORD}`).digest('hex');
}

function isAdminAuthenticated(req) {
  const cookies = parseCookies(req);
  const token = cookies[ADMIN_COOKIE_NAME];
  if (!token || !ADMIN_USERNAME || !ADMIN_PASSWORD) return false;
  return token === makeAdminToken();
}

function requireAdminAuth(req, res, next) {
  if (isAdminAuthenticated(req)) return next();
  return res.redirect(`/admin/login?next=${encodeURIComponent(req.originalUrl || '/admin')}`);
}

async function uploadToSupabase(file, submissionId, itemKey, isIssue = false) {
  const fileName = `${Date.now()}-${safeFileName(file.originalname || 'photo.jpg')}`;
  const objectPath = `${submissionId}/${itemKey}/${isIssue ? 'issue' : 'regular'}/${fileName}`;

  const { error: uploadError } = await supabase.storage.from(SUPABASE_BUCKET).upload(objectPath, file.buffer, {
    contentType: file.mimetype || 'application/octet-stream',
    upsert: false
  });

  if (uploadError) throw uploadError;

  const { data: pub } = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(objectPath);
  return pub.publicUrl;
}

app.get('/', (_, res) => {
  res.redirect('/form');
});

app.get('/form', (req, res) => {
  const activePropertyId = req.query.property_id || '';
  const schema = getChecklistForProperty(activePropertyId || null);
  res.render('form', { schema, activePropertyId, error: null, formData: {} });
});

app.get('/submit', (_, res) => {
  res.redirect('/form');
});

app.post('/submit', upload.any(), async (req, res) => {
  try {
    const { property_id, cleaner_name, cleaning_date } = req.body;
    const schema = getChecklistForProperty(property_id || null);

    if (!property_id || !cleaner_name) {
      return res.status(400).render('form', { schema, activePropertyId: property_id || '', error: 'Property and cleaner name are required.', formData: req.body || {} });
    }

    const filesByField = {};
    (req.files || []).forEach(file => {
      if (!filesByField[file.fieldname]) filesByField[file.fieldname] = [];
      filesByField[file.fieldname].push(file);
    });

    const items = allItems(schema);

    for (const item of items) {
      const condition = req.body[`condition__${item.key}`];
      if (item.requiresPhoto) {
        const photos = filesByField[`photos__${item.key}`] || [];
        if (photos.length < (item.minPhotos || 1)) {
          return res.status(400).render('form', { schema, activePropertyId: property_id || '', error: `Missing required photo(s) for: ${item.label}`, formData: req.body || {} });
        }
      }

      if (needsIssueEvidence(condition)) {
        const issueNote = req.body[`issue_note__${item.key}`];
        const issuePhotos = filesByField[`issue_photos__${item.key}`] || [];
        if (!issueNote || !issueNote.trim()) {
          return res.status(400).render('form', { schema, activePropertyId: property_id || '', error: `Issue note required for: ${item.label}`, formData: req.body || {} });
        }
        if (!issuePhotos.length) {
          return res.status(400).render('form', { schema, activePropertyId: property_id || '', error: `Issue photo required for: ${item.label}`, formData: req.body || {} });
        }
      }
    }

    const now = dayjs().toISOString();
    const { data: submission, error: subErr } = await supabase
      .from('submissions')
      .insert({ property_id, cleaner_name, cleaning_date: cleaning_date || null, created_at: now })
      .select()
      .single();

    if (subErr) throw subErr;
    const submissionId = submission.id;

    for (const item of items) {
      const completed = !!req.body[`complete__${item.key}`];
      const condition = req.body[`condition__${item.key}`] || null;
      const notes = req.body[`notes__${item.key}`] || null;
      const issueNote = req.body[`issue_note__${item.key}`] || null;

      const { error: respErr } = await supabase.from('responses').insert({
        submission_id: submissionId,
        item_key: item.key,
        completed,
        condition,
        notes,
        issue_note: issueNote
      });
      if (respErr) throw respErr;

      for (const file of filesByField[`photos__${item.key}`] || []) {
        const publicUrl = await uploadToSupabase(file, submissionId, item.key, false);
        const { error: photoErr } = await supabase.from('photos').insert({
          submission_id: submissionId,
          item_key: item.key,
          file_path: publicUrl,
          original_name: file.originalname,
          is_issue: false,
          created_at: now
        });
        if (photoErr) throw photoErr;
      }

      for (const file of filesByField[`issue_photos__${item.key}`] || []) {
        const publicUrl = await uploadToSupabase(file, submissionId, item.key, true);
        const { error: photoErr } = await supabase.from('photos').insert({
          submission_id: submissionId,
          item_key: item.key,
          file_path: publicUrl,
          original_name: file.originalname,
          is_issue: true,
          created_at: now
        });
        if (photoErr) throw photoErr;
      }
    }

    res.redirect(`/submitted/${submissionId}`);
  } catch (err) {
    console.error('Submit error:', err);
    const propertyId = req.body?.property_id || '';
    const schema = getChecklistForProperty(propertyId || null);
    res.status(500).render('form', { schema, activePropertyId: propertyId, error: `Submit failed: ${err.message}`, formData: req.body || {} });
  }
});

app.get('/submitted/:id', async (req, res) => {
  const { data: submission } = await supabase.from('submissions').select('*').eq('id', req.params.id).single();
  if (!submission) return res.status(404).send('Submission not found');
  const schema = getChecklistForProperty(submission.property_id);
  res.render('submitted', { submission, schema });
});

app.get('/admin/login', (req, res) => {
  res.render('admin-login', { error: null, next: req.query.next || '/admin' });
});

app.post('/admin/login', (req, res) => {
  const { username, password, next } = req.body;
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    return res.status(500).render('admin-login', { error: 'Admin credentials are not configured on server.', next: next || '/admin' });
  }

  if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
    return res.status(401).render('admin-login', { error: 'Invalid username or password.', next: next || '/admin' });
  }

  const token = makeAdminToken();
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
  return res.redirect(next || '/admin');
});

app.get('/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', `${ADMIN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.redirect('/admin/login');
});

app.get('/admin', requireAdminAuth, async (_, res) => {
  const { data: submissions, error } = await supabase
    .from('submissions')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return res.status(500).send(error.message);
  res.render('admin', { submissions: submissions || [], schema: rawSchema });
});

app.get('/admin/submissions/:id', requireAdminAuth, async (req, res) => {
  const { data: submission } = await supabase.from('submissions').select('*').eq('id', req.params.id).single();
  if (!submission) return res.status(404).send('Submission not found');

  const [{ data: responses }, { data: photos }] = await Promise.all([
    supabase.from('responses').select('*').eq('submission_id', req.params.id),
    supabase.from('photos').select('*').eq('submission_id', req.params.id)
  ]);

  const responseMap = Object.fromEntries((responses || []).map(r => [r.item_key, r]));
  const photoMap = (photos || []).reduce((acc, p) => {
    if (!acc[p.item_key]) acc[p.item_key] = { regular: [], issue: [] };
    acc[p.item_key][p.is_issue ? 'issue' : 'regular'].push(p);
    return acc;
  }, {});

  const schema = getChecklistForProperty(submission.property_id);
  res.render('submission-detail', { submission, schema, responseMap, photoMap });
});

app.listen(PORT, () => {
  console.log(`Checklist app running on http://localhost:${PORT}`);
});
