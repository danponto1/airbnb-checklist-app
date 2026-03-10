const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const dayjs = require('dayjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
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

const NOTIFY_EMAIL_TO = process.env.NOTIFY_EMAIL_TO || 'hello@cityofgoodmaids.info';
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE = String(process.env.SMTP_SECURE || 'false') === 'true';
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const SMTP_CONNECTION_TIMEOUT = Number(process.env.SMTP_CONNECTION_TIMEOUT || 10000);
const SMTP_GREETING_TIMEOUT = Number(process.env.SMTP_GREETING_TIMEOUT || 10000);
const SMTP_SOCKET_TIMEOUT = Number(process.env.SMTP_SOCKET_TIMEOUT || 15000);

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

const mailer = (SMTP_HOST && SMTP_USER && SMTP_PASS)
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      connectionTimeout: SMTP_CONNECTION_TIMEOUT,
      greetingTimeout: SMTP_GREETING_TIMEOUT,
      socketTimeout: SMTP_SOCKET_TIMEOUT
    })
  : null;

console.log('[email] config', JSON.stringify({
  enabled: !!mailer,
  host: SMTP_HOST || null,
  port: SMTP_PORT,
  secure: SMTP_SECURE,
  userSet: !!SMTP_USER,
  passSet: !!SMTP_PASS,
  fromSet: !!SMTP_FROM,
  to: NOTIFY_EMAIL_TO || null,
  connectionTimeoutMs: SMTP_CONNECTION_TIMEOUT,
  greetingTimeoutMs: SMTP_GREETING_TIMEOUT,
  socketTimeoutMs: SMTP_SOCKET_TIMEOUT
}));

if (mailer) {
  mailer.verify()
    .then(() => console.log('[email] verify ok'))
    .catch((err) => console.error('[email] verify failed', JSON.stringify({
      code: err?.code || null,
      responseCode: err?.responseCode || null,
      command: err?.command || null,
      message: err?.message || String(err)
    })));
}

