(function (globalScope) {
  'use strict';

  // Posing check-in photos live on the device only (IndexedDB). Images are
  // stored as ArrayBuffers rather than Blobs because older iOS WebViews fail
  // to persist Blobs in IndexedDB.
  //
  // Two stores: `photos` holds each photo's details and its small thumbnail,
  // `photoData` holds the full-size image under the same id. Lists (history
  // thumbnails) only ever read `photos`, so months of check-ins never pull
  // full-size images into memory; a full image is read when it is viewed.
  const DB_NAME = 'pc_posing_media';
  const DB_VERSION = 1;
  const STORE = 'photos';
  const DATA_STORE = 'photoData';

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
        if (!db.objectStoreNames.contains(DATA_STORE)) {
          db.createObjectStore(DATA_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Another tab upgrading the schema would otherwise be blocked forever.
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
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

  function requestResult(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
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
   * Save a batch of photos for one posing session, all or nothing.
   * Each photo: { blob, thumbBlob, width, height, takenAt, index, pose }.
   */
  async function savePhotos(userId, sessionId, photos = []) {
    const db = await openDb();
    const metas = [];
    const datas = [];
    for (const photo of photos) {
      const id = `pph_${sessionId}_${photo.index}_${Math.random().toString(36).slice(2, 7)}`;
      const data = await blobToBuffer(photo.blob);
      metas.push({
        id,
        userId,
        sessionId,
        index: photo.index,
        pose: photo.pose || '',
        width: photo.width || 0,
        height: photo.height || 0,
        takenAt: photo.takenAt || new Date().toISOString(),
        type: photo.blob?.type || 'image/jpeg',
        bytes: data ? data.byteLength : 0,
        thumb: await blobToBuffer(photo.thumbBlob)
      });
      datas.push({ id, data });
    }
    const tx = db.transaction([STORE, DATA_STORE], 'readwrite');
    metas.forEach((m) => tx.objectStore(STORE).put(m));
    datas.forEach((d) => tx.objectStore(DATA_STORE).put(d));
    await txDone(tx);
    return metas.length;
  }

  /** Photo details and thumbnails for one session, in shot order. No full-size data. */
  async function listSessionPhotos(userId, sessionId) {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const rows = await requestResult(tx.objectStore(STORE).index('bySession').getAll([userId, sessionId]));
    return (rows || []).sort((a, b) => a.index - b.index);
  }

  /** Full-size image for one photo as a Blob, or null if it is missing. */
  async function getPhotoBlob(photo) {
    const db = await openDb();
    const tx = db.transaction(DATA_STORE, 'readonly');
    const row = await requestResult(tx.objectStore(DATA_STORE).get(photo.id));
    if (!row?.data) return null;
    return new Blob([row.data], { type: photo.type || 'image/jpeg' });
  }

  async function deleteSessionPhotos(userId, sessionId) {
    const db = await openDb();
    const tx = db.transaction([STORE, DATA_STORE], 'readwrite');
    const ids = await requestResult(tx.objectStore(STORE).index('bySession').getAllKeys([userId, sessionId]));
    (ids || []).forEach((id) => {
      tx.objectStore(STORE).delete(id);
      tx.objectStore(DATA_STORE).delete(id);
    });
    await txDone(tx);
    return (ids || []).length;
  }

  /** Every photo this user stored on the device (used on account deletion). */
  async function deleteUserPhotos(userId) {
    const db = await openDb();
    const tx = db.transaction([STORE, DATA_STORE], 'readwrite');
    const ids = await requestResult(tx.objectStore(STORE).index('byUser').getAllKeys(userId));
    (ids || []).forEach((id) => {
      tx.objectStore(STORE).delete(id);
      tx.objectStore(DATA_STORE).delete(id);
    });
    await txDone(tx);
    return (ids || []).length;
  }

  /** Object URL for a photo's thumbnail (from a listSessionPhotos row). */
  function thumbUrl(photo) {
    if (!photo?.thumb) return '';
    return URL.createObjectURL(new Blob([photo.thumb], { type: photo.type || 'image/jpeg' }));
  }

  const api = { isAvailable, savePhotos, listSessionPhotos, getPhotoBlob, deleteSessionPhotos, deleteUserPhotos, thumbUrl };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  globalScope.posingMediaStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
