const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { upload, extractKnowledgeWithClaude, saveToAirtable, getActiveModules } = require('./knowledgeBase');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security headers ─────────────────────────────────────────────────────────
app.use(helmet({
  // Allow inline scripts that the PWA relies on
  contentSecurityPolicy: false
}));

// ── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
  : [];
const corsOptions = allowedOrigins.length
  ? { origin: allowedOrigins, credentials: true }
  : { origin: true, credentials: true };
app.use(cors(corsOptions));

app.use(express.json());
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

// ── JWT helpers ───────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  console.warn('[AUTH] JWT_SECRET env var not set — using an insecure default. Set it in production!');
  return 'change-me-in-production-please';
})();
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

// ── Rate limiter — login / register ─────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 attempts per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts — please wait 15 minutes before trying again.' }
});

// ── Airtable helpers ─────────────────────────────────────────────────────────
function getAirtableEnv() {
  const token = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!token || !baseId) {
    return { error: 'AIRTABLE_TOKEN and AIRTABLE_BASE_ID must be configured on the backend.' };
  }
  return { token, baseId };
}

const AIRTABLE_TIMEOUT_MS = 8000;

async function airtableFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AIRTABLE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── User lookup / creation via Airtable ─────────────────────────────────────
const USERS_TABLE = process.env.AIRTABLE_USERS_TABLE || 'Users';

async function findUserByUsername(airtable, username) {
  const params = new URLSearchParams({
    filterByFormula: `{Username}='${username.replace(/'/g, "\\'")}'`,
    maxRecords: '1'
  });
  const res = await airtableFetch(
    `https://api.airtable.com/v0/${airtable.baseId}/${encodeURIComponent(USERS_TABLE)}?${params}`,
    { headers: { Authorization: `Bearer ${airtable.token}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.records?.[0] || null;
}

async function createUserInAirtable(airtable, username, passwordHash) {
  const res = await airtableFetch(
    `https://api.airtable.com/v0/${airtable.baseId}/${encodeURIComponent(USERS_TABLE)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${airtable.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        records: [{ fields: { Username: username, PasswordHash: passwordHash, CreatedAt: new Date().toISOString() } }]
      })
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Failed to create user');
  return data.records?.[0];
}

// ── Input validation ─────────────────────────────────────────────────────────
function validateCredentials(username, password) {
  if (!username || typeof username !== 'string' || username.length < 2 || username.length > 64) {
    return 'Username must be between 2 and 64 characters.';
  }
  if (!password || typeof password !== 'string' || password.length < 6 || password.length > 128) {
    return 'Password must be between 6 and 128 characters.';
  }
  return null;
}

// ── POST /login ──────────────────────────────────────────────────────────────
app.post('/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  const validationError = validateCredentials(username, password);
  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  const airtable = getAirtableEnv();
  if (airtable.error) {
    return res.status(500).json({ success: false, message: 'Server configuration error.' });
  }

  try {
    const record = await findUserByUsername(airtable, username);

    if (!record) {
      // Constant-time delay to prevent user enumeration
      await bcrypt.compare(password, '$2b$12$invalidhashpadding000000000000000000000000000000000000000');
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    const storedHash = record.fields?.PasswordHash;
    if (!storedHash) {
      return res.status(401).json({ success: false, message: 'Account not set up for password login.' });
    }

    const passwordMatch = await bcrypt.compare(password, storedHash);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: 'Invalid username or password.' });
    }

    const token = signToken({ username, recordId: record.id });
    return res.json({ success: true, token, username });

  } catch (err) {
    console.error('[Login] Error:', err.message);
    if (err.name === 'AbortError') {
      return res.status(504).json({ success: false, message: 'User service timed out. Please try again.' });
    }
    return res.status(502).json({ success: false, message: 'Unable to reach user service. Please try again.' });
  }
});