async function sendSubmissionEmail({ submissionId, propertyId, cleanerName, cleaningDate, createdAt }) {
  if (!mailer || !SMTP_FROM || !NOTIFY_EMAIL_TO) {
    console.warn('[email] skipped', JSON.stringify({
      submissionId,
      reason: 'mailer/from/to missing',
      mailer: !!mailer,
      fromSet: !!SMTP_FROM,
      toSet: !!NOTIFY_EMAIL_TO
    }));
    return;
  }
  const propertyName = (rawSchema.properties || []).find(p => p.id === propertyId)?.name || propertyId;

  const subject = `New checklist submission #${submissionId} - ${propertyName}`;
  const text = [
    'A new cleaning checklist was submitted.',
    `Submission ID: ${submissionId}`,
    `Property: ${propertyName}`,
    `Cleaner: ${cleanerName}`,
    `Cleaning Date: ${cleaningDate || '-'}`,
    `Submitted At: ${createdAt}`
  ].join('\n');

  console.log('[email] sending', JSON.stringify({ submissionId, to: NOTIFY_EMAIL_TO, from: SMTP_FROM, subject }));
  const info = await Promise.race([
    mailer.sendMail({
      from: SMTP_FROM,
      to: NOTIFY_EMAIL_TO,
      subject,
      text
    }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP send timeout')), SMTP_SOCKET_TIMEOUT + 1000))
  ]);
  console.log('[email] sent', JSON.stringify({ submissionId, messageId: info?.messageId || null, response: info?.response || null }));
}

const rawSchema = JSON.parse(fs.readFileSync(path.join(__dirname, 'checklist.schema.json'), 'utf8'));
const schema5378 = JSON.parse(fs.readFileSync(path.join(__dirname, 'checklist.5378.json'), 'utf8'));
const schema5436 = JSON.parse(fs.readFileSync(path.join(__dirname, 'checklist.5436.json'), 'utf8'));

const storage = multer.memoryStorage();
const upload = multer({ storage });

const I18N = {
  en: {
    languageLabel: 'Language',
    english: 'English',
    spanish: 'Español',
    cleaningChecklist: 'Cleaning Checklist',
    adminSubmissions: 'Admin submissions',
    jobDetails: 'Job Details',
    property: 'Property',
    selectProperty: 'Select property',
    cleanerName: 'Cleaner Name',
    cleaningDate: 'Cleaning Date',
    condition: 'Condition',
    requiredPhotos: 'Required photo(s)',
    optionalPhoto: 'Optional photo',
    notesOptional: 'Notes (optional)',
    issueNote: 'Issue note',
    issuePhotos: 'Issue photo(s)',
    issuePrompt: 'Damaged / Not Working selected — issue note + issue photo required.',
    submitChecklist: 'Submit Checklist',
    photoReselectHint: 'Your text/checkbox selections were kept. Photo files must be re-selected by browser security rules.'
  },
  es: {
    languageLabel: 'Idioma',
    english: 'English',
    spanish: 'Español',
    cleaningChecklist: 'Lista de limpieza',
    adminSubmissions: 'Envíos del administrador',
    jobDetails: 'Detalles del trabajo',
    property: 'Propiedad',
    selectProperty: 'Seleccione propiedad',
    cleanerName: 'Nombre del personal de limpieza',
    cleaningDate: 'Fecha de limpieza',
    condition: 'Condición',
    requiredPhotos: 'Foto(s) requerida(s)',
    optionalPhoto: 'Foto opcional',
    notesOptional: 'Notas (opcional)',
    issueNote: 'Nota del problema',
    issuePhotos: 'Foto(s) del problema',
    issuePrompt: 'Se seleccionó Dañado / No funciona — se requiere nota y foto del problema.',
    submitChecklist: 'Enviar lista',
    photoReselectHint: 'Se conservaron textos y casillas. Por seguridad del navegador, las fotos deben volver a seleccionarse.'
  }
};

const OPTION_TRANSLATIONS = {
  es: {
    Good: 'Bueno',
    Dirty: 'Sucio',
    Damaged: 'Dañado',
    'Not Working': 'No funciona',
    Yes: 'Sí',
    No: 'No',
    'Nothing Damaged': 'Nada dañado'
  }
};

const SECTION_TRANSLATIONS = {
  es: {
    'First Question': 'Primera pregunta',
    Interior: 'Interior',
    Exterior: 'Exterior',
    'Before You Leave': 'Antes de irse'
  }
};

const INSTRUCTION_TRANSLATIONS = {
  es: {
    'Checkbox completion is the most important item.': 'Marcar la casilla de completado es lo más importante.',
    'Optional photo fields are compact — open only when needed.': 'Los campos de foto opcional son compactos: ábrelos solo cuando sea necesario.',
    'Walk around first and take photos of any broken, missing, or damaged items.': 'Primero recorra la propiedad y tome fotos de cualquier artículo roto, faltante o dañado.'
  }
};

const ITEM_TRANSLATIONS = {
  es: {
    'walkthrough-damage-check': 'Por favor, recorra primero la propiedad y tome fotos de cualquier artículo roto, faltante o dañado.',
    'bedroom1-floor': 'Dormitorio 1: Aspirar/trapear/barrer el piso',
    'bedroom1-bed-setup': 'Dormitorio 1/Cama: Retirar sábanas, revisar cubrecolchón/almohadas/edredones por manchas, hacer la cama con ropa limpia',
    'bedroom1-left-items': 'Dormitorio 1: Revisar debajo de la cama y abrir todos los cajones por objetos olvidados (etiquetar y devolver a la oficina)',
    'bedroom1-bedframe': 'Dormitorio 1: Estado de la estructura y cabecera de la cama',
    'bedroom1-photo': 'Dormitorio 1: Foto del dormitorio completo una vez limpio',
    'bedroom2-floor': 'Dormitorio 2: Aspirar/trapear/barrer el piso',
    'bedroom2-bed-setup': 'Dormitorio 2/Cama: Retirar sábanas, revisar cubrecolchón/almohadas/edredones por manchas, hacer la cama con ropa limpia',
    'bedroom2-left-items': 'Dormitorio 2: Revisar debajo de la cama y abrir todos los cajones por objetos olvidados (etiquetar y devolver a la oficina)',
    'bedroom2-bedframe': 'Dormitorio 2: Estado de la estructura y cabecera de la cama',
    'bedroom2-photo': 'Dormitorio 2: Foto del dormitorio completo una vez limpio',
    'bedroom3-floor': 'Dormitorio 3: Aspirar/trapear/barrer el piso',
    'bedroom3-bed-setup': 'Dormitorio 3/Cama: Retirar sábanas, revisar cubrecolchón/almohadas/edredones por manchas, hacer la cama con ropa limpia',
    'bedroom3-left-items': 'Dormitorio 3: Revisar debajo de la cama y abrir todos los cajones por objetos olvidados (etiquetar y devolver a la oficina)',
    'bedroom3-bedframe': 'Dormitorio 3: Estado de la estructura y cabecera de la cama',
    'bedroom3-photo': 'Dormitorio 3: Foto del dormitorio completo una vez limpio',
    'matching-towels-sheets': 'Toallas y sábanas que combinen en todas las camas y baños',
    'livingroom-main': 'Sala: Limpiar todos los muebles y aspirar/trapear/barrer',
    'livingroom-couch': 'Sala/Sofá: Retirar cojines para quitar migas, colocar cojines decorativos y aspirar debajo del sofá',
    'livingroom-sleeper-sofa': 'Sala/Sofá cama: Abrir y retirar sábanas; dejar sábanas nuevas, almohadas y cobijas en el sofá',
    'livingroom-tv': 'Sala/TV inteligente: Limpiar huellas/polvo, revisar baterías del control, desinfectar controles, encender TV y verificar pantalla',
    'kitchen-trash': 'Cocina: Vaciar bote de basura y colocar bolsas nuevas',
    'kitchen-sanitize': 'Cocina: Desinfectar electrodomésticos y limpiar todas las superficies (gabinetes por dentro/fuera, encimeras, etc.)',
    'kitchen-restock': 'Cocina: Reabastecer kit inicial (1 esponja, 10 tabletas lavavajillas, 3 rollos de papel, splenda) + café/azúcar/crema/suministros',
    'kitchen-photo': 'Cocina: Foto completa de la cocina una vez limpia',
    'kitchen-dishwasher-main': 'Cocina/Lavavajillas: Vaciar platos, verificar que cierre bien la puerta, rellenar abrillantador',
    'kitchen-dishwasher-photo': 'Cocina/Lavavajillas: Foto de interior y exterior limpios',
    'kitchen-fridge-clean': 'Cocina/Refrigerador: Retirar toda la comida, limpiar repisas/cajones, limpiar frente',
    'kitchen-fridge-temp': 'Cocina/Refrigerador: Temperatura en nivel normal',
    'kitchen-fridge-photo': 'Cocina/Refrigerador: Foto de refrigerador + congelador (interior y exterior)',
    'kitchen-sink': 'Cocina/Fregadero: Limpiar fregadero, pulir grifo, limpiar salpicadero',
    'kitchen-disposal': 'Cocina/Triturador: Encender con jabón para platos; eliminar residuos y olores',
    'kitchen-microwave-main': 'Cocina/Microondas: Limpiar frente/parte trasera, limpiar bandeja, verificar botones',
    'kitchen-microwave-photo': 'Cocina/Microondas: Foto interior y exterior',
    'kitchen-toaster': 'Cocina/Tostadora: Retirar migas y limpiar debajo',
    'kitchen-stovetop': 'Cocina/Estufa: Limpiar a fondo y probar todos los quemadores',
    'kitchen-oven-main': 'Cocina/Horno: Limpiar interior/exterior; reportar si está dañado o no funciona',
    'kitchen-oven-photo': 'Cocina/Horno: Foto de la estufa completa + interior/exterior del horno',
    'laundry-room-items': 'Lavandería: Regresar artículos a lavandería si es necesario (silla alta/rejas)',
    'laundry-hangers': 'Lavandería: Retirar ganchos de huéspedes que no combinen',
    'laundry-machines-main': 'Lavandería/Lavadora-Secadora: Vaciar ambas, limpiar filtro de pelusa, dejar puerta de lavadora abierta',
    'laundry-machines-photo': 'Lavandería/Lavadora-Secadora: Foto requerida',
    'bathroom1-waste': 'Baño 1: Vaciar basurero y reemplazar bolsa',
    'bathroom1-amenities': 'Baño 1: ¿Se repusieron los amenidades?',
    'bathroom1-shower': 'Baño 1/Ducha-Bañera: Limpiar, tallar, desinfectar, quitar moho, verificar regadera y desagüe',
    'bathroom1-toilet-main': 'Baño 1/Inodoro: Limpiar, tallar y desinfectar',
    'bathroom1-toilet-photo': 'Baño 1/Inodoro: Verificar descarga + tapa abajo (foto requerida)',
    'bathroom1-sink-main': 'Baño 1/Lavabo: Limpiar/desinfectar, verificar agua fría/caliente y drenaje, pulir grifo',
    'bathroom1-sink-photo': 'Baño 1: Foto completa del baño después de limpiar (requerida)',
    'bathroom2-waste': 'Baño 2: Vaciar basurero y reemplazar bolsa',
    'bathroom2-amenities': 'Baño 2: ¿Se repusieron los amenidades?',
    'bathroom2-shower': 'Baño 2/Ducha-Bañera: Limpiar, tallar, desinfectar, quitar moho, verificar regadera y desagüe',
    'bathroom2-toilet-main': 'Baño 2/Inodoro: Limpiar, tallar y desinfectar',
    'bathroom2-toilet-photo': 'Baño 2/Inodoro: Verificar descarga + tapa abajo (foto requerida)',
    'bathroom2-sink-main': 'Baño 2/Lavabo: Limpiar/desinfectar, verificar agua fría/caliente y drenaje, pulir grifo',
    'bathroom2-sink-photo': 'Baño 2: Foto completa del baño después de limpiar (requerida)',
    'front-door': 'Puerta principal: estado',
    'deck-main': 'Deck: Barrer',
    'deck-furniture': 'Deck: Limpiar muebles de frente/superior/granero',
    'deck-patio': 'Deck/Muebles de patio: Limpiar y devolver a su lugar',
    'grill': 'Parrilla: Raspar rejillas con cepillo de alambre',
    'grill-dirty-note': 'Por favor, avísenos si la parrilla está demasiado sucia',
    'firepit': 'Área de fogata limpia y sillas en su lugar',
    'dart-board': 'Diana: Estado',
    'dart-board-clean': 'Diana: Limpiar diana, pizarra y revisar dardos',
    'garage-condition': 'Garaje: Estado',
    'garage-can': 'Bote del garaje',
    'mini-fridge-condition': 'Mini refrigerador: Estado',
    'mini-fridge-clean': 'Mini refrigerador: Limpiar refrigerador del garaje',
    'minibar-condition': 'Minibar: Estado',
    'pingpong-condition': 'Mesa de ping pong: Estado',
    'pingpong-clean': 'Mesa de ping pong: Limpiar y revisar inventario',
    'door-mats-condition': 'Tapetes de puerta: Estado',
    'door-mats-replace': 'Tapetes de puerta: Revisar y reemplazar tapetes sucios',
    'high-chair-condition': 'Silla alta: Estado',
    'high-chair-clean': 'Silla alta: Limpiar sillas altas',
    'exercise-clean': 'Cuarto de ejercicio: Limpiar el área',
    'exercise-condition': 'Cuarto de ejercicio: Estado',
    'secure-property': 'Asegurar propiedad: cerrar y asegurar puertas y ventanas',
    'windows-locked': 'Verificar que todas las ventanas estén cerradas y aseguradas',
    'guest-house-main': 'Casa de huéspedes: Limpia y desinfectada',
    'guest-house-photo': 'Casa de huéspedes: Fotos de muebles y otras áreas',
    'propane-tanks': 'Tanques de propano: ¿Cuál es el nivel actual del tanque? (levantar para estimar; método de agua caliente opcional)'
  }
};

const EXTRA_LABEL_TRANSLATIONS = {
  es: {
    dart_count: '¿Cuántos dardos hay?',
    cornhole_bags: '¿Hay al menos 8 bolsas para Cornhole?',
    can_jam_frisbee: '¿Hay frisbee para el juego Can Jam?',
    propane_check: 'Levante el tanque de propano para confirmar que tiene gas',
    mat_count: '¿Cuántos tapetes de puerta hay?',
    propane_level_note: 'Nivel actual de propano (texto libre)'
  }
};

function normalizeLang(input) {
  return input === 'es' ? 'es' : 'en';
}

function tOption(value, lang) {
  return (OPTION_TRANSLATIONS[lang] && OPTION_TRANSLATIONS[lang][value]) || value;
}

function tSectionName(section, lang) {
  return (SECTION_TRANSLATIONS[lang] && SECTION_TRANSLATIONS[lang][section.name]) || section.name;
}

function tInstruction(text, lang) {
  return (INSTRUCTION_TRANSLATIONS[lang] && INSTRUCTION_TRANSLATIONS[lang][text]) || text;
}

function tItemLabel(item, lang) {
  return (ITEM_TRANSLATIONS[lang] && ITEM_TRANSLATIONS[lang][item.key]) || item.label;
}

function tConditionLabel(item, lang, fallback) {
  const raw = item.conditionLabel || fallback;
  return tInstruction(raw, lang);
}

function tExtraLabel(extra, lang) {
  return (EXTRA_LABEL_TRANSLATIONS[lang] && EXTRA_LABEL_TRANSLATIONS[lang][extra.name]) || extra.label;
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const started = Date.now();
  console.log('[http] req', JSON.stringify({ method: req.method, path: req.path }));
  res.on('finish', () => {
    console.log('[http] res', JSON.stringify({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started }));
  });
  next();
});

