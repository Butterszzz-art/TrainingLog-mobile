(function (globalScope) {
  'use strict';

  // Posing check-in photos live on the device only (IndexedDB). Images are
  // stored as ArrayBuffers rather than Blobs because older iOS WebViews fail
  // to persist Blobs in IndexedDB.
  const DB_NAME = 'pc_posing_media';
  const DB_VERSION = 1;
  const STORE = 'photos';

  let dbPromise = null;

  function isAvailable() {
    try {
      return typeof globalScope.indexedDB !== 'undefined' && globalScope.indexedDB !== null;
    } catch (_error) {
      return false;
    }
  }

  function openDb() {
    if (!isAvailable()) return Promise.reject(new Error('IndexedDB unavailable'));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = globalScope.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('bySession', ['userId', 'sessionId']);
          store.createIndex('byUser', 'userId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((error) => {
      dbPromise = null;
      throw error;
    });
    return dbPromise;
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }

  async function blobToBuffer(blob) {
    if (!blob) return null;
    if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
  }

  /**
   * Save a batch of photos for one posing session.
   * Each photo: { blob, thumbBlob, width, height, takenAt, index, pose }.
   */
  async function savePhotos(userId, sessionId, photos = []) {
    const db = await openDb();
    const records = [];
    for (const photo of photos) {
      records.push({
        id: `pph_${sessionId}_${photo.index}_${Math.random().toString(36).slice(2, 7)}`,
        userId,
        sessionId,
        index: photo.index,
        pose: photo.pose || '',
        width: photo.width || 0,
        height: photo.height || 0,
        takenAt: photo.takenAt || new Date().toISOString(),
        type: photo.blob?.type || 'image/jpeg',
        data: await blobToBuffer(photo.blob),
        thumb: await blobToBuffer(photo.thumbBlob)
      });
    }
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    records.forEach((record) => store.put(record));
    await txDone(tx);
    return records.length;
  }

  async function listSessionPhotos(userId, sessionId) {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).index('bySession').getAll([userId, sessionId]);
    const rows = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    return rows.sort((a, b) => a.index - b.index);
  }

  async function deleteSessionPhotos(userId, sessionId) {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const index = tx.objectStore(STORE).index('bySession');
    const req = index.openKeyCursor(IDBKeyRange.only([userId, sessionId]));
    let removed = 0;
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      tx.objectStore(STORE).delete(cursor.primaryKey);
      removed += 1;
      cursor.continue();
    };
    await txDone(tx);
    return removed;
  }

  function toObjectUrl(record, { thumb = false } = {}) {
    const buffer = thumb && record.thumb ? record.thumb : record.data;
    if (!buffer) return '';
    return URL.createObjectURL(new Blob([buffer], { type: record.type || 'image/jpeg' }));
  }

  const api = { isAvailable, savePhotos, listSessionPhotos, deleteSessionPhotos, toObjectUrl };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.posingMediaStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
