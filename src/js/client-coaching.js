/* =============================================================
   CLIENT SIDE OF COACHING
   - Your Coach (Settings): pending invites (accept / decline), the
     linked coach, their assigned program (import) and macro targets
     (apply), their notes, and what you share with them.
   - Share: pushes a small snapshot (recent check-ins, bodyweight,
     weekly workout counts, compliance) to POST /api/client/coach-share
     when you have a coach. The server filters it by your sharing
     switches, so switching something off here stops it reaching them.
   Pure helpers are exported for tests (tests/clientCoaching.test.js).
   ============================================================= */

(function (root) {
  'use strict';

  const SHARE_THROTTLE_MS = 15 * 60 * 1000;
  const SHARE_DAYS_BODYWEIGHT = 120;
  const SHARE_WEEKS = 8;
  const CHECKIN_PREFIX = 'tl_checkins_v1_';

  // ── pure helpers ─────────────────────────────────────────────────

  function readJSON(store, key, fallback) {
    try {
      const raw = store.getItem(key);
      if (raw == null) return fallback;
      const v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch { return fallback; }
  }

  const arr = v => (Array.isArray(v) ? v : []);
  const numOrNull = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

  function isoDay(date) {
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  // Monday of the (local) week containing `date`.
  function weekStart(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }

  function allWorkouts(store, username) {
    const seen = new Set();
    const out = [];
    [readJSON(store, `workoutHistory_${username}`, []), readJSON(store, `workouts_${username}`, [])].forEach(list => {
      arr(list).forEach(w => {
        if (!w || !w.date) return;
        const key = w.id || `${String(w.date).slice(0, 10)}|${w.title || w.name || ''}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(w);
      });
    });
    return out;
  }

  // Sessions = distinct training days, so one workout split into several
  // entries on the same day still counts once.
  function weeklySessionCounts(store, username, now, weeks) {
    const start = weekStart(now);
    const buckets = [];
    for (let i = weeks - 1; i >= 0; i--) {
      const ws = new Date(start);
      ws.setDate(ws.getDate() - i * 7);
      buckets.push({ weekStart: isoDay(ws), days: new Set() });
    }
    const first = buckets[0].weekStart;
    allWorkouts(store, username).forEach(w => {
      const day = String(w.date).slice(0, 10);
      if (day < first) return;
      for (let i = buckets.length - 1; i >= 0; i--) {
        if (day >= buckets[i].weekStart) { buckets[i].days.add(day); break; }
      }
    });
    return buckets.map(b => ({ weekStart: b.weekStart, count: b.days.size }));
  }

  function activeProgram(store, username) {
    const active = readJSON(store, `activeProgram_${username}`, null) || readJSON(store, 'activeProgram', null);
    if (!active) return null;
    const id = active.programId || active.id;
    const programs = arr(readJSON(store, `programs_${username}`, null) || readJSON(store, 'programs', []));
    const program = programs.find(p => p && (p.id === id || p.programId === id)) || null;
    const perWeek = program
      ? (arr(program.frequency).length || arr(program.days).length || null)
      : null;
    const startDate = String(active.startDate || (program && program.startDate) || '').slice(0, 10);
    return { name: active.programName || (program && (program.name || program.title)) || '', perWeek, startDate };
  }

  // Average of sessions / planned over the last completed weeks (up to 4)
  // since the program started. Null without an active program, or before a
  // full week on it: nothing to measure against, and a coach must never see
  // a made-up 0%.
  function compliancePercent(weekly, perWeek, startDate) {
    if (!perWeek) return null;
    const start = startDate ? isoDay(weekStart(new Date(startDate + 'T12:00:00'))) : '';
    const done = weekly.slice(0, -1).filter(w => !start || w.weekStart >= start).slice(-4);
    if (!done.length) return null;
    const pct = done.reduce((s, w) => s + Math.min(1, w.count / perWeek), 0) / done.length;
    return Math.round(pct * 100);
  }

  function buildShareSnapshot(store, username, nowInput) {
    const now = nowInput instanceof Date ? nowInput : new Date(nowInput || Date.now());
    const checkIns = arr(readJSON(store, CHECKIN_PREFIX + username, []))
      .filter(c => c && c.date)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 12)
      .map(c => {
        const out = { date: String(c.date).slice(0, 10) };
        ['sleep', 'energy', 'stress', 'hunger', 'digestion', 'trainingPerformance', 'cardioAdherence', 'mood', 'motivation', 'soreness']
          .forEach(k => { const v = numOrNull(c[k]); if (v !== null) out[k] = v; });
        const bw = numOrNull(c.bodyweight);
        if (bw !== null) out.bodyweight = bw;
        if (typeof c.notes === 'string' && c.notes.trim()) out.notes = c.notes.trim().slice(0, 1000);
        const summary = c.insights && c.insights.summaryShort;
        if (typeof summary === 'string' && summary) out.summary = summary.slice(0, 400);
        return out;
      });

    const cutoff = new Date(now);
    cutoff.setDate(cutoff.getDate() - SHARE_DAYS_BODYWEIGHT);
    const cutoffIso = isoDay(cutoff);
    const bodyweight = arr(readJSON(store, `bodyweightLog_${username}`, []))
      .map(e => ({ date: String((e && e.date) || '').slice(0, 10), weight: numOrNull(e && (e.weightKg != null ? e.weightKg : e.weight)) }))
      .filter(e => e.date && e.date >= cutoffIso && e.weight !== null);

    const weekly = weeklySessionCounts(store, username, now, SHARE_WEEKS);
    const program = activeProgram(store, username);
    return {
      checkIns,
      bodyweight,
      workouts: { thisWeek: weekly[weekly.length - 1].count, weekStart: weekly[weekly.length - 1].weekStart, weekly },
      compliancePercent: compliancePercent(weekly, program && program.perWeek, program && program.startDate),
      activeProgramName: (program && program.name) || ''
    };
  }

  const api = { buildShareSnapshot, weeklySessionCounts, compliancePercent, weekStart, isoDay };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!root || !root.document) return;
  root.ClientCoaching = api;

  // ── browser side ─────────────────────────────────────────────────

  const doc = root.document;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // ICONS is a top-level const in index.html, so it isn't a window property.
  // eslint-disable-next-line no-undef
  const icon = name => (typeof ICONS !== 'undefined' && ICONS[name]) || '';
  const toast = (msg, kind) => { if (root.showToast) root.showToast(msg, kind); };
  const user = () => root.currentUser || root.localStorage.getItem('fitnessAppUser') || root.localStorage.getItem('username') || '';
  const base = () => String(root.SERVER_URL || '').replace(/\/$/, '');
  const headers = () => (typeof root.getAuthHeaders === 'function' ? root.getAuthHeaders() : {});
  const linkKey = () => `coachLinked_${user()}`;
  const shareKey = () => `coachSharedAt_${user()}`;

  async function api$(method, path, body) {
    const res = await fetch(base() + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers() },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.success) {
      const err = new Error((data && data.error && data.error.message) || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  const state = { invites: [], assignments: [], notes: [], sharing: null };

  // ── sharing push ─────────────────────────────────────────────────

  async function pushShare(options) {
    const opts = options || {};
    if (!root.localStorage.getItem('token') || !user()) return;
    if (root.localStorage.getItem(linkKey()) !== 'true') return;
    const last = Number(root.localStorage.getItem(shareKey())) || 0;
    if (!opts.force && Date.now() - last < SHARE_THROTTLE_MS) return;
    try {
      const snapshot = buildShareSnapshot(root.localStorage, user(), new Date());
      const data = await api$('POST', '/api/client/coach-share', snapshot);
      root.localStorage.setItem(shareKey(), String(Date.now()));
      if (data.coaches === 0) root.localStorage.setItem(linkKey(), 'false');
    } catch (err) {
      console.info('[CoachShare] skipped:', err.message);
    }
  }

  function hookCheckInSaves() {
    const engine = root.checkinEngine;
    if (!engine || engine.__coachShareHooked || typeof engine.saveCheckIn !== 'function') return;
    const original = engine.saveCheckIn;
    engine.saveCheckIn = function () {
      const out = original.apply(this, arguments);
      setTimeout(() => pushShare({ force: true }), 0);
      return out;
    };
    engine.__coachShareHooked = true;
  }

  // ── Your Coach section ───────────────────────────────────────────

  async function load() {
    const get = path => api$('GET', path).catch(() => null);
    const [inv, asn, notes, sharing] = await Promise.all([
      get('/api/client/coach-invites'),
      get('/api/client/coach-assignment'),
      get('/api/client/coach-notes'),
      get('/api/client/coach-sharing')
    ]);
    if (!inv && !asn && !notes) return false;
    state.invites = (inv && inv.invites) || [];
    state.assignments = (asn && asn.assignments) || [];
    // Newest first, by timestamp (don't rely on the server's order).
    const noteMs = (n) => (n && n.createdAt && n.createdAt._seconds ? n.createdAt._seconds * 1000 : Date.parse(n && n.createdAt) || 0);
    state.notes = ((notes && notes.notes) || []).slice().sort((a, b) => noteMs(b) - noteMs(a));
    state.sharing = (sharing && sharing.sharing) || state.sharing || { checkIns: true, bodyweight: true, workouts: true };
    const linked = state.invites.some(i => i.status === 'active');
    root.localStorage.setItem(linkKey(), linked ? 'true' : 'false');
    return true;
  }

  function fmtDate(ts) {
    const ms = ts && ts._seconds ? ts._seconds * 1000 : ts;
    if (!ms) return '';
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }

  function switchRow(key, title, sub) {
    const on = !!(state.sharing && state.sharing[key]);
    return `
      <div class="cn-row" style="min-height:58px">
        <span class="cn-row-main"><span class="cn-row-title" style="font-weight:500">${title}</span><span class="cn-row-sub">${sub}</span></span>
        <button type="button" class="cn-switch" role="switch" aria-checked="${on}" aria-label="Share ${title.toLowerCase()} with your coach" data-yc-share="${key}"></button>
      </div>`;
  }

  const initials = (name) => String(name || '?').split(/[\s._-]+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();

  function render() {
    const section = doc.getElementById('yourCoachSection');
    if (!section) return;
    const pending = state.invites.filter(i => i.status === 'pending');
    const active = state.invites.filter(i => i.status === 'active');
    if (!pending.length && !active.length && !state.notes.length) { section.hidden = true; section.innerHTML = ''; return; }
    section.hidden = false;

    const pendingHtml = pending.map(inv => `
      <section class="cn-card">
        <div style="display:flex;gap:12px;align-items:center">
          <span class="cn-avatar">${esc(initials(inv.coachUsername))}</span>
          <span class="cn-row-main"><span class="cn-row-title">${esc(inv.coachUsername)} wants to coach you</span>
            <span class="cn-row-sub">Accepting shares your check-ins, bodyweight and workout counts. You can change this any time.</span></span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px">
          <button type="button" class="cn-btn cn-btn--primary" data-yc-accept="${esc(inv.coachUsername)}">Accept</button>
          <button type="button" class="cn-btn" data-yc-leave="${esc(inv.coachUid)}" data-yc-name="${esc(inv.coachUsername)}" data-yc-pending="1">Decline</button>
        </div>
      </section>`).join('');

    const activeHtml = active.map(inv => {
      const asn = state.assignments.find(a => a.coachUid === inv.coachUid || a.coachUsername === inv.coachUsername) || {};
      const m = asn.macroTargets;
      const program = asn.program;
      const since = fmtDate(inv.acceptedAt);
      const offers = [];
      if (asn.currentProgram) {
        offers.push(`
          <div class="cn-offer">
            <div style="display:flex;flex-direction:column;gap:2px">
              <span class="cn-offer-kicker">Program</span>
              <span class="cn-offer-title">${esc(asn.currentProgram)}</span>
              ${program ? `<span class="cn-offer-kicker">${esc(arr(program.frequency).join(', ') || `${program.days.length} days a week`)}</span>` : ''}
            </div>
            ${program ? `<button type="button" class="cn-btn cn-btn--primary" data-yc-import="${esc(inv.coachUid)}">Start</button>` : ''}
          </div>`);
      }
      if (m) {
        offers.push(`
          <div class="cn-offer">
            <div style="display:flex;flex-direction:column;gap:2px">
              <span class="cn-offer-kicker">Macro targets</span>
              <span class="cn-offer-title cn-num">${m.calories} kcal</span>
              <span class="cn-offer-kicker cn-num">${m.protein}P ${m.carbs}C ${m.fat}F</span>
            </div>
            <button type="button" class="cn-btn" data-yc-macros="${esc(inv.coachUid)}">Apply</button>
          </div>`);
      } else if (asn.nutritionSummary) {
        offers.push(`<div class="cn-offer"><span class="cn-offer-kicker">Nutrition</span><span class="cn-offer-title">${esc(asn.nutritionSummary)}</span></div>`);
      }
      return `
        <div class="cn-coach-card">
          <span class="cn-avatar cn-avatar--lg" style="width:52px;height:52px;font-size:18px">${esc(initials(inv.coachUsername))}</span>
          <span class="cn-row-main"><span class="cn-row-title" style="font-size:18px">${esc(inv.coachUsername)}</span>
            <span class="cn-row-sub">${since ? `Coaching you since ${esc(since)}` : 'Your coach'}</span></span>
        </div>
        ${offers.length ? `<div class="cn-offer-grid">${offers.join('')}</div>` : ''}`;
    }).join('');

    const latest = state.notes[0];
    const notesHtml = latest ? `
      <h2 class="cn-group-label">Latest note</h2>
      <section class="cn-card" style="margin-top:0">
        <p class="cn-quote" style="color:var(--cn-text);white-space:pre-wrap">${esc(latest.text)}</p>
        <span class="cn-caption">${esc(fmtDate(latest.createdAt))}${latest.coachUsername ? ' · ' + esc(latest.coachUsername) : ''}${state.notes.length > 1 ? ` · ${state.notes.length - 1} earlier` : ''}</span>
      </section>
      ${state.notes.length > 1 ? `
        <details class="cn-card" style="margin-top:8px">
          <summary class="cn-card-title" style="cursor:pointer">Earlier notes</summary>
          ${state.notes.slice(1, 20).map(n => `<div style="display:flex;flex-direction:column;gap:2px;padding-top:10px">
            <span class="cn-caption">${esc(fmtDate(n.createdAt))}</span><span class="cn-sub" style="color:var(--cn-text);white-space:pre-wrap">${esc(n.text)}</span></div>`).join('')}
        </details>` : ''}` : '';

    const coachName = active[0] ? esc(active[0].coachUsername) : 'your coach';
    const sharingHtml = active.length ? `
      <h2 class="cn-group-label">What ${coachName} can see</h2>
      <div class="cn-group cn-group--plain">
        ${switchRow('checkIns', 'Check-ins', 'Scores, notes and dates')}
        ${switchRow('bodyweight', 'Bodyweight', 'Weigh-ins from the last 4 months')}
        ${switchRow('workouts', 'Workouts', 'Sessions per week and adherence')}
      </div>` : '';

    const leaveHtml = active.map(inv => `
      <button type="button" class="cn-leave" data-yc-leave="${esc(inv.coachUid)}" data-yc-name="${esc(inv.coachUsername)}">Stop being coached by ${esc(inv.coachUsername)}</button>`).join('');

    section.innerHTML = `
      <h2 class="cn-title">Your Coach</h2>
      ${pendingHtml}${activeHtml}${notesHtml}${sharingHtml}${leaveHtml}`;
  }

  async function renderYourCoachSection() {
    const section = doc.getElementById('yourCoachSection');
    if (!section) return;
    if (!root.localStorage.getItem('token')) { section.hidden = true; return; }
    const ok = await load();
    if (!ok) { section.hidden = true; return; }
    render();
    pushShare();
  }

  async function onClick(e) {
    const t = e.target.closest('[data-yc-accept],[data-yc-leave],[data-yc-import],[data-yc-macros],[data-yc-share]');
    if (!t) return;

    if (t.dataset.ycAccept) {
      t.disabled = true;
      try {
        await api$('POST', '/api/coach/clients/accept', { coachUsername: t.dataset.ycAccept });
        toast(`You're now coached by ${t.dataset.ycAccept}.`);
        root.localStorage.setItem(linkKey(), 'true');
        await renderYourCoachSection();
        pushShare({ force: true });
      } catch (err) { toast(err.message || 'Could not accept the invite.', 'error'); t.disabled = false; }
      return;
    }

    if (t.dataset.ycLeave) {
      const name = t.dataset.ycName || 'this coach';
      const pending = t.dataset.ycPending === '1';
      const ok = await root.showConfirm(pending
        ? `Decline ${name}'s invite?`
        : `Stop being coached by ${name}? They'll lose access to everything you've shared, and their program and notes stay with you.`,
        { danger: !pending, confirmText: pending ? 'Decline' : 'Leave' });
      if (!ok) return;
      try {
        await api$('DELETE', `/api/client/coaches/${encodeURIComponent(t.dataset.ycLeave)}`);
        toast(pending ? 'Invite declined.' : `You've left ${name}.`);
        renderYourCoachSection();
      } catch (err) { toast(err.message || 'Something went wrong. Try again.', 'error'); }
      return;
    }

    if (t.dataset.ycImport) {
      const asn = state.assignments.find(a => a.coachUid === t.dataset.ycImport);
      const core = root.programBuilderV2Core;
      if (!asn || !asn.program || !core) return;
      const ok = await root.showConfirm(`Start "${asn.program.title}"? It becomes your active program and Today's session follows it.`, { confirmText: 'Start program' });
      if (!ok) return;
      const imported = core.importLibraryProgram(root, asn.program, { userId: user() });
      if (imported) core.startProgram(root, imported.id, { userId: user() });
      toast(`${asn.program.title} is now your active program.`);
      if (typeof root.renderTodayProgramCard === 'function') root.renderTodayProgramCard();
      pushShare({ force: true });
      return;
    }

    if (t.dataset.ycMacros) {
      const asn = state.assignments.find(a => a.coachUid === t.dataset.ycMacros);
      const m = asn && asn.macroTargets;
      if (!m) return;
      const ok = await root.showConfirm(`Replace your macro targets with ${m.calories} kcal · ${m.protein}P / ${m.carbs}C / ${m.fat}F?`, { confirmText: 'Apply' });
      if (!ok) return;
      const target = { calories: m.calories, protein: m.protein, fat: m.fat, carbs: m.carbs };
      // Same path as saving targets in the Macros tab: server first, then
      // local storage + on-screen refresh.
      if (typeof root.saveToAirtable === 'function') await root.saveToAirtable(user(), target);
      if (typeof root.saveMacroTargetsToTop === 'function') root.saveMacroTargetsToTop(target);
      else root.localStorage.setItem(`macroTargets_${user()}`, JSON.stringify(target));
      toast('Macro targets updated.');
      return;
    }

    if (t.dataset.ycShare) {
      const key = t.dataset.ycShare;
      const next = !(state.sharing && state.sharing[key]);
      t.setAttribute('aria-checked', String(next));
      try {
        const data = await api$('PUT', '/api/client/coach-sharing', { [key]: next });
        state.sharing = data.sharing;
        if (next) pushShare({ force: true });
      } catch (err) {
        t.setAttribute('aria-checked', String(!next));
        toast(err.message || 'Could not update sharing.', 'error');
      }
    }
  }

  function init() {
    doc.getElementById('yourCoachSection')?.addEventListener('click', onClick);
    hookCheckInSaves();
    renderYourCoachSection();
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') pushShare(); });
  }

  root.renderYourCoachSection = renderYourCoachSection;
  root.pushCoachShare = pushShare;
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : null);
