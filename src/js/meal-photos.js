/* A photo on a logged meal (the camera button on each meal in the food log).

   One photo per user, day and meal. Photos stay on this device (IndexedDB):
   the food log itself syncs through localStorage, which is far too small for
   images, and uploading every meal photo would fill the free Firestore
   allowance. A photo only leaves the device when the user shares that meal.

   Each photo is centre-cropped to a square and shrunk to a JPEG data URL
   (re-encoding also strips EXIF data such as location). Photos older than
   the food log (food-core.js KEEP_DAYS) are pruned, and deleting the account
   removes them (local-account-data.js). */
(function (globalScope) {
  'use strict';

  const DB_NAME = 'pc_meal_photos';
  const STORE = 'photos';
  const PHOTO_SIZE = 720;
  const PHOTO_MAX_BYTES = 140 * 1024;
  const KEEP_DAYS = 90;

  /* ── Pure helpers (tested in tests/mealPhotos.test.js) ─────────── */

  function userKey(user) {
    return String(user || '').trim().toLowerCase();
  }

  function photoId(user, date, meal) {
    const u = userKey(user);
    if (!u || !/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !meal) return null;
    return `${u}|${date}|${meal}`;
  }

  // Decoded size of a base64 data URL.
  function dataUrlBytes(url) {
    const s = String(url || '');
    const comma = s.indexOf(',');
    if (comma < 0) return 0;
    const b64 = s.slice(comma + 1);
    const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor(b64.length * 3 / 4) - pad);
  }

  function isStale(date, today, keepDays) {
    const days = keepDays || KEEP_DAYS;
    const t = Date.parse(`${today}T00:00:00Z`);
    if (!Number.isFinite(t)) return false;
    const cutoff = new Date(t - days * 864e5).toISOString().slice(0, 10);
    return String(date) < cutoff;
  }

  /* ── Storage ──────────────────────────────────────────────────── */

  let dbPromise = null;

  function isAvailable() {
    try { return typeof globalScope.indexedDB !== 'undefined' && globalScope.indexedDB !== null; } catch (_e) { return false; }
  }

  function openDb() {
    if (!isAvailable()) return Promise.reject(new Error('IndexedDB unavailable'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = globalScope.indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('byUser', 'userId');
        store.createIndex('byUserDate', ['userId', 'date']);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    }).catch((err) => { dbPromise = null; throw err; });
    return dbPromise;
  }

  function done(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }

  function result(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function savePhoto(user, date, meal, image) {
    const id = photoId(user, date, meal);
    if (!id) throw new Error('No meal to attach the photo to.');
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ id, userId: userKey(user), date, meal, image, savedAt: Date.now() });
    await done(tx);
  }

  async function getPhoto(user, date, meal) {
    const id = photoId(user, date, meal);
    if (!id || !isAvailable()) return null;
    const db = await openDb();
    const row = await result(db.transaction(STORE).objectStore(STORE).get(id));
    return row ? row.image : null;
  }

  // { meal: dataUrl } for one day.
  async function photosForDay(user, date) {
    if (!userKey(user) || !isAvailable()) return {};
    const db = await openDb();
    const rows = await result(db.transaction(STORE).objectStore(STORE).index('byUserDate').getAll([userKey(user), date]));
    const out = {};
    (rows || []).forEach(r => { out[r.meal] = r.image; });
    return out;
  }

  async function deletePhoto(user, date, meal) {
    const id = photoId(user, date, meal);
    if (!id) return;
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    await done(tx);
  }

  async function pruneOld(user, today, keepDays) {
    if (!userKey(user) || !isAvailable()) return 0;
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const rows = await result(tx.objectStore(STORE).index('byUser').getAll(userKey(user)));
    const old = (rows || []).filter(r => isStale(r.date, today, keepDays));
    old.forEach(r => tx.objectStore(STORE).delete(r.id));
    await done(tx);
    return old.length;
  }

  async function deleteUserPhotos(user) {
    if (!userKey(user) || !isAvailable()) return 0;
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const ids = await result(tx.objectStore(STORE).index('byUser').getAllKeys(userKey(user)));
    (ids || []).forEach(id => tx.objectStore(STORE).delete(id));
    await done(tx);
    return (ids || []).length;
  }

  /* ── Shrinking a picked photo ─────────────────────────────────── */

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file isn’t an image we can read.')); };
      img.src = url;
    });
  }

  async function shrinkPhoto(file) {
    if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('Choose an image file.');
    const img = await loadImage(file);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    if (!side) throw new Error('That image looks empty.');
    const size = Math.min(PHOTO_SIZE, side);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#121b17';
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    for (const q of [0.82, 0.72, 0.6, 0.48, 0.38]) {
      const url = canvas.toDataURL('image/jpeg', q);
      if (dataUrlBytes(url) <= PHOTO_MAX_BYTES) return url;
    }
    throw new Error('That photo is too detailed. Try another one.');
  }

  // Opens the system picker (camera or library) and resolves with the
  // shrunk photo, or null when cancelled.
  function pickPhoto() {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      document.body.appendChild(input);
      const cleanup = () => input.remove();
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        cleanup();
        if (!file) { resolve(null); return; }
        try { resolve(await shrinkPhoto(file)); } catch (err) { reject(err); }
      });
      input.addEventListener('cancel', () => { cleanup(); resolve(null); });
      input.click();
    });
  }

  const api = {
    isAvailable, savePhoto, getPhoto, photosForDay, deletePhoto, pruneOld, deleteUserPhotos,
    shrinkPhoto, pickPhoto,
    photoId, dataUrlBytes, isStale, PHOTO_MAX_BYTES,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.mealPhotos = api;
})(typeof window !== 'undefined' ? window : globalThis);
