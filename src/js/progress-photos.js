/* =============================================================
   PROGRESS PHOTOS
   Photos used to be stored as full-size data URLs in localStorage.
   A phone photo is several MB, past localStorage's ~5 MB limit, so
   saving usually failed on iPhone, and nothing reached other devices.

   Now each photo is:
   - shrunk to a JPEG of at most ~180 KB (compressImage),
   - kept on this device in IndexedDB (plenty of room),
   - uploaded to the backend (/api/photos/:id), and
   - listed in progressPhotos_{user} ({ id, slot, date }), which
     cloud-sync.js syncs like any other data.

   Everywhere the app used to store a data URL (the current photo per
   slot in progressPhoto_{user}_{slot}, and check-in entries) it now
   stores a reference, "photo:<id>". resolve() turns a reference (or
   an old data URL) into something an <img> can show, downloading and
   caching it if this device doesn't have it yet.

   Photos taken offline stay marked pending and upload later.
   ============================================================= */

(function (global) {
  'use strict';

  const REF_PREFIX = 'photo:';
  const MAX_DATA_URL_CHARS = 180 * 1024;
  const MAX_EDGE = 1280;
  const DB_NAME = 'pocketcoach-photos';
  const STORE = 'photos';
  const SLOTS = ['front', 'side', 'back'];

  function user() {
    return global.currentUser || (global.localStorage && global.localStorage.getItem('fitnessAppUser')) || null;
  }
  const today = () => new Date().toISOString().slice(0, 10);
  const newId = () => `ph_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const isRef = v => typeof v === 'string' && v.startsWith(REF_PREFIX);
  const refId = v => (isRef(v) ? v.slice(REF_PREFIX.length) : null);

  /* ── Shrinking ─────────────────────────────────────────── */

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read that image.'));
      img.src = src;
    });
  }

  function readAsDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.readAsDataURL(blob);
    });
  }

  // JPEG data URL no longer than MAX_DATA_URL_CHARS: lowers quality first,
  // then size.
  async function compressImage(source) {
    const src = typeof source === 'string' ? source : await readAsDataURL(source);
    const img = await loadImage(src);
    let scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    for (let round = 0; round < 8; round++) {
      canvas.width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
      canvas.height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const q of [0.82, 0.72, 0.62, 0.52]) {
        const out = canvas.toDataURL('image/jpeg', q);
        if (out.length <= MAX_DATA_URL_CHARS) return out;
      }
      scale *= 0.75;
    }
    throw new Error('Could not make that photo small enough.');
  }

  /* ── Local store (IndexedDB, with an in-memory fallback) ─ */

  const memory = new Map();
  let dbPromise = null;
  function openDb() {
    if (!global.indexedDB) return Promise.resolve(null);
    if (!dbPromise) {
      dbPromise = new Promise(resolve => {
        const req = global.indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null); // private browsing etc.
      });
    }
    return dbPromise;
  }
  async function idb(mode, fn) {
    const db = await openDb();
    if (!db) return fn(null);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
    });
  }
  const keyFor = (u, id) => `${u}:${id}`;
  async function getLocal(u, id) {
    const k = keyFor(u, id);
    const hit = await idb('readonly', s => (s ? s.get(k) : null)).catch(() => null);
    return hit || memory.get(k) || null;
  }
  async function putLocal(u, id, value) {
    const k = keyFor(u, id);
    memory.set(k, value);
    await idb('readwrite', s => (s ? s.put(value, k) : null)).catch(() => {});
  }
  async function allLocal(u) {
    const prefix = `${u}:`;
    const out = [];
    const db = await openDb();
    if (db) {
      await new Promise(resolve => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).openCursor();
        req.onsuccess = () => {
          const c = req.result;
          if (!c) return resolve();
          if (String(c.key).startsWith(prefix)) out.push([String(c.key).slice(prefix.length), c.value]);
          c.continue();
        };
        req.onerror = () => resolve();
      });
    }
    memory.forEach((v, k) => { if (k.startsWith(prefix) && !out.some(([id]) => id === k.slice(prefix.length))) out.push([k.slice(prefix.length), v]); });
    return out;
  }
  async function forgetLocal(u) {
    const prefix = `${u}:`;
    [...memory.keys()].forEach(k => { if (k.startsWith(prefix)) memory.delete(k); });
    const db = await openDb();
    if (!db) return;
    await new Promise(resolve => {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        if (String(c.key).startsWith(prefix)) c.delete();
        c.continue();
      };
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  }

  /* ── Server ────────────────────────────────────────────── */

  function api(method, id, body) {
    const token = global.localStorage.getItem('token');
    if (!token || !global.SERVER_URL) return Promise.resolve({ ok: false, status: 0, data: null });
    return fetch(`${global.SERVER_URL}/api/photos/${encodeURIComponent(id)}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async res => ({ ok: res.ok, status: res.status, data: await res.json().catch(() => null) }))
      .catch(() => ({ ok: false, status: 0, data: null }));
  }

  async function upload(u, id, entry) {
    const res = await api('PUT', id, { slot: entry.slot, date: entry.date, data: entry.data });
    if (res.ok) await putLocal(u, id, { ...entry, pending: false });
    return res.ok;
  }

  let uploading = false;
  async function uploadPending() {
    const u = user();
    if (!u || uploading) return 0;
    uploading = true;
    let sent = 0;
    try {
      for (const [id, entry] of await allLocal(u)) {
        if (entry && entry.pending && await upload(u, id, entry)) sent++;
      }
    } finally {
      uploading = false;
    }
    return sent;
  }

  /* ── Index (synced by cloud-sync.js) ───────────────────── */

  const indexKey = u => `progressPhotos_${u}`;
  const slotKey = (u, slot) => `progressPhoto_${u}_${slot}`;
  function readIndex(u) {
    try {
      const v = JSON.parse(global.localStorage.getItem(indexKey(u)));
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  function addToIndex(u, meta) {
    const list = readIndex(u).filter(p => p && p.id !== meta.id);
    list.push(meta);
    list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    global.localStorage.setItem(indexKey(u), JSON.stringify(list));
  }

  /* ── Public API ────────────────────────────────────────── */

  // Stores a new photo (File/Blob or data URL) for a slot; returns
  // { ref, data } where data is the shrunk image for immediate display.
  async function savePhoto(slot, source, date = today()) {
    const u = user();
    if (!u) throw new Error('Sign in to save photos.');
    if (!SLOTS.includes(slot)) throw new Error('Unknown photo slot.');
    const data = await api_.compressImage(source); // via api_ so tests can stand in for canvas
    const id = newId();
    const entry = { slot, date, data, pending: true };
    await putLocal(u, id, entry);
    addToIndex(u, { id, slot, date });
    global.localStorage.setItem(slotKey(u, slot), REF_PREFIX + id);
    upload(u, id, entry); // retried by uploadPending if offline
    return { ref: REF_PREFIX + id, data };
  }

  // Something an <img> can show for a stored value: a reference, or an old
  // data URL. '' when there's nothing (or it can't be loaded right now).
  async function resolve(value) {
    if (!value) return '';
    if (typeof value === 'string' && value.startsWith('data:')) return value;
    const id = refId(value);
    const u = user();
    if (!id || !u) return '';
    const local = await getLocal(u, id);
    if (local && local.data) return local.data;
    const res = await api('GET', id);
    const photo = res.ok && res.data && res.data.photo;
    if (!photo || !photo.data) return '';
    await putLocal(u, id, { slot: photo.slot, date: photo.date, data: photo.data, pending: false });
    return photo.data;
  }

  // Moves photos saved the old way (full-size data URLs in the slot keys
  // and inside check-ins) into the new store, replacing them with
  // references. Frees most of localStorage for people who had photos.
  async function migrateLegacy() {
    const u = user();
    if (!u) return 0;
    const byData = new Map(); // same image in a slot and a check-in -> one photo
    let moved = 0;
    const convert = async (data, slot, date) => {
      if (byData.has(data)) return byData.get(data);
      const saved = await savePhoto(slot, data, date);
      byData.set(data, saved.ref);
      moved++;
      return saved.ref;
    };
    const checkKey = `tl_checkins_v1_${u}`;
    let checkIns = null;
    try { checkIns = JSON.parse(global.localStorage.getItem(checkKey)); } catch { checkIns = null; }
    if (Array.isArray(checkIns)) {
      let changed = false;
      for (const entry of checkIns) {
        for (const slot of SLOTS) {
          const field = `${slot}Photo`;
          if (entry && typeof entry[field] === 'string' && entry[field].startsWith('data:')) {
            try {
              entry[field] = await convert(entry[field], slot, String(entry.date || today()).slice(0, 10));
              changed = true;
            } catch (err) {
              console.warn('[ProgressPhotos] could not move a check-in photo:', err.message);
            }
          }
        }
      }
      if (changed) global.localStorage.setItem(checkKey, JSON.stringify(checkIns));
    }
    for (const slot of SLOTS) {
      const current = global.localStorage.getItem(slotKey(u, slot));
      if (current && current.startsWith('data:')) {
        try {
          const ref = await convert(current, slot, today());
          global.localStorage.setItem(slotKey(u, slot), ref);
        } catch (err) {
          console.warn('[ProgressPhotos] could not move a photo:', err.message);
        }
      }
    }
    return moved;
  }

  const api_ = { savePhoto, resolve, uploadPending, migrateLegacy, compressImage, forgetLocal, isRef, SLOTS };
  global.ProgressPhotos = api_;

  if (global.document && !global.__PROGRESS_PHOTOS_NO_AUTO) {
    const kick = () => { migrateLegacy().catch(() => {}).then(uploadPending).catch(() => {}); };
    setTimeout(kick, 6000);
    global.addEventListener('online', () => { uploadPending().catch(() => {}); });
    global.addEventListener('traininglog:user-changed', kick);
    setInterval(() => { uploadPending().catch(() => {}); }, 5 * 60 * 1000);
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = api_;
})(typeof window !== 'undefined' ? window : globalThis);