function getChecklistForProperty(propertyId) {
  let selected = rawSchema;
  if (propertyId === 'big-tree-5378') selected = schema5378;
  if (propertyId === 'big-tree-5436') selected = schema5436;
  return {
    properties: rawSchema.properties || [],
    sections: selected.sections || []
  };
}

function allItems(schema) {
  return schema.sections.flatMap(section => section.items.map(item => ({ ...item, sectionId: section.id, sectionName: section.name })));
}

function needsIssueEvidence(condition) {
  return ['Damaged', 'Not Working'].includes(condition);
}

function requiresPhotoForItem(item, condition) {
  if (item.requiresPhoto) return true;
  if (item.optionalPhoto && item.photoRequiredUnlessGood) {
    const okayValue = item.photoOptionalWhen || 'Good';
    return !!condition && condition !== okayValue;
  }
  return false;
}

function buildCombinedNotes(item, body) {
  const parts = [];
  const baseNotes = body[`notes__${item.key}`];
  if (baseNotes && baseNotes.trim()) parts.push(baseNotes.trim());

  (item.extraFields || []).forEach(field => {
    const value = body[`extra__${item.key}__${field.name}`];
    if (value === undefined || value === null || `${value}`.trim() === '') return;
    parts.push(`${field.label}: ${value}`);
  });

  return parts.length ? parts.join('\n') : null;
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
  const lang = normalizeLang(req.query.lang);
  const schema = getChecklistForProperty(activePropertyId || null);
  res.render('form', { schema, activePropertyId, lang, i18n: I18N[lang], tOption, tSectionName, tInstruction, tItemLabel, tConditionLabel, tExtraLabel, error: null, formData: {} });
});

