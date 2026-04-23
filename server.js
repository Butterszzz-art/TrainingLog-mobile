const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

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


const { calculateLeaderboard } = require('./community');

const groups = [];
const programs = [];
const sharedPrograms = [];
const userSettings = new Map(); // username → { ...settings, updatedAt }

// ── Coaching Hub in-memory stores ──────────────────────────────────────────
// coachHub: coachId → { invites: [{ token, email, status, sentAt, clientId? }],
//                       relationships: [{ clientId, clientName, email, status, joinedAt }] }
const coachHub = new Map();
// coachNotes: `${coachId}::${clientId}` → [{ id, text, date, flagged, milestone }]
const coachNotes = new Map();

function getCoachHub(cId) {
  if (!coachHub.has(cId)) coachHub.set(cId, { invites: [], relationships: [] });
  return coachHub.get(cId);
}
function coachNotesKey(cId, clientId) {
  return `${cId}::${clientId}`;
}

// sample leaderboard data
const leaderboard = [
  {
    id: 1,
    name: 'Alice',
    workoutsLogged: 45,
    studyHours: 30,
    groupActivity: 120,
    weeklyVolume: [500, 700, 650, 800],
    progress: [10, 12, 14, 15, 16]
  },
  {
    id: 2,
    name: 'Bob',
    workoutsLogged: 30,
    studyHours: 40,
    groupActivity: 100,
    weeklyVolume: [400, 600, 550, 500],
    progress: [8, 9, 11, 13, 14]
  },
  {
    id: 3,
    name: 'Cara',
    workoutsLogged: 35,
    studyHours: 55,
    groupActivity: 90,
    weeklyVolume: [450, 500, 470, 520],
    progress: [15, 14, 16, 18, 20]
  }
];

app.get('/config', (req, res) => {
  res.json({
    serverUrl: process.env.SERVER_URL || ''
  });
});

function getAirtableEnv() {
  const token = process.env.AIRTABLE_TOKEN;
  const baseId = process.env.AIRTABLE_BASE_ID;

  if (!token || !baseId) {
    return { error: 'AIRTABLE_TOKEN and AIRTABLE_BASE_ID must be configured on the backend.' };
  }

  return { token, baseId };
}

app.post('/dailylogs', async (req, res) => {
  const airtable = getAirtableEnv();
  if (airtable.error) {
    return res.status(500).json({ error: airtable.error });
  }

  try {
    const response = await fetch(`https://api.airtable.com/v0/${airtable.baseId}/DailyLogs`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${airtable.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(502).json({ error: 'Failed to reach Airtable', details: String(error) });
  }
});

app.get('/dailylogs', async (req, res) => {
  const airtable = getAirtableEnv();
  if (airtable.error) {
    return res.status(500).json({ error: airtable.error });
  }

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
    const response = await fetch(`https://api.airtable.com/v0/${airtable.baseId}/DailyLogs?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${airtable.token}`
      }
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(502).json({ error: 'Failed to reach Airtable', details: String(error) });
  }
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username && password) {
    return res.json({ success: true });
  }
  res.status(401).json({ success: false, message: 'Invalid credentials' });
});

// Groups API
app.get('/community/groups', (req, res) => {
  const { userId, goal, tag, search } = req.query;
  let result = groups;
  if (userId) {
    result = result.filter(g => (g.members || []).includes(userId));
  }
  if (goal) {
    const gl = goal.toLowerCase();
    result = result.filter(g => (g.goal || '').toLowerCase().includes(gl));
  }
  if (tag) {
    const tg = tag.toLowerCase();
    result = result.filter(g => (g.tags || []).some(t => t.toLowerCase().includes(tg)));
  }
  if (search) {
    const s = search.toLowerCase();
    result = result.filter(g => g.name.toLowerCase().includes(s));
  }
  res.json(result);
});

app.post('/community/groups', (req, res) => {
  const { name, creatorId, goal = '', tags = [] } = req.body;
  if (!name || !creatorId) {
    return res.status(400).json({ error: 'name and creatorId required' });
  }
  const group = {
    id: groups.length + 1,
    name,
    goal,
    tags: Array.isArray(tags) ? tags : [],
    members: [creatorId],
    sharedPrograms: [],
    progress: {},
    posts: [],
    programId: null
  };
  groups.push(group);
  res.json(group);
});

app.get('/api/groups', (req, res) => {
  res.json(groups);
});

app.post('/api/groups', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const group = { id: groups.length + 1, name, members: [] };
  groups.push(group);
  res.json(group);
});

// Program creation
async function handleCreateProgram(req, res) {
  const program = req.body;
  if (!program || !program.name) {
    return res.status(400).json({ error: 'program name required' });
  }
  program.id = programs.length + 1;
  programs.push(program);
  res.json({ id: program.id });
}

app.post('/createProgram', handleCreateProgram);
app.post('/saveProgram', handleCreateProgram);