// ── POST /register ───────────────────────────────────────────────────────────
app.post('/register', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};

  const validationError = validateCredentials(username, password);
  if (validationError) {
    return res.status(400).json({ success: false, message: validationError });
  }

  const airtable = getAirtableEnv();
  if (airtable.error) {
    return res.status(500).json({ success: false, message: 'Server configuration error.' });
  }

  try {
    // Check if user already exists
    const existing = await findUserByUsername(airtable, username);
    if (existing) {
      return res.status(409).json({ success: false, message: 'Username already taken.' });
    }

    const BCRYPT_ROUNDS = 12;
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await createUserInAirtable(airtable, username, passwordHash);

    const token = signToken({ username });
    return res.status(201).json({ success: true, token, username });

  } catch (err) {
    console.error('[Register] Error:', err.message);
    if (err.name === 'AbortError') {
      return res.status(504).json({ success: false, message: 'User service timed out. Please try again.' });
    }
    return res.status(502).json({ success: false, message: 'Unable to create account. Please try again.' });
  }
});

// ── JWT verification middleware (for protected routes) ────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Missing or invalid authorization header.' });
  }
  const token = authHeader.slice(7);
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token expired or invalid. Please log in again.' });
  }
}

// ── GET /config ──────────────────────────────────────────────────────────────
app.get('/config', (req, res) => {
  res.json({ serverUrl: process.env.SERVER_URL || '' });
});

// ── GET /health ───────────────────────────────────────────────────────────────
// Open endpoint — shows which env vars are set without exposing values.
app.get('/health', (req, res) => {
  const checks = {
    AIRTABLE_TOKEN:   !!process.env.AIRTABLE_TOKEN,
    AIRTABLE_BASE_ID: !!process.env.AIRTABLE_BASE_ID,
    JWT_SECRET:       !!process.env.JWT_SECRET,
    AIRTABLE_USERS_TABLE: process.env.AIRTABLE_USERS_TABLE || '(default: Users)',
  };
  const allOk = checks.AIRTABLE_TOKEN && checks.AIRTABLE_BASE_ID;
  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ok' : 'misconfigured',
    checks,
    missing: Object.entries(checks).filter(([, v]) => v === false).map(([k]) => k),
    hint: allOk ? 'All required env vars are set.' : 'Set the missing env vars in your Render dashboard under Environment.',
  });
});

// ── POST /dailylogs ──────────────────────────────────────────────────────────
app.post('/dailylogs', async (req, res) => {
  const airtable = getAirtableEnv();
  if (airtable.error) return res.status(500).json({ error: airtable.error });

  try {
    const response = await airtableFetch(`https://api.airtable.com/v0/${airtable.baseId}/DailyLogs`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${airtable.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    if (error.name === 'AbortError') return res.status(504).json({ error: 'Airtable request timed out' });
    return res.status(502).json({ error: 'Failed to reach Airtable', details: String(error) });
  }
});

// ── GET /dailylogs ───────────────────────────────────────────────────────────
app.get('/dailylogs', async (req, res) => {
  const airtable = getAirtableEnv();
  if (airtable.error) return res.status(500).json({ error: airtable.error });

  const username = req.query.username;
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'username query param is required' });
  }

  const params = new URLSearchParams({
    filterByFormula: `Username='${username}'`,
    'sort[0][field]': 'Date',
    'sort[0][direction]': 'desc'
  });

  try {
    const response = await airtableFetch(
      `https://api.airtable.com/v0/${airtable.baseId}/DailyLogs?${params.toString()}`,
      { headers: { Authorization: `Bearer ${airtable.token}` } }
    );
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    if (error.name === 'AbortError') return res.status(504).json({ error: 'Airtable request timed out' });
    return res.status(502).json({ error: 'Failed to reach Airtable', details: String(error) });
  }
});

// ── Templates (GET / POST / DELETE) ─────────────────────────────────────────
const TEMPLATES_TABLE = process.env.AIRTABLE_TEMPLATES_TABLE || 'ResistanceTemplates';

