/* =============================================================
   OFFLINE MODE — Pocket Coach
   Queues failed API writes, shows offline banner, flushes
   queue when connectivity returns.
   ============================================================= */

(function () {
  'use strict';

  const QUEUE_KEY = 'offlineQueue';

  // ── Queue management ────────────────────────────────────────

  function getQueue() {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
  }

  function setQueue(q) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    updateBadge();
  }

  function queueAction(url, options) {
    const q = getQueue();
    q.push({
      url,
      method: options?.method || 'POST',
      headers: options?.headers || {},
      body: options?.body || null,
      ts: Date.now(),
    });
    setQueue(q);
    if (typeof nativeToast === 'function') {
      nativeToast('Saved offline — will sync when connected', 'warn');
    }
  }

  // ── Flush queue when online ─────────────────────────────────

  async function processQueue() {
    const q = getQueue();
    if (!q.length || !navigator.onLine) return;

    showSyncBanner(q.length);
    let synced = 0;

    for (let i = 0; i < q.length; i++) {
      const { url, method, headers, body } = q[i];
      try {
        const resp = await fetch(url, {
          method,
          headers,
          body,
          credentials: 'include',
          signal: AbortSignal.timeout(10000),
        });
        if (resp.ok || resp.status < 500) {
          q.splice(i, 1);
          i--;
          synced++;
        }
      } catch {
        break;
      }
    }

    setQueue(q);
    hideSyncBanner();

    if (synced > 0 && typeof nativeToast === 'function') {
      nativeToast(synced + ' offline action' + (synced > 1 ? 's' : '') + ' synced', 'success');
    }
  }

  // ── Offline-aware fetch wrapper ─────────────────────────────

  async function offlineFetch(url, options) {
    if (!navigator.onLine) {
      if (options?.method && options.method !== 'GET') {
        queueAction(url, options);
        return { ok: false, offline: true, json: () => Promise.resolve({ queued: true }) };
      }
      throw new Error('Offline');
    }

    try {
      const resp = await fetch(url, options);
      return resp;
    } catch (err) {
      if (options?.method && options.method !== 'GET') {
        queueAction(url, options);
        return { ok: false, offline: true, json: () => Promise.resolve({ queued: true }) };
      }
      throw err;
    }
  }

  // ── Offline status banner ───────────────────────────────────

  function createBanner() {
    if (document.getElementById('offlineBanner')) return;
    const banner = document.createElement('div');
    banner.id = 'offlineBanner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9998;'
      + 'background:rgba(192,80,96,0.95);color:#fff;text-align:center;'
      + 'padding:6px 12px;font-size:0.78rem;font-weight:600;'
      + 'transform:translateY(-100%);'
      + 'backdrop-filter:blur(6px);letter-spacing:0.02em;';
    banner.innerHTML = '<span id="offlineBannerText">You\'re offline — changes will sync when reconnected</span>'
      + '<span id="offlineQueueBadge" style="margin-left:8px;background:rgba(255,255,255,0.2);padding:2px 8px;border-radius:10px;font-size:0.7rem;display:none;"></span>';
    document.body.appendChild(banner);
  }

  function _showBanner(banner) {
    banner.style.transition = 'none';
    banner.style.transform = 'translateY(0)';
  }

  function _hideBanner(banner) {
    banner.style.transition = 'transform 0.3s ease';
    banner.style.transform = 'translateY(-100%)';
  }

  function showOfflineBanner() {
    createBanner();
    const banner = document.getElementById('offlineBanner');
    if (banner) {
      const text = document.getElementById('offlineBannerText');
      if (text) text.textContent = "You're offline — changes will sync when reconnected";
      banner.style.background = 'rgba(192,80,96,0.95)';
      _showBanner(banner);
    }
    updateBadge();
  }

  function hideOfflineBanner() {
    const banner = document.getElementById('offlineBanner');
    if (banner) _hideBanner(banner);
  }

  function showSyncBanner(count) {
    createBanner();
    const banner = document.getElementById('offlineBanner');
    if (banner) {
      const text = document.getElementById('offlineBannerText');
      if (text) text.textContent = 'Syncing ' + count + ' offline action' + (count > 1 ? 's' : '') + '…';
      banner.style.background = 'rgba(45,125,91,0.95)';
      _showBanner(banner);
    }
  }

  function hideSyncBanner() {
    const banner = document.getElementById('offlineBanner');
    if (banner && navigator.onLine) {
      setTimeout(() => _hideBanner(banner), 1500);
    }
  }

  function updateBadge() {
    const badge = document.getElementById('offlineQueueBadge');
    if (!badge) return;
    const count = getQueue().length;
    if (count > 0) {
      badge.textContent = count + ' queued';
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  // ── Connectivity listeners ──────────────────────────────────

  window.addEventListener('offline', () => {
    showOfflineBanner();
    document.body.classList.add('is-offline');
  });

  window.addEventListener('online', () => {
    hideOfflineBanner();
    document.body.classList.remove('is-offline');
    setTimeout(processQueue, 1000);
  });

  // Service worker sync message
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'SYNC_READY') processQueue();
    });
  }

  // Check on load
  document.addEventListener('DOMContentLoaded', () => {
    if (!navigator.onLine) {
      showOfflineBanner();
      document.body.classList.add('is-offline');
    } else {
      processQueue();
    }
  });

  // ── Expose globally ─────────────────────────────────────────

  window.queueAction = queueAction;
  window.processQueue = processQueue;
  window.offlineFetch = offlineFetch;
})();