// Program sharing
app.post('/shareProgram', (req, res) => {
  const { programId, recipientUsername } = req.body;
  if (!programId || !recipientUsername) {
    return res.status(400).json({ error: 'programId and recipientUsername required' });
  }
  sharedPrograms.push({ programId, recipientUsername });
  res.json({ ok: true });
});

// Posts
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

// Program sharing API
app.post('/community/groups/:groupId/share', (req, res) => {
  const { groupId } = req.params;
  const g = groups.find(gr => gr.id === Number(groupId));
  if (!g) return res.status(404).json({ error: 'group not found' });
  const { senderId, programData } = req.body;
  if (!senderId || !programData) {
    return res.status(400).json({ error: 'senderId and programData required' });
  }
  g.sharedPrograms.push({ senderId, programData });
  res.json({ ok: true });
});

// Progress and leaderboard API
app.get('/community/groups/:groupId/progress', (req, res) => {
  const { groupId } = req.params;
  const g = groups.find(gr => gr.id === Number(groupId));
  if (!g) return res.status(404).json({ error: 'group not found' });
  const members = Object.entries(g.progress || {}).map(([id, data]) => ({
    userId: id,
    ...data
  }));
  const lb = calculateLeaderboard(members);
  res.json({ members, leaderboard: lb });
});

// basic leaderboard endpoint
app.get('/leaderboard', (req, res) => {
  res.json(leaderboard);
});


