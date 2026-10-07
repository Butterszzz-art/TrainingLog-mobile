/* =============================================================
   COACH VIDEOS
   A coach shares a video link (Loom, YouTube, Vimeo, Google Drive
   or a plain .mp4) explaining the program, the diet, cardio or
   anything else, with all clients or chosen ones. Clients watch it
   inline in a player sheet, from Settings › Your Coach or from the
   notification.
   - Coach side: the "Coach videos" pod at the top of the coach
     Videos sub-tab (#coachVideoLibrary), backed by /api/coach/videos.
   - Client side: listed by src/js/client-coaching.js from
     /api/client/coach-videos; this file only supplies the player.
   - The per-exercise technique videos below it in the same sub-tab
     are a separate, older feature (index.html, /coach/exercise-videos);
     their Watch hint in the Log tab also opens this player.
   Pure helpers are exported for tests (tests/coachVideos.test.js).
   ============================================================= */

(function (root) {
  'use strict';

  const CATEGORIES = [
    { id: 'program', label: 'Program' },
    { id: 'diet', label: 'Diet' },
    { id: 'cardio', label: 'Cardio' },
    { id: 'technique', label: 'Technique' },
    { id: 'general', label: 'General' }
  ];
  const categoryLabel = id => (CATEGORIES.find(c => c.id === id) || CATEGORIES[4]).label;

  const PROVIDER_LABEL = { loom: 'Loom', youtube: 'YouTube', vimeo: 'Vimeo', drive: 'Google Drive', file: 'Video file', link: 'Link' };

  // ── pure helpers ─────────────────────────────────────────────────

  // What a link is and how to play it in the app:
  //   { provider, label, embedUrl }  — iframe player (Loom, YouTube, Vimeo, Drive)
  //   { provider: 'file', fileUrl }  — <video> element
  //   { provider: 'link' }           — can't embed; open it outside the app
  //   null                           — not an http(s) link at all
  function parseVideo(raw) {
    let u;
    try { u = new URL(String(raw || '').trim()); } catch { return null; }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const host = u.hostname.replace(/^(www|m)\./, '').toLowerCase();
    const parts = u.pathname.split('/').filter(Boolean);
    const out = (provider, extra) => ({ provider, label: PROVIDER_LABEL[provider], embedUrl: null, fileUrl: null, ...extra });

    if (host === 'loom.com' || host.endsWith('.loom.com')) {
      const i = parts.findIndex(p => p === 'share' || p === 'embed');
      const id = i >= 0 ? parts[i + 1] : '';
      if (/^[0-9a-f]{16,64}$/i.test(id || '')) return out('loom', { embedUrl: `https://www.loom.com/embed/${id}` });
    }

    if (host === 'youtube.com' || host === 'youtu.be' || host === 'youtube-nocookie.com') {
      let id = '';
      if (host === 'youtu.be') id = parts[0];
      else if (parts[0] === 'watch') id = u.searchParams.get('v');
      else if (['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1];
      if (/^[\w-]{11}$/.test(id || '')) {
        const start = parseInt(u.searchParams.get('t') || u.searchParams.get('start') || '', 10);
        const t = Number.isFinite(start) && start > 0 ? `&start=${start}` : '';
        return out('youtube', { embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0&playsinline=1${t}` });
      }
    }

    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const nums = parts.filter(p => /^\d+$/.test(p));
      const id = nums[0];
      if (id) {
        // Unlisted videos carry a hash, either as the next path part or ?h=.
        const next = parts[parts.indexOf(id) + 1];
        const hash = u.searchParams.get('h') || (next && /^[0-9a-f]{6,}$/i.test(next) ? next : '');
        return out('vimeo', { embedUrl: `https://player.vimeo.com/video/${id}?playsinline=1${hash ? `&h=${hash}` : ''}` });
      }
    }

    if (host === 'drive.google.com') {
      const i = parts.indexOf('d');
      const id = (parts[0] === 'file' && i >= 0 ? parts[i + 1] : '') || u.searchParams.get('id');
      if (/^[\w-]{10,}$/.test(id || '')) return out('drive', { embedUrl: `https://drive.google.com/file/d/${id}/preview` });
    }

    if (/\.(mp4|m4v|mov|webm)$/i.test(u.pathname)) return out('file', { fileUrl: u.toString() });
    return out('link');
  }

  // "All clients", "Ana", "Ana and Bob", "Ana, Bob and 3 more"
  function audienceText(video, namesByUid) {
    if (!video || video.audience !== 'selected') return 'All clients';
    const names = (video.clientUids || []).map(uid => (namesByUid && namesByUid[uid]) || 'a former client');
    if (names.length <= 1) return names[0] || 'No one';
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
  }

  const api = { parseVideo, audienceText, categoryLabel, CATEGORIES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root || !root.document) return;

  // ── browser side ─────────────────────────────────────────────────

  const doc = root.document;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // ICONS is a top-level const in index.html, so it isn't a window property.
  // eslint-disable-next-line no-undef
  const icon = name => `<span class="ui-icon">${(typeof ICONS !== 'undefined' && ICONS[name]) || ''}</span>`;
  const toast = (msg, kind) => { if (root.showToast) root.showToast(msg, kind); };
  const base = () => String(root.SERVER_URL || '').replace(/\/$/, '');
  const headers = () => (typeof root.getAuthHeaders === 'function' ? root.getAuthHeaders() : {});

  async function api$(method, path, body) {
    const res = await fetch(base() + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers() },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.success) throw new Error((data && data.error && data.error.message) || `HTTP ${res.status}`);
    return data;
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  // ── player sheet ─────────────────────────────────────────────────

  function closePlayer() {
    // Removing the iframe / <video> is what stops playback.
    doc.getElementById('cvPlayer')?.remove();
    doc.removeEventListener('keydown', onPlayerKey);
  }
  function onPlayerKey(e) { if (e.key === 'Escape') closePlayer(); }

  // video: { title, videoUrl, message?, category?, coachUsername?, createdAt? }
  function openPlayer(video) {
    const v = video || {};
    const info = parseVideo(v.videoUrl);
    if (!info) { toast('That video link is not valid.', 'error'); return; }
    closePlayer();

    let media;
    if (info.embedUrl) {
      media = `<iframe src="${esc(info.embedUrl)}" title="${esc(v.title || 'Video')}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    } else if (info.fileUrl) {
      media = `<video src="${esc(info.fileUrl)}" controls playsinline preload="metadata"></video>`;
    } else {
      media = `<div class="cv-nofeed">${icon('video')}<span>This link can't play inside the app.</span></div>`;
    }
    const meta = [v.category ? categoryLabel(v.category) : '', v.coachUsername ? `from ${v.coachUsername}` : '', v.createdAt ? fmtDate(v.createdAt) : '']
      .filter(Boolean).join(' · ');

    const wrap = doc.createElement('div');
    wrap.id = 'cvPlayer';
    wrap.className = 'mx-sheet-backdrop cv-backdrop';
    wrap.innerHTML = `
      <div class="mx-sheet cv-sheet" role="dialog" aria-modal="true" aria-labelledby="cvTitle">
        <div class="mx-sheet-head">
          <div class="cv-head-text">
            ${meta ? `<span class="mx-kicker">${esc(meta)}</span>` : ''}
            <h3 class="pod-title mx-h3" id="cvTitle">${esc(v.title || 'Video')}</h3>
          </div>
          <button type="button" class="mx-iconbtn mx-iconbtn--ghost cv-close" aria-label="Close">${icon('x')}</button>
        </div>
        <div class="cv-frame${info.embedUrl || info.fileUrl ? '' : ' cv-frame--empty'}">${media}</div>
        ${v.message ? `<p class="cv-message">${esc(v.message)}</p>` : ''}
        <a class="mx-outline cv-open" href="${esc(v.videoUrl)}" target="_blank" rel="noopener">Open in ${esc(info.provider === 'link' ? 'browser' : info.label)}</a>
      </div>`;
    doc.body.appendChild(wrap);
    wrap.addEventListener('click', e => { if (e.target === wrap) closePlayer(); });
    wrap.querySelector('.cv-close').addEventListener('click', closePlayer);
    doc.addEventListener('keydown', onPlayerKey);
  }

  // ── coach side: library pod ──────────────────────────────────────

  const coach = { videos: [], clients: [], editing: null, audience: 'all', picked: new Set(), loaded: false };

  function namesByUid() {
    const out = {};
    coach.clients.forEach(c => { out[c.id] = c.name; });
    return out;
  }

  function formHtml() {
    const e = coach.editing;
    const active = coach.clients.filter(c => !c.isPending);
    const opts = CATEGORIES.map(c => `<option value="${c.id}"${(e ? e.category : 'program') === c.id ? ' selected' : ''}>${c.label}</option>`).join('');
    const clientList = active.length
      ? active.map(c => `
          <label class="cv-client">
            <input type="checkbox" value="${esc(c.id)}"${coach.picked.has(c.id) ? ' checked' : ''} />
            <span>${esc(c.name)}</span>
          </label>`).join('')
      : '<div class="mx-empty">No active clients yet.</div>';
    return `
      <div class="pod-row"><h4 class="pod-title mx-h3">${e ? 'Edit video' : 'Send a video'}</h4></div>
      <p class="mx-sub">Explain the program, the diet or cardio in a video. Record it in Loom (or upload to YouTube, Vimeo or Drive), paste the link, and your clients watch it right here in the app.</p>
      <div class="mx-field">
        <label class="mx-lbl" for="cvTitleIn">Title</label>
        <div class="mx-well mx-well--text"><input type="text" id="cvTitleIn" maxlength="120" placeholder="e.g. How your first 4 weeks work" value="${esc(e ? e.title : '')}" /></div>
      </div>
      <div class="mx-field">
        <label class="mx-lbl" for="cvCategoryIn">About</label>
        <div class="mx-well mx-well--text mx-well--sel"><select id="cvCategoryIn">${opts}</select></div>
      </div>
      <div class="mx-field">
        <label class="mx-lbl" for="cvUrlIn">Video link</label>
        <div class="mx-well mx-well--text"><input type="url" id="cvUrlIn" inputmode="url" placeholder="https://www.loom.com/share/…" value="${esc(e ? e.videoUrl : '')}" /></div>
        <div id="cvUrlHint" class="mx-sub cv-url-hint" aria-live="polite"></div>
      </div>
      <div class="mx-field">
        <label class="mx-lbl" for="cvMessageIn">Message <em>optional</em></label>
        <div class="mx-well mx-well--area"><textarea id="cvMessageIn" maxlength="2000" placeholder="Anything to add before they watch">${esc(e ? e.message : '')}</textarea></div>
      </div>
      <div class="mx-field">
        <span class="mx-lbl">Send to</span>
        <div class="mx-segs cv-audience" role="group" aria-label="Send to">
          <button type="button" data-cv-aud="all" class="${coach.audience === 'all' ? 'active' : ''}" aria-pressed="${coach.audience === 'all'}">All clients</button>
          <button type="button" data-cv-aud="selected" class="${coach.audience === 'selected' ? 'active' : ''}" aria-pressed="${coach.audience === 'selected'}">Choose</button>
        </div>
        <div class="cv-clients"${coach.audience === 'selected' ? '' : ' hidden'}>${clientList}</div>
      </div>
      <div class="cv-actions">
        <button type="button" class="mx-cta" data-cv-act="save"><span>${e ? 'Save changes' : 'Send video'}</span><span class="mx-cta-icon">${icon('check')}</span></button>
        ${e ? '<button type="button" class="mx-outline" data-cv-act="cancel">Cancel</button>' : ''}
      </div>
      <div id="cvStatus" class="mx-sub coach-video-status" aria-live="polite"></div>`;
  }

  function listHtml() {
    if (!coach.loaded) return '<div class="mx-empty">Loading…</div>';
    if (!coach.videos.length) return '<div class="mx-empty">No videos yet. Your first one could be a welcome or a walkthrough of their program.</div>';
    const names = namesByUid();
    return coach.videos.map(v => `
      <div class="mx-row cv-row">
        <button type="button" class="cv-thumb" data-cv-play="${esc(v.id)}" aria-label="Play ${esc(v.title)}">${icon('video')}</button>
        <div class="mx-row-main">
          <span class="mx-row-title">${esc(v.title)}</span>
          <span class="mx-row-sub">${esc(categoryLabel(v.category))} · ${esc(audienceText(v, names))} · ${esc(fmtDate(v.createdAt))}</span>
        </div>
        <button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-cv-edit="${esc(v.id)}" aria-label="Edit ${esc(v.title)}">${icon('pencil')}</button>
        <button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-cv-del="${esc(v.id)}" aria-label="Delete ${esc(v.title)}">${icon('x')}</button>
      </div>`).join('');
  }

  function renderCoach() {
    const host = doc.getElementById('coachVideoLibrary');
    if (!host) return;
    host.innerHTML = `
      <section class="pod mx-pod cv-form">${formHtml()}</section>
      <section class="pod mx-pod">
        <div class="pod-row"><h4 class="pod-title mx-h3">Sent videos</h4>${coach.videos.length ? `<span class="mx-meta">${coach.videos.length}</span>` : ''}</div>
        <div class="cv-list">${listHtml()}</div>
      </section>`;
    updateUrlHint();
  }

  function updateUrlHint() {
    const hint = doc.getElementById('cvUrlHint');
    const val = doc.getElementById('cvUrlIn')?.value.trim();
    if (!hint) return;
    if (!val) { hint.textContent = ''; hint.className = 'mx-sub cv-url-hint'; return; }
    const info = parseVideo(val);
    if (!info) { hint.textContent = 'Paste a full link starting with https://'; hint.className = 'mx-sub cv-url-hint is-bad'; return; }
    hint.textContent = info.provider === 'link'
      ? 'Clients will open this link outside the app.'
      : `${info.label} · plays inside the app`;
    hint.className = `mx-sub cv-url-hint${info.provider === 'link' ? '' : ' is-ok'}`;
  }

  async function loadCoachVideos() {
    const host = doc.getElementById('coachVideoLibrary');
    if (!host) return;
    if (!coach.loaded) renderCoach();
    const [vids, roster] = await Promise.all([
      api$('GET', '/api/coach/videos').catch(err => { console.warn('[CoachVideos] list failed', err); return null; }),
      typeof root.loadCoachClients === 'function' ? root.loadCoachClients().catch(() => null) : null
    ]);
    coach.videos = (vids && vids.videos) || [];
    if (roster && Array.isArray(roster.clients)) coach.clients = roster.clients;
    coach.loaded = true;
    if (!vids) {
      // Keep whatever the coach typed; only the list shows the error.
      const list = host.querySelector('.cv-list');
      if (list) list.innerHTML = '<div class="mx-empty">Could not load your videos.</div>';
      return;
    }
    // Don't wipe a half-filled form on refresh.
    const typing = ['cvTitleIn', 'cvUrlIn', 'cvMessageIn'].some(id => doc.getElementById(id)?.value.trim());
    if (typing) {
      host.querySelector('.cv-list').innerHTML = listHtml();
    } else {
      renderCoach();
    }
  }

  function startEdit(id) {
    const v = coach.videos.find(x => x.id === id);
    if (!v) return;
    coach.editing = v;
    coach.audience = v.audience === 'selected' ? 'selected' : 'all';
    coach.picked = new Set(v.clientUids || []);
    renderCoach();
    doc.querySelector('#coachVideoLibrary .cv-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetForm() {
    coach.editing = null;
    coach.audience = 'all';
    coach.picked = new Set();
    renderCoach();
  }

  async function save(btn) {
    const status = doc.getElementById('cvStatus');
    const say = msg => { if (status) status.textContent = msg; };
    const title = doc.getElementById('cvTitleIn').value.trim();
    const videoUrl = doc.getElementById('cvUrlIn').value.trim();
    const body = {
      title,
      category: doc.getElementById('cvCategoryIn').value,
      videoUrl,
      message: doc.getElementById('cvMessageIn').value.trim(),
      audience: coach.audience,
      clientUids: coach.audience === 'selected' ? [...coach.picked] : []
    };
    if (!title) return say('Give the video a title.');
    if (!parseVideo(videoUrl)) return say('Paste the video link (it starts with https://).');
    if (body.audience === 'selected' && !body.clientUids.length) return say('Pick at least one client.');

    btn.disabled = true;
    say(coach.editing ? 'Saving…' : 'Sending…');
    try {
      const editing = coach.editing;
      const data = editing
        ? await api$('PATCH', `/api/coach/videos/${encodeURIComponent(editing.id)}`, body)
        : await api$('POST', '/api/coach/videos', body);
      const n = data.notified || 0;
      toast(editing
        ? (n ? `Saved. ${n} more client${n === 1 ? '' : 's'} notified.` : 'Video updated.')
        : (n ? `Sent to ${n} client${n === 1 ? '' : 's'}.` : 'Video saved. Clients see it once they accept your invite.'));
      coach.editing = null;
      coach.audience = 'all';
      coach.picked = new Set();
      ['cvTitleIn', 'cvUrlIn', 'cvMessageIn'].forEach(id => { const el = doc.getElementById(id); if (el) el.value = ''; });
      await loadCoachVideos();
    } catch (err) {
      btn.disabled = false;
      say(err.message || 'Could not save. Check your connection and try again.');
    }
  }

  async function remove(id) {
    const v = coach.videos.find(x => x.id === id);
    if (!v) return;
    const ok = typeof root.showConfirm === 'function'
      ? await root.showConfirm(`Delete "${v.title}"? Your clients won't see it any more.`, { danger: true, confirmText: 'Delete' })
      : root.confirm(`Delete "${v.title}"?`);
    if (!ok) return;
    try {
      await api$('DELETE', `/api/coach/videos/${encodeURIComponent(id)}`);
      if (coach.editing && coach.editing.id === id) coach.editing = null;
      coach.videos = coach.videos.filter(x => x.id !== id);
      toast('Video deleted.');
      renderCoach();
    } catch (err) {
      toast(err.message || 'Could not delete the video.', 'error');
    }
  }

  function onCoachClick(e) {
    const t = e.target.closest('[data-cv-aud],[data-cv-act],[data-cv-play],[data-cv-edit],[data-cv-del]');
    if (!t) return;
    if (t.dataset.cvAud) {
      coach.audience = t.dataset.cvAud;
      t.parentElement.querySelectorAll('button').forEach(b => {
        const on = b === t;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      const list = doc.querySelector('#coachVideoLibrary .cv-clients');
      if (list) list.hidden = coach.audience !== 'selected';
      return;
    }
    if (t.dataset.cvAct === 'save') return save(t);
    if (t.dataset.cvAct === 'cancel') return resetForm();
    if (t.dataset.cvPlay) {
      const v = coach.videos.find(x => x.id === t.dataset.cvPlay);
      if (v) openPlayer(v);
      return;
    }
    if (t.dataset.cvEdit) return startEdit(t.dataset.cvEdit);
    if (t.dataset.cvDel) return remove(t.dataset.cvDel);
  }

  function onCoachChange(e) {
    if (e.target.matches('.cv-client input')) {
      if (e.target.checked) coach.picked.add(e.target.value);
      else coach.picked.delete(e.target.value);
    }
  }

  function init() {
    const host = doc.getElementById('coachVideoLibrary');
    if (!host) return;
    host.addEventListener('click', onCoachClick);
    host.addEventListener('change', onCoachChange);
    host.addEventListener('input', e => { if (e.target.id === 'cvUrlIn') updateUrlHint(); });
  }

  root.CoachVideos = { ...api, openPlayer, closePlayer, loadCoachVideos };
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