app.get('/submit', (_, res) => {
  res.redirect('/form');
});

app.post('/submit', upload.any(), async (req, res) => {
  try {
    const { property_id, cleaner_name, cleaning_date } = req.body;
    const lang = normalizeLang(req.body.lang || req.query.lang);
    const schema = getChecklistForProperty(property_id || null);

    if (!property_id || !cleaner_name) {
      return res.status(400).render('form', { schema, activePropertyId: property_id || '', lang, i18n: I18N[lang], tOption, tSectionName, tInstruction, tItemLabel, tConditionLabel, tExtraLabel, error: 'Property and cleaner name are required.', formData: req.body || {} });
    }

    const filesByField = {};
    (req.files || []).forEach(file => {
      if (!filesByField[file.fieldname]) filesByField[file.fieldname] = [];
      filesByField[file.fieldname].push(file);
    });

    const items = allItems(schema);

    for (const item of items) {
      const condition = req.body[`condition__${item.key}`];

      if (item.requiredCondition && !condition) {
        return res.status(400).render('form', { schema, activePropertyId: property_id || '', lang, i18n: I18N[lang], tOption, tSectionName, tInstruction, tItemLabel, tConditionLabel, tExtraLabel, error: `Please answer: ${item.label}`, formData: req.body || {} });
      }

      if (requiresPhotoForItem(item, condition)) {
        const photos = filesByField[`photos__${item.key}`] || [];
        if (photos.length < (item.minPhotos || 1)) {
          return res.status(400).render('form', { schema, activePropertyId: property_id || '', lang, i18n: I18N[lang], tOption, tSectionName, tInstruction, tItemLabel, tConditionLabel, tExtraLabel, error: `Missing required photo(s) for: ${item.label}`, formData: req.body || {} });
        }
      }

      if (needsIssueEvidence(condition)) {
        const issueNote = req.body[`issue_note__${item.key}`];
        const issuePhotos = filesByField[`issue_photos__${item.key}`] || [];
        if (!issueNote || !issueNote.trim()) {
          return res.status(400).render('form', { schema, activePropertyId: property_id || '', lang, i18n: I18N[lang], tOption, tSectionName, tInstruction, tItemLabel, tConditionLabel, tExtraLabel, error: `Issue note required for: ${item.label}`, formData: req.body || {} });
        }
        if (!issuePhotos.length) {
          return res.status(400).render('form', { schema, activePropertyId: property_id || '', lang, i18n: I18N[lang], tOption, tSectionName, tInstruction, tItemLabel, tConditionLabel, tExtraLabel, error: `Issue photo required for: ${item.label}`, formData: req.body || {} });
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
      const notes = buildCombinedNotes(item, req.body);
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

    console.log('[submit] saved', JSON.stringify({ submissionId, propertyId: property_id, cleanerName: cleaner_name }));

    sendSubmissionEmail({
      submissionId,
      propertyId: property_id,
      cleanerName: cleaner_name,
      cleaningDate: cleaning_date || null,
      createdAt: now
    }).catch((mailErr) => {
      console.error('[email] failed', JSON.stringify({
        submissionId,
        name: mailErr?.name || null,
        code: mailErr?.code || null,
        command: mailErr?.command || null,
        responseCode: mailErr?.responseCode || null,
        response: mailErr?.response || null,
        message: mailErr?.message || String(mailErr)
      }));
    });

    res.redirect(`/submitted/${submissionId}?lang=${encodeURIComponent(lang)}`);
  } catch (err) {
    console.error('Submit error:', err);
    const propertyId = req.body?.property_id || '';
    const lang = normalizeLang(req.body?.lang || req.query?.lang);
    const schema = getChecklistForProperty(propertyId || null);
    res.status(500).render('form', { schema, activePropertyId: propertyId, lang, i18n: I18N[lang], tOption, tSectionName, tInstruction, tItemLabel, tConditionLabel, tExtraLabel, error: `Submit failed: ${err.message}`, formData: req.body || {} });
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