app.get('/templates', async (req, res) => {
  const airtable = getAirtableEnv();
  if (airtable.error) return res.status(500).json({ success: false, error: airtable.error });

  const username = req.query.username;
  if (!username || typeof username !== 'string') {
    return res.status(400).json({ success: false, error: 'username query param is required' });
  }

  const params = new URLSearchParams({
    filterByFormula: `{Username}='${username.replace(/'/g, "\\'")}'`,
    'sort[0][field]': 'TemplateName',
    'sort[0][direction]': 'asc'
  });

  try {
    const response = await airtableFetch(
      `https://api.airtable.com/v0/${airtable.baseId}/${encodeURIComponent(TEMPLATES_TABLE)}?${params}`,
      { headers: { Authorization: `Bearer ${airtable.token}` } }
    );
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ success: false, error: data?.error?.message || 'Airtable error' });
    }
    const items = (data.records || []).map(r => ({
      id: r.id,
      name: r.fields?.TemplateName || 'Untitled',
      TemplateName: r.fields?.TemplateName,
      TemplateData: r.fields?.TemplateData,
      username: r.fields?.Username
    }));
    return res.json({ success: true, items });
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ success: false, error: 'Request timed out' });
    return res.status(502).json({ success: false, error: 'Failed to reach Airtable' });
  }
});

app.post('/templates', async (req, res) => {
  const airtable = getAirtableEnv();
  if (airtable.error) return res.status(500).json({ success: false, error: airtable.error });

  const { username, templateName, templateData } = req.body || {};
  if (!username || !templateName) {
    return res.status(400).json({ success: false, error: 'username and templateName are required' });
  }

  try {
    const response = await airtableFetch(
      `https://api.airtable.com/v0/${airtable.baseId}/${encodeURIComponent(TEMPLATES_TABLE)}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${airtable.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          records: [{
            fields: {
              Username: username,
              TemplateName: templateName,
              TemplateData: typeof templateData === 'string' ? templateData : JSON.stringify(templateData)
            }
          }]
        })
      }
    );
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ success: false, error: data?.error?.message || 'Airtable error' });
    }
    return res.status(201).json({ success: true, record: data.records?.[0] });
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ success: false, error: 'Request timed out' });
    return res.status(502).json({ success: false, error: 'Failed to reach Airtable' });
  }
});

app.delete('/templates/:recordId', async (req, res) => {
  const airtable = getAirtableEnv();
  if (airtable.error) return res.status(500).json({ success: false, error: airtable.error });

  const { recordId } = req.params;
  if (!recordId) return res.status(400).json({ success: false, error: 'recordId is required' });

  try {
    const response = await airtableFetch(
      `https://api.airtable.com/v0/${airtable.baseId}/${encodeURIComponent(TEMPLATES_TABLE)}/${encodeURIComponent(recordId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${airtable.token}` }
      }
    );
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ success: false, error: data?.error?.message || 'Airtable error' });
    }
    return res.json({ success: true, deleted: data.deleted });
  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ success: false, error: 'Request timed out' });
    return res.status(502).json({ success: false, error: 'Failed to reach Airtable' });
  }
});

