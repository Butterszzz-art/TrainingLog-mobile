/* =============================================================
   PROGRESS PHOTOS + CHECK-IN COMMENTS (client side)
   - askSharing: the one-time "share progress photos with your coach?"
     sheet. The answer is stored server-side (coachSharing.photos) by
     src/js/client-coaching.js and can be changed in Your Coach.
   - shrinkDataUrl: a photo as a JPEG data URL, ~1080 px on the long edge
     and under ~400 KB, for PUT /api/client/checkin-photos/:date.
   - sendPosingSession: "Send to coach" on a posing session. Pick which
     photos go; they're added to your latest check-in and sent with it.
   - hydrateThreads / openThread: the coach's comments and your replies
     under each check-in in Check-in history (GET/POST
     /api/client/checkins/...). A notification tap opens the thread.
   Photos and comments never go in URLs or logs.
   Pure helpers are exported for tests (tests/coachPhotos.test.js).
   ============================================================= */

(function (root) {
  'use strict';

  const MAX_EDGE = 1080;
  const MAX_BYTES = 400 * 1024;
  const CHECKIN_PREFIX = 'tl_checkins_v1_';
  const THREAD_TTL_MS = 60 * 1000;

  // ── pure helpers ─────────────────────────────────────────────────

  const arr = v => (Array.isArray(v) ? v : []);

  // Comments grouped by check-in date, oldest first in each.
  function groupComments(comments) {
    const out = {};
    arr(comments).forEach(c => {
      if (!c || !c.checkInDate) return;
      (out[c.checkInDate] = out[c.checkInDate] || []).push(c);
    });
    Object.values(out).forEach(list => list.sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''))));
    return out;
  }

  // Coach comments newer than `seenAt` (ms) in one thread.
  function unseenCoachComments(list, seenAt) {
    return arr(list).filter(c => c.author === 'coach' && Date.parse(c.createdAt || '') > (Number(seenAt) || 0)).length;
  }

  // The check-in a posing session's photos are added to: the latest one.
  function targetCheckIn(checkIns) {
    return arr(checkIns).filter(c => c && /^\d{4}-\d{2}-\d{2}/.test(String(c.date || '')))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))[0] || null;
  }

  // The check-in after picking `photoIds` of `sessionId` (all of them →
  // no pick entry, the whole set goes). Returns a new object.
  function withSessionPicks(checkIn, sessionId, photoIds, allIds, maxSets = 10) {
    const c = { ...checkIn };
    const ids = arr(c.posingSessionIds).filter(id => id !== sessionId);
    const picks = { ...(c.posingPhotoPicks && typeof c.posingPhotoPicks === 'object' ? c.posingPhotoPicks : {}) };
    delete picks[sessionId];
    const chosen = arr(photoIds).filter(id => arr(allIds).includes(id));
    if (chosen.length) {
      ids.unshift(sessionId);
      if (chosen.length < arr(allIds).length) picks[sessionId] = chosen;
    }
    c.posingSessionIds = ids.slice(0, maxSets);
    Object.keys(picks).forEach(id => { if (!c.posingSessionIds.includes(id)) delete picks[id]; });
    c.posingPhotoPicks = picks;
    return c;
  }

  const api = { groupComments, unseenCoachComments, targetCheckIn, withSessionPicks };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root || !root.document) return;

  // ── browser side ─────────────────────────────────────────────────

  const doc = root.document;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // eslint-disable-next-line no-undef
  const icon = name => (typeof ICONS !== 'undefined' && ICONS[name]) || '';
  const toast = (msg, kind) => { if (root.showToast) root.showToast(msg, kind); };
  const user = () => root.currentUser || root.localStorage.getItem('fitnessAppUser') || root.localStorage.getItem('username') || '';
  const base = () => String(root.SERVER_URL || '').replace(/\/$/, '');
  const headers = () => (typeof root.getAuthHeaders === 'function' ? root.getAuthHeaders() : {});
  const linked = () => root.localStorage.getItem(`coachLinked_${user()}`) === 'true';
  const seenKey = () => `coachThreadSeen_${user()}`;
  const readJSON = (key, fallback) => { try { const v = JSON.parse(root.localStorage.getItem(key)); return v == null ? fallback : v; } catch { return fallback; } };

  async function api$(method, path, body) {
    const res = await fetch(base() + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers() },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.success) {
      const err = new Error((data && data.error && data.error.message) || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ── Shrink ───────────────────────────────────────────────────────

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not read the photo.'));
      img.src = src;
    });
  }

  const dataUrlBytes = url => Math.floor((String(url).length - String(url).indexOf(',') - 1) * 3 / 4);

  async function shrinkDataUrl(dataUrl, opts) {
    const o = opts || {};
    if (typeof dataUrl !== 'string' || !/^data:image\//.test(dataUrl)) return null;
    const img = await loadImage(dataUrl);
    const longEdge = Math.max(img.naturalWidth, img.naturalHeight) || 1;
    let edge = Math.min(o.maxEdge || MAX_EDGE, longEdge);
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const scale = edge / longEdge;
      const canvas = doc.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.8, 0.7, 0.6]) {
        const url = canvas.toDataURL('image/jpeg', quality);
        if (dataUrlBytes(url) <= (o.maxBytes || MAX_BYTES)) return url;
      }
      edge = Math.round(edge * 0.8);
    }
    return null;
  }

  // ── Sheets ───────────────────────────────────────────────────────

  function openSheet(id, html, onClose) {
    doc.getElementById(id)?.remove();
    const back = doc.createElement('div');
    back.id = id;
    back.className = 'mx-sheet-backdrop cp-backdrop';
    back.innerHTML = html;
    const close = () => { back.remove(); doc.removeEventListener('keydown', onKey); if (onClose) onClose(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    back.addEventListener('click', e => { if (e.target === back) close(); });
    doc.addEventListener('keydown', onKey);
    doc.body.appendChild(back);
    return { el: back, close };
  }

  // Resolves true (share), false (don't) or null (closed without answering:
  // asked again next time).
  function askSharing({ coachName }) {
    return new Promise(resolve => {
      let answered = null;
      const name = esc(coachName || 'your coach');
      const sheet = openSheet('cpAskSheet', `
        <div class="mx-sheet cp-sheet" role="dialog" aria-modal="true" aria-labelledby="cpAskTitle">
          <div class="mx-sheet-head">
            <div><span class="mx-kicker">Progress photos</span>
              <h3 class="pod-title mx-h3" id="cpAskTitle">Share your photos with ${name}?</h3></div>
            <button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-cp-ask="close" aria-label="Close">✕</button>
          </div>
          <p class="cp-lead">Your front, side and back photos, and any posing photos you add, go to ${name} with that check-in so they can see how you're changing and comment on them.</p>
          <ul class="cp-points">
            <li>Only ${name} can see them.</li>
            <li>Kept for your last 12 check-ins, then deleted.</li>
            <li>Turn it off any time in Settings → Your Coach. Turning it off, or stopping coaching, deletes them from your coach.</li>
          </ul>
          <div class="cp-actions">
            <button type="button" class="mx-cta" data-cp-ask="yes"><span>Share photos</span><span class="mx-cta-icon">${icon('check')}</span></button>
            <button type="button" class="mx-outline mx-outline--block" data-cp-ask="no">Keep them on my phone</button>
          </div>
        </div>`, () => resolve(answered));
      sheet.el.addEventListener('click', e => {
        const b = e.target.closest('[data-cp-ask]');
        if (!b) return;
        const act = b.getAttribute('data-cp-ask');
        answered = act === 'yes' ? true : act === 'no' ? false : null;
        sheet.close();
      });
      sheet.el.querySelector('.mx-cta')?.focus();
    });
  }

  // ── Send a posing session to the coach ──────────────────────────

  async function sendPosingSession(sessionId) {
    const u = user();
    const media = root.posingMediaStore;
    if (!u || !media || !media.isAvailable || !media.isAvailable()) { toast('Photos aren’t available on this device.', 'error'); return; }
    const engine = root.checkinEngine;
    const checkIns = engine ? engine.loadCheckIns(u) : readJSON(CHECKIN_PREFIX + u, []);
    const target = targetCheckIn(checkIns);
    if (!target) {
      toast('Save a check-in first: photos go to your coach with a check-in.');
      if (typeof root.showTab === 'function') root.showTab('checkInTab');
      return;
    }
    const owners = [...new Set([u, root.localStorage.getItem('currentUser')].filter(Boolean))];
    let rows = [];
    for (const owner of owners) {
      rows = await media.listSessionPhotos(owner, sessionId).catch(() => []);
      if (rows.length) break;
    }
    if (!rows.length) { toast('These photos aren’t on this device.', 'error'); return; }

    const allIds = rows.map(r => r.id);
    const attached = arr(target.posingSessionIds).includes(sessionId);
    const prev = attached ? (arr(target.posingPhotoPicks && target.posingPhotoPicks[sessionId]).length ? target.posingPhotoPicks[sessionId] : allIds) : allIds;
    const picked = new Set(prev);
    const urls = rows.map(r => media.thumbUrl(r));
    const dateLabel = (() => { const d = new Date(`${String(target.date).slice(0, 10)}T00:00:00`); return isNaN(d.getTime()) ? target.date : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }); })();

    const sheet = openSheet('cpSendSheet', `
      <div class="mx-sheet cp-sheet" role="dialog" aria-modal="true" aria-labelledby="cpSendTitle">
        <div class="mx-sheet-head">
          <div><span class="mx-kicker">Send to coach</span>
            <h3 class="pod-title mx-h3" id="cpSendTitle">Pick the photos to send</h3></div>
          <button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-cp-send="close" aria-label="Close">✕</button>
        </div>
        <p class="cp-lead">They're added to your check-in of <b>${esc(dateLabel)}</b> and go to your coach with it.</p>
        <div class="cp-grid">${rows.map((r, i) => `
          <button type="button" class="cp-pick" data-cp-pick="${esc(r.id)}" aria-pressed="${picked.has(r.id)}" aria-label="Photo ${i + 1}${r.pose ? `, ${esc(r.pose)}` : ''}">
            <img src="${urls[i]}" alt="" loading="lazy" decoding="async">
            <span class="cp-pick-check">${icon('check')}</span>
            ${r.pose ? `<span class="cp-pick-pose">${esc(r.pose)}</span>` : ''}
          </button>`).join('')}</div>
        <div class="cp-actions">
          <button type="button" class="mx-cta" data-cp-send="go"><span data-cp-count>Send ${picked.size} photo${picked.size === 1 ? '' : 's'}</span><span class="mx-cta-icon">${icon('share')}</span></button>
          ${attached ? '<button type="button" class="mx-outline mx-outline--block" data-cp-send="remove">Take this session off the check-in</button>' : ''}
        </div>
      </div>`, () => urls.forEach(x => x && URL.revokeObjectURL(x)));

    const count = () => {
      const label = sheet.el.querySelector('[data-cp-count]');
      if (label) label.textContent = picked.size ? `Send ${picked.size} photo${picked.size === 1 ? '' : 's'}` : 'Pick at least one photo';
      sheet.el.querySelector('[data-cp-send="go"]').disabled = !picked.size;
    };
    sheet.el.addEventListener('click', async e => {
      const pick = e.target.closest('[data-cp-pick]');
      if (pick) {
        const id = pick.getAttribute('data-cp-pick');
        if (picked.has(id)) picked.delete(id); else picked.add(id);
        pick.setAttribute('aria-pressed', String(picked.has(id)));
        count();
        return;
      }
      const b = e.target.closest('[data-cp-send]');
      if (!b) return;
      const act = b.getAttribute('data-cp-send');
      if (act === 'close') { sheet.close(); return; }
      const chosen = act === 'remove' ? [] : allIds.filter(id => picked.has(id));
      if (act === 'go' && !chosen.length) return;
      b.disabled = true;
      // Store the pick on the check-in, then make sure photo sharing is on.
      const fresh = engine ? engine.loadCheckIns(u) : checkIns;
      const updated = arr(fresh).map(c => (c && c.date === target.date ? withSessionPicks(c, sessionId, chosen, allIds) : c));
      if (engine && engine.saveCheckInState) engine.saveCheckInState(u, updated);
      else root.localStorage.setItem(CHECKIN_PREFIX + u, JSON.stringify(updated));
      sheet.close();
      if (act === 'remove') {
        toast('Removed from your check-in.');
        if (typeof root.pushCoachCheckInPhotos === 'function') root.pushCoachCheckInPhotos();
        return;
      }
      const status = typeof root.coachPhotoSharing === 'function' ? root.coachPhotoSharing() : { on: false, decided: false };
      let on = status.on;
      if (!status.decided && typeof root.askCoachPhotoSharing === 'function') on = await root.askCoachPhotoSharing();
      else if (!on) { toast('Photo sharing with your coach is off. Turn on Progress photos in Settings → Your Coach.'); return; }
      if (on) {
        toast(`Sending ${chosen.length} photo${chosen.length === 1 ? '' : 's'} to your coach…`);
        if (typeof root.pushCoachShare === 'function') await root.pushCoachShare({ force: true });
        toast('Sent to your coach with your check-in.', 'success');
      }
    });
    count();
    sheet.el.querySelector('.mx-cta')?.focus();
  }

  // ── Comment threads under each check-in ─────────────────────────

  const cache = { at: 0, data: null, pending: null, user: '' };
  const open = new Set(); // dates whose reply box is open

  async function loadThreads(force) {
    if (cache.user !== user()) { cache.at = 0; cache.data = null; cache.user = user(); }
    if (!force && cache.data && Date.now() - cache.at < THREAD_TTL_MS) return cache.data;
    if (!cache.pending) {
      cache.pending = api$('GET', '/api/client/checkins/comments')
        .then(d => { cache.data = { byDate: groupComments(d.comments), coaches: arr(d.coaches), photoDates: new Set(arr(d.photoDates)) }; cache.at = Date.now(); return cache.data; })
        .finally(() => { cache.pending = null; });
    }
    return cache.pending;
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  // "New" markers use what was seen before this app session, so they stay
  // visible while the client reads them (markSeen updates storage only).
  let seenAtStart = null;
  function seenBefore(date) {
    if (!seenAtStart || seenAtStart.user !== user()) seenAtStart = { user: user(), map: readJSON(seenKey(), {}) };
    return seenAtStart.map[date] || 0;
  }

  function threadHtml(date, data) {
    const list = data.byDate[date] || [];
    const hasPhotos = data.photoDates.has(date);
    const seen = seenBefore(date);
    const fresh = unseenCoachComments(list, seen);
    const coachName = data.coaches.map(c => c.username).filter(Boolean).join(' & ') || 'your coach';
    const isOpen = open.has(date);
    const rows = list.map(c => `
      <div class="ci-msg ci-msg--${c.author === 'coach' ? 'coach' : 'me'}${c.author === 'coach' && Date.parse(c.createdAt || '') > seen ? ' is-new' : ''}">
        <div class="ci-msg-meta"><b>${c.author === 'coach' ? esc(c.authorName || 'Coach') : 'You'}</b>
          ${Number.isInteger(c.photoIndex) ? `<span class="mx-chip mx-chip--sm">On your ${esc((c.photoLabel || 'photo').toLowerCase())}${c.photoLabel ? ' photo' : ''}</span>` : ''}
          <span>${esc(fmtTime(c.createdAt))}</span></div>
        <div class="ci-msg-text">${esc(c.text)}</div>
      </div>`).join('');
    return `
      <div class="ci-thread-head">
        ${hasPhotos ? `<span class="mx-chip mx-chip--green mx-chip--sm">${icon('camera')} Photos shared with ${esc(coachName)}</span>` : ''}
        ${list.length ? `<span class="mx-lbl">Comments</span>${fresh ? `<span class="mx-chip mx-chip--green mx-chip--sm">${fresh} new</span>` : ''}` : ''}
      </div>
      ${rows ? `<div class="ci-msgs">${rows}</div>` : ''}
      ${isOpen ? `
        <form class="ci-reply" data-ci-reply="${esc(date)}">
          <textarea class="ci-reply-input" rows="2" maxlength="1000" placeholder="${list.length ? `Reply to ${esc(coachName)}…` : `Message ${esc(coachName)} about this check-in…`}" aria-label="Reply to your coach"></textarea>
          <div class="ci-reply-actions">
            <button type="button" class="ci-link" data-ci-cancel="${esc(date)}">Cancel</button>
            <button type="submit" class="mx-outline">Send</button>
          </div>
        </form>` : `<button type="button" class="mx-outline ci-reply-open" data-ci-open="${esc(date)}">${icon('message')} ${list.length ? 'Reply' : 'Message your coach about this check-in'}</button>`}`;
  }

  function markSeen(date, list) {
    const latest = arr(list).filter(c => c.author === 'coach').map(c => Date.parse(c.createdAt || '') || 0).reduce((m, t) => Math.max(m, t), 0);
    if (!latest) return;
    const seen = readJSON(seenKey(), {});
    if ((seen[date] || 0) >= latest) return;
    seen[date] = latest;
    root.localStorage.setItem(seenKey(), JSON.stringify(seen));
  }

  async function hydrateThreads(container, opts) {
    const o = opts || {};
    const slots = Array.from((container || doc).querySelectorAll('[data-ci-thread]'));
    if (!slots.length || !linked() || !root.localStorage.getItem('token')) { slots.forEach(s => { s.hidden = true; }); return; }
    let data;
    try { data = await loadThreads(o.force); } catch { slots.forEach(s => { s.hidden = true; }); return; }
    if (!data.coaches.length) { slots.forEach(s => { s.hidden = true; }); return; }
    slots.forEach(slot => {
      if (!slot.isConnected) return;
      const date = slot.getAttribute('data-ci-thread');
      slot.innerHTML = threadHtml(date, data);
      slot.hidden = false;
    });
    // Comments are "seen" once the history shows them.
    const panel = doc.getElementById('ciPanel_history');
    if (panel && panel.style.display !== 'none') slots.forEach(s => markSeen(s.getAttribute('data-ci-thread'), data.byDate[s.getAttribute('data-ci-thread')]));
  }

  function rerender(date) {
    const slot = doc.querySelector(`[data-ci-thread="${CSS.escape(date)}"]`);
    if (slot && cache.data) {
      slot.innerHTML = threadHtml(date, cache.data);
      if (open.has(date)) slot.querySelector('textarea')?.focus();
    }
  }

  async function sendReply(form) {
    const date = form.getAttribute('data-ci-reply');
    const input = form.querySelector('textarea');
    const text = String(input.value || '').trim();
    if (!text) { input.focus(); return; }
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    try {
      const body = { text };
      const coaches = (cache.data && cache.data.coaches) || [];
      // With more than one coach, reply to whoever wrote last in this thread.
      if (coaches.length > 1) {
        const last = [...((cache.data.byDate[date]) || [])].reverse().find(c => c.author === 'coach');
        body.coachUid = (last && last.coachUid) || coaches[0].uid;
      }
      const d = await api$('POST', `/api/client/checkins/${encodeURIComponent(date)}/comments`, body);
      if (cache.data) (cache.data.byDate[date] = cache.data.byDate[date] || []).push(d.comment);
      open.delete(date);
      rerender(date);
      toast('Sent to your coach.', 'success');
    } catch (err) {
      btn.disabled = false;
      toast(err.message || 'Could not send. Check your connection and try again.', 'error');
    }
  }

  doc.addEventListener('click', e => {
    const o = e.target.closest && e.target.closest('[data-ci-open]');
    if (o) { open.add(o.getAttribute('data-ci-open')); rerender(o.getAttribute('data-ci-open')); return; }
    const c = e.target.closest && e.target.closest('[data-ci-cancel]');
    if (c) { open.delete(c.getAttribute('data-ci-cancel')); rerender(c.getAttribute('data-ci-cancel')); }
  });
  doc.addEventListener('submit', e => {
    const form = e.target.closest && e.target.closest('[data-ci-reply]');
    if (!form) return;
    e.preventDefault();
    sendReply(form);
  });

  // From a notification: the history tab, scrolled to that check-in's thread.
  async function openThread(date) {
    if (typeof root.showTab === 'function') root.showTab('checkInTab');
    if (typeof root.switchCheckInTab === 'function') root.switchCheckInTab('history');
    const timeline = doc.getElementById('checkInTimeline');
    await hydrateThreads(timeline, { force: true });
    const slot = date && doc.querySelector(`[data-ci-thread="${CSS.escape(String(date))}"]`);
    if (slot) {
      slot.closest('.ci-tc')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      slot.classList.add('is-flash');
      setTimeout(() => slot.classList.remove('is-flash'), 2000);
    } else if (date) {
      toast('That check-in isn’t on this device.');
    }
  }

  root.CoachPhotos = { ...api, shrinkDataUrl, askSharing, sendPosingSession, hydrateThreads, openThread, refreshThreads: () => hydrateThreads(doc.getElementById('checkInTimeline'), { force: true }) };
})(typeof window !== 'undefined' ? window : null);