app.all('/airtable/:baseId/:table', async (req, res) => {
  const airtable = getAirtableEnv();
  if (airtable.error) {
    return res.status(500).json({ error: airtable.error });
  }

  const { baseId, table } = req.params;
  if (baseId !== airtable.baseId) {
    return res.status(403).json({ error: 'Invalid Airtable base requested.' });
  }

  const query = new URLSearchParams(req.query).toString();
  const url = `https://api.airtable.com/v0/${baseId}/${table}${query ? `?${query}` : ''}`;

  try {
    const response = await fetch(url, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${airtable.token}`,
        'Content-Type': 'application/json'
      },
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : JSON.stringify(req.body)
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(502).json({ error: 'Failed to reach Airtable', details: String(error) });
  }
});

// ── User Settings ──────────────────────────────────────────────────────────

/**
 * GET /api/user/settings?username=<username>
 * Returns persisted settings for the user, or 404 if none saved yet.
 */
app.get('/api/user/settings', (req, res) => {
  const username = req.query.username;
  if (!username || typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'username query param is required' });
  }
  const saved = userSettings.get(username.trim());
  if (!saved) {
    return res.status(404).json({ error: 'No settings found for this user' });
  }
  res.json(saved);
});

/**
 * PUT /api/user/settings
 * Body: { username: string, settings: object }
 * Upserts the settings object for the user.
 */
app.put('/api/user/settings', (req, res) => {
  const { username, settings } = req.body || {};
  if (!username || typeof username !== 'string' || !username.trim()) {
    return res.status(400).json({ error: 'username is required in request body' });
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return res.status(400).json({ error: 'settings must be a non-null object' });
  }
  const updatedAt = new Date().toISOString();
  userSettings.set(username.trim(), { ...settings, updatedAt });
  res.json({ ok: true, updatedAt });
});

// ── End User Settings ───────────────────────────────────────────────────────

// ── Coaching Hub ───────────────────────────────────────────────────────────

/**
 * POST /api/coach/invite
 * Body: { coachId, email }
 * Creates a pending invite in the coach's hub. Returns { ok, token, inviteLink }.
 */
app.post('/api/coach/invite', (req, res) => {
  const { coachId, email } = req.body || {};
  if (!coachId || !email || typeof email !== 'string') {
    return res.status(400).json({ error: 'coachId and email are required' });
  }
  const hub = getCoachHub(coachId);
  const existing = hub.invites.find((i) => i.email === email && i.status === 'pending');
  if (existing) {
    return res.status(409).json({ error: 'A pending invitation for this email already exists', token: existing.token });
  }
  const token = `${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`;
  const invite = { token, email, status: 'pending', sentAt: new Date().toISOString(), clientId: null };
  hub.invites.push(invite);
  res.json({ ok: true, token, inviteLink: `/coach/accept?token=${token}` });
});

/**
 * POST /api/coach/invite/accept
 * Body: { token, clientId, clientName? }
 * Client uses this to accept an invite and join the coach's hub.
 */
app.post('/api/coach/invite/accept', (req, res) => {
  const { token, clientId, clientName } = req.body || {};
  if (!token || !clientId) {
    return res.status(400).json({ error: 'token and clientId are required' });
  }
  for (const [cId, hub] of coachHub) {
    const invite = hub.invites.find((i) => i.token === token && i.status === 'pending');
    if (invite) {
      invite.status = 'accepted';
      invite.clientId = clientId;
      invite.acceptedAt = new Date().toISOString();
      // Avoid duplicate relationships
      if (!hub.relationships.some((r) => r.clientId === clientId)) {
        hub.relationships.push({
          clientId,
          clientName: clientName || clientId,
          email: invite.email,
          status: 'active',
          joinedAt: new Date().toISOString(),
        });
      }
      return res.json({ ok: true, coachId: cId });
    }
  }
  res.status(404).json({ error: 'Invalid or expired invite token' });
});

/**
 * GET /api/coach/clients?coachId=<coachId>
 * Returns all clients (active + pending invites) in the coach's hub.
 */
app.get('/api/coach/clients', (req, res) => {
  const { coachId } = req.query;
  if (!coachId) return res.status(400).json({ error: 'coachId query param is required' });
  const hub = getCoachHub(coachId);
  const active = hub.relationships.map((r) => ({
    id: r.clientId,
    name: r.clientName,
    email: r.email,
    status: r.status,
    joinedAt: r.joinedAt,
  }));
  const pending = hub.invites
    .filter((i) => i.status === 'pending')
    .map((i) => ({
      id: `pending:${i.token}`,
      name: i.email,
      email: i.email,
      status: 'pending',
      sentAt: i.sentAt,
    }));
  res.json([...active, ...pending]);
});

/**
 * GET /api/coach/client/:clientId/metrics?coachId=<coachId>
 * Returns stored settings/metrics for a specific client (if in hub).
 */
app.get('/api/coach/client/:clientId/metrics', (req, res) => {
  const { coachId } = req.query;
  const { clientId } = req.params;
  if (!coachId) return res.status(400).json({ error: 'coachId query param is required' });
  const hub = getCoachHub(coachId);
  const rel = hub.relationships.find((r) => r.clientId === clientId);
  if (!rel) return res.status(403).json({ error: 'Client is not in this coach hub' });
  const settings = userSettings.get(clientId) || {};
  res.json({ clientId, clientName: rel.clientName, status: rel.status, settings });
});

/**
 * GET /api/coach/client/:clientId/notes?coachId=<coachId>
 * Returns all notes for the client written by the coach.
 */
app.get('/api/coach/client/:clientId/notes', (req, res) => {
  const { coachId } = req.query;
  const { clientId } = req.params;
  if (!coachId) return res.status(400).json({ error: 'coachId query param is required' });
  const key = coachNotesKey(coachId, clientId);
  res.json(coachNotes.get(key) || []);
});

/**
 * POST /api/coach/client/:clientId/notes
 * Body: { coachId, text, flagged?, milestone? }
 * Adds a new coach note for the client.
 */
app.post('/api/coach/client/:clientId/notes', (req, res) => {
  const { coachId, text, flagged = false, milestone = false } = req.body || {};
  const { clientId } = req.params;
  if (!coachId || !text || !text.trim()) {
    return res.status(400).json({ error: 'coachId and text are required' });
  }
  const key = coachNotesKey(coachId, clientId);
  if (!coachNotes.has(key)) coachNotes.set(key, []);
  const notes = coachNotes.get(key);
  const note = {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    text: text.trim(),
    date: new Date().toISOString(),
    flagged: Boolean(flagged),
    milestone: Boolean(milestone),
  };
  notes.unshift(note);
  res.status(201).json(note);
});

/**
 * DELETE /api/coach/client/:clientId/notes/:noteId?coachId=<coachId>
 * Removes a specific note.
 */
app.delete('/api/coach/client/:clientId/notes/:noteId', (req, res) => {
  const { coachId } = req.query;
  const { clientId, noteId } = req.params;
  if (!coachId) return res.status(400).json({ error: 'coachId query param is required' });
  const key = coachNotesKey(coachId, clientId);
  const notes = coachNotes.get(key) || [];
  const idx = notes.findIndex((n) => n.id === noteId);
  if (idx === -1) return res.status(404).json({ error: 'Note not found' });
  notes.splice(idx, 1);
  res.json({ ok: true });
});

// ── End Coaching Hub ────────────────────────────────────────────────────────

// ── Daily Mission stub ─────────────────────────────────────────────────────
// dailyMissionEngine.js fires a PUT to sync state and a GET to load it.
// These stubs prevent the 405 "Method Not Allowed" browser console error while
// the feature is awaiting full backend implementation.
const dailyMissionStore = new Map(); // userId → state object

app.get('/api/bodybuilding/daily-mission/:userId', (req, res) => {
  const state = dailyMissionStore.get(req.params.userId) || null;
  res.json(state);
});

app.put('/api/bodybuilding/daily-mission/:userId', (req, res) => {
  if (req.body && typeof req.body === 'object') {
    dailyMissionStore.set(req.params.userId, req.body);
  }
  res.json({ ok: true });
});
// ── End Daily Mission stub ─────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