// ── POST /workoutlogs/archive ────────────────────────────────────────────────
app.post('/workoutlogs/archive', async (req, res) => {
  const airtable = getAirtableEnv();
  if (airtable.error) return res.status(500).json({ error: airtable.error });

  const tableName = process.env.AIRTABLE_WORKOUT_TABLE || 'WorkoutLogs';
  const { records } = req.body;

  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'records array is required and must not be empty' });
  }

  const BATCH_SIZE = 10;
  const batches = [];
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    batches.push(records.slice(i, i + BATCH_SIZE));
  }

  const archived = [];
  const errors = [];

  for (const batch of batches) {
    try {
      const response = await airtableFetch(
        `https://api.airtable.com/v0/${airtable.baseId}/${encodeURIComponent(tableName)}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${airtable.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: batch.map(r => ({ fields: r })) })
        }
      );
      const data = await response.json();
      if (!response.ok) errors.push({ status: response.status, ...data });
      else archived.push(...(data.records || []));
    } catch (err) {
      errors.push({ error: String(err) });
    }
  }

  if (errors.length > 0 && archived.length === 0) {
    return res.status(502).json({ error: 'All batches failed to reach Airtable', details: errors });
  }
  return res.json({ archived: archived.length, ...(errors.length ? { partialErrors: errors } : {}) });
});

// ── Community groups ─────────────────────────────────────────────────────────
const { calculateLeaderboard } = require('./community');
const groups = [];
const programs = [];
const sharedPrograms = [];

app.get('/community/groups', (req, res) => {
  const { userId, goal, tag, search } = req.query;
  let result = groups;
  if (userId) result = result.filter(g => (g.members || []).includes(userId));
  if (goal) result = result.filter(g => (g.goal || '').toLowerCase().includes(goal.toLowerCase()));
  if (tag) result = result.filter(g => (g.tags || []).some(t => t.toLowerCase().includes(tag.toLowerCase())));
  if (search) result = result.filter(g => g.name.toLowerCase().includes(search.toLowerCase()));
  res.json(result);
});

app.post('/community/groups', (req, res) => {
  const { name, creatorId, goal = '', tags = [] } = req.body;
  if (!name || !creatorId) return res.status(400).json({ error: 'name and creatorId required' });
  const group = {
    id: groups.length + 1, name, goal,
    tags: Array.isArray(tags) ? tags : [],
    members: [creatorId], sharedPrograms: [], progress: {}, posts: [], programId: null
  };
  groups.push(group);
  res.json(group);
});

app.get('/api/groups', (req, res) => res.json(groups));

app.post('/api/groups', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const group = { id: groups.length + 1, name, members: [] };
  groups.push(group);
  res.json(group);
});

async function handleCreateProgram(req, res) {
  const program = req.body;
  if (!program || !program.name) return res.status(400).json({ error: 'program name required' });
  program.id = programs.length + 1;
  programs.push(program);
  res.json({ id: program.id });
}

app.post('/createProgram', handleCreateProgram);
app.post('/saveProgram', handleCreateProgram);

app.post('/shareProgram', (req, res) => {
  const { programId, recipientUsername } = req.body;
  if (!programId || !recipientUsername) return res.status(400).json({ error: 'programId and recipientUsername required' });
  sharedPrograms.push({ programId, recipientUsername });
  res.json({ ok: true });
});

app.get('/community/groups/:groupId/posts', (req, res) => {
  const g = groups.find(gr => gr.id === Number(req.params.groupId));
  if (!g) return res.status(404).json({ error: 'group not found' });
  res.json(g.posts || []);
});

app.post('/community/groups/:groupId/posts', (req, res) => {
  const g = groups.find(gr => gr.id === Number(req.params.groupId));
  if (!g) return res.status(404).json({ error: 'group not found' });
  const { userId, text } = req.body;
  if (!userId || !text) return res.status(400).json({ error: 'userId and text required' });
  if (!Array.isArray(g.posts)) g.posts = [];
  g.posts.push({ userId: Number(userId), text, date: new Date().toISOString() });
  res.json({ ok: true });
});

app.post('/community/groups/:groupId/share', (req, res) => {
  const g = groups.find(gr => gr.id === Number(req.params.groupId));
  if (!g) return res.status(404).json({ error: 'group not found' });
  const { senderId, programData } = req.body;
  if (!senderId || !programData) return res.status(400).json({ error: 'senderId and programData required' });
  g.sharedPrograms.push({ senderId, programData });
  res.json({ ok: true });
});

app.get('/community/groups/:groupId/progress', (req, res) => {
  const g = groups.find(gr => gr.id === Number(req.params.groupId));
  if (!g) return res.status(404).json({ error: 'group not found' });
  const members = Object.entries(g.progress || {}).map(([id, data]) => ({ userId: id, ...data }));
  res.json({ members, leaderboard: calculateLeaderboard(members) });
});

// ── Leaderboard ──────────────────────────────────────────────────────────────
const leaderboard = [
  { id: 1, name: 'Alice', workoutsLogged: 45, studyHours: 30, groupActivity: 120, weeklyVolume: [500, 700, 650, 800], progress: [10, 12, 14, 15, 16] },
  { id: 2, name: 'Bob',   workoutsLogged: 30, studyHours: 40, groupActivity: 100, weeklyVolume: [400, 600, 550, 500], progress: [8, 9, 11, 13, 14] },
  { id: 3, name: 'Cara',  workoutsLogged: 35, studyHours: 55, groupActivity: 90,  weeklyVolume: [450, 500, 470, 520], progress: [15, 14, 16, 18, 20] }
];
app.get('/leaderboard', (req, res) => res.json(leaderboard));

// ── AI routes ────────────────────────────────────────────────────────────────
const aiRoutes = require('./src/routes/ai');
app.use('/api/ai', aiRoutes);

// ── Airtable proxy ───────────────────────────────────────────────────────────
app.all('/airtable/:baseId/:table', async (req, res) => {
  const airtable = getAirtableEnv();
  if (airtable.error) return res.status(500).json({ error: airtable.error });

  const { baseId, table } = req.params;
  if (baseId !== airtable.baseId) return res.status(403).json({ error: 'Invalid Airtable base requested.' });

  const query = new URLSearchParams(req.query).toString();
  const url = `https://api.airtable.com/v0/${baseId}/${table}${query ? `?${query}` : ''}`;

  try {
    const response = await airtableFetch(url, {
      method: req.method,
      headers: { Authorization: `Bearer ${airtable.token}`, 'Content-Type': 'application/json' },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : JSON.stringify(req.body)
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    if (error.name === 'AbortError') return res.status(504).json({ error: 'Airtable request timed out' });
    return res.status(502).json({ error: 'Failed to reach Airtable', details: String(error) });
  }
});

// ── Knowledge Base routes ────────────────────────────────────────────────────

// POST /admin/ingest-pdf — upload and process a PDF module
app.post('/admin/ingest-pdf', upload.single('pdf'), async (req, res) => {
  try {
    const { moduleName, topic } = req.body;

    if (!req.file) return res.status(400).json({ error: 'No PDF file received' });
    if (!moduleName) return res.status(400).json({ error: 'moduleName is required' });
    if (!topic) return res.status(400).json({ error: 'topic is required' });

    const airtable = getAirtableEnv();
    if (airtable.error) return res.status(500).json({ error: airtable.error });

    const pdfData = await pdfParse(req.file.buffer);
    const text = pdfData.text;

    if (!text || text.trim().length < 100) {
      return res.status(422).json({ error: 'PDF appears to be empty or unreadable' });
    }

    const extracted = await extractKnowledgeWithClaude(text, moduleName, topic);

    const record = await saveToAirtable(airtable.token, airtable.baseId, {
      ModuleName: moduleName,
      Topic: topic,
      SourceFile: req.file.originalname,
      ExtractedJSON: JSON.stringify(extracted),
      Version: 1,
      ProcessedAt: new Date().toISOString().slice(0, 10),
      IsActive: true
    });

    res.json({
      success: true,
      recordId: record.id,
      moduleName,
      topic,
      fieldsExtracted: Object.keys(extracted).filter(k =>
        Array.isArray(extracted[k]) ? extracted[k].length > 0 : !!extracted[k]
      )
    });

  } catch (err) {
    console.error('[KnowledgeBase] Ingest error:', err);
    res.status(500).json({ error: 'Ingestion failed', details: err.message });
  }
});

// GET /admin/knowledge-modules — list all ingested modules
app.get('/admin/knowledge-modules', async (req, res) => {
  try {
    const airtable = getAirtableEnv();
    if (airtable.error) return res.status(500).json({ error: airtable.error });

    const modules = await getActiveModules(airtable.token, airtable.baseId);
    res.json({ modules });
  } catch (err) {
    console.error('[KnowledgeBase] Fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch modules' });
  }
});

// GET /knowledge-context?topics=training,nutrition — used by AI router
app.get('/knowledge-context', async (req, res) => {
  try {
    const airtable = getAirtableEnv();
    if (airtable.error) return res.status(500).json({ error: airtable.error });

    const topicsParam = req.query.topics;
    const topics = topicsParam ? topicsParam.split(',').map(t => t.trim()) : null;

    let allModules = [];
    if (topics && topics.length > 0) {
      const fetches = topics.map(t => getActiveModules(airtable.token, airtable.baseId, t));
      const results = await Promise.all(fetches);
      allModules = results.flat();
    } else {
      allModules = await getActiveModules(airtable.token, airtable.baseId);
    }

    const context = allModules.reduce((acc, mod) => {
      acc[mod.moduleName] = mod.extractedJSON;
      return acc;
    }, {});

    res.json({ context, modulesLoaded: allModules.map(m => m.moduleName) });
  } catch (err) {
    console.error('[KnowledgeBase] Context error:', err);
    res.status(500).json({ error: 'Failed to build knowledge context' });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
