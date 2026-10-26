/* =============================================================
   CLIENT SIDE OF COACHING
   - Your Coach (Settings): pending invites (accept / decline), the
     linked coach, their assigned program (import), macro targets
     (apply), training focus and published plan (Program › My Plan),
     their messages, their videos (played by src/js/coach-videos.js)
     and what you share with them.
   - Home card (#yourCoachHomeCard): the same, condensed — a pending
     invite with Accept, or the coach, their newest message and what's
     new since you last looked. Hidden when there's no coach at all.
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

  // Coaches tag a message as a heads-up or praise; the coach app sends that
  // as a text prefix (coaching-enhanced.js sendCoachMessage).
  function parseNote(text) {
    const raw = String(text == null ? '' : text);
    const m = raw.match(/^\[(HEADS-UP|PRAISE)\]\s*/);
    if (!m) return { kind: 'note', text: raw };
    return { kind: m[1] === 'PRAISE' ? 'praise' : 'alert', text: raw.slice(m[0].length) };
  }

  function tsMs(ts) {
    if (!ts) return 0;
    if (typeof ts === 'number') return ts;
    if (ts._seconds) return ts._seconds * 1000;
    if (ts.seconds) return ts.seconds * 1000;
    const n = Date.parse(ts);
    return Number.isNaN(n) ? 0 : n;
  }

  // Messages, videos and plan changes newer than the last time the athlete
  // opened Your Coach.
  function unseenCounts(st, seenAt) {
    const since = Number(seenAt) || 0;
    const newer = list => arr(list).filter(x => tsMs(x && x.createdAt) > since).length;
    return {
      notes: newer(st.notes),
      videos: newer(st.videos),
      plans: arr(st.assignments).filter(a => a && tsMs(a.updatedAt) > since && (a.currentProgram || a.macroTargets || a.nutritionSummary)).length
    };
  }

  const api = { buildShareSnapshot, weeklySessionCounts, compliancePercent, weekStart, isoDay, parseNote, unseenCounts, tsMs };
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
  const seenKey = () => `coachSeenAt_${user()}`;
  const startedKey = () => `coachProgramStarted_${user()}`;
  const seenAt = () => Number(root.localStorage.getItem(seenKey())) || 0;

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

  const state = { invites: [], assignments: [], notes: [], videos: [], sharing: null, plan: null, loadedAt: 0 };

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
    const plan = root.MyPlan && typeof root.MyPlan.fetchPlan === 'function'
      ? root.MyPlan.fetchPlan().catch(() => null) : Promise.resolve(null);
    const [inv, asn, notes, sharing, videos, planRes] = await Promise.all([
      get('/api/client/coach-invites'),
      get('/api/client/coach-assignment'),
      get('/api/client/coach-notes'),
      get('/api/client/coach-sharing'),
      get('/api/client/coach-videos'),
      plan
    ]);
    if (!inv) return false;
    state.invites = (inv && inv.invites) || [];
    state.assignments = (asn && asn.assignments) || [];
    state.notes = (notes && notes.notes) || [];
    state.videos = (videos && videos.videos) || [];
    state.sharing = (sharing && sharing.sharing) || state.sharing || { checkIns: true, bodyweight: true, workouts: true };
    if (planRes && planRes.ok) state.plan = planRes.plan || null;
    state.loadedAt = Date.now();
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

  const KIND_CHIP = {
    alert: '<span class="mx-chip mx-chip--brass mx-chip--sm">Heads-up</span>',
    praise: '<span class="mx-chip mx-chip--green mx-chip--sm">Praise</span>'
  };
  const NEW_CHIP = '<span class="mx-chip mx-chip--green mx-chip--sm">New</span>';

  function noteRow(n, since) {
    const p = parseNote(n.text);
    const isNew = tsMs(n.createdAt) > since;
    return `
        <div class="mx-row yc-msg${isNew ? ' is-new' : ''}"><div class="mx-row-main">
          <span class="mx-row-sub yc-msg-meta">${esc(fmtDate(n.createdAt))}${n.coachUsername ? ' · ' + esc(n.coachUsername) : ''}${KIND_CHIP[p.kind] || ''}${isNew ? NEW_CHIP : ''}</span>
          <span class="yc-note">${esc(p.text)}</span>
        </div></div>`;
  }

  function planTitle(plan) {
    return (plan && plan.package && plan.package.name) || 'Your plan';
  }

  function switchRow(key, title, sub) {
    const on = !!(state.sharing && state.sharing[key]);
    return `
      <div class="mx-row">
        <div class="mx-row-main"><span class="mx-row-title">${title}</span><span class="mx-row-sub">${sub}</span></div>
        <button type="button" class="mx-switch" role="switch" aria-checked="${on}" aria-label="Share ${title.toLowerCase()} with your coach" data-yc-share="${key}"></button>
      </div>`;
  }

  // Shown when there's no coach yet, so athletes always have a place to look
  // for an invite instead of a section that only appears once one exists.
  function emptyHtml(failed) {
    return `
      <div class="mx-row">
        <span class="mx-row-ico"><span class="ui-icon">${icon('users')}</span></span>
        <div class="mx-row-main">
          <span class="mx-row-title">${failed ? 'Couldn\u2019t check for invites' : 'No coach yet'}</span>
          <span class="mx-row-sub">${failed
            ? 'Check your connection and try again.'
            : 'When a coach invites you, their invite shows up here and in your notifications. Share your username with them to get started.'}</span>
        </div>
        <button type="button" class="mx-outline" data-yc-refresh="1">${failed ? 'Try again' : 'Check'}</button>
      </div>`;
  }

  function renderFailed() {
    const section = doc.getElementById('yourCoachSection');
    if (!section) return;
    section.hidden = false;
    section.innerHTML = `
      <section class="pod mx-pod yc-pod" aria-label="Your coach">
        <div class="pod-row"><h3 class="pod-title mx-h3">Your Coach</h3></div>
        ${emptyHtml(true)}
      </section>`;
  }

  function render() {
    const section = doc.getElementById('yourCoachSection');
    if (!section) return;
    const pending = state.invites.filter(i => i.status === 'pending');
    const active = state.invites.filter(i => i.status === 'active');
    section.hidden = false;

    const pendingHtml = pending.map(inv => `
      <div class="mx-row yc-invite">
        <span class="mx-row-ico"><span class="ui-icon">${icon('users')}</span></span>
        <div class="mx-row-main">
          <span class="mx-row-title">${esc(inv.coachUsername)} wants to coach you</span>
          <span class="mx-row-sub">Accepting shares your check-ins, bodyweight and workout counts with them. You can change this any time.</span>
        </div>
      </div>
      <div class="yc-actions">
        <button type="button" class="mx-cta" data-yc-accept="${esc(inv.coachUsername)}"><span>Accept</span><span class="mx-cta-icon"><span class="ui-icon">${icon('check')}</span></span></button>
        <button type="button" class="mx-outline" data-yc-leave="${esc(inv.coachUid)}" data-yc-name="${esc(inv.coachUsername)}" data-yc-pending="1">Decline</button>
      </div>`).join('');

    const activeHtml = active.map(inv => {
      const asn = state.assignments.find(a => a.coachUid === inv.coachUid || a.coachUsername === inv.coachUsername) || {};
      const m = asn.macroTargets;
      const program = asn.program;
      const started = readJSON(root.localStorage, startedKey(), {});
      const startedRev = started[inv.coachUid];
      const programRev = program ? String(program.rev && program.rev._seconds ? program.rev._seconds : (program.rev || program.programId || program.title)) : '';
      const programState = !program ? ''
        : startedRev === programRev ? '<span class="mx-chip mx-chip--sm">Started</span>'
          : startedRev ? '<span class="mx-chip mx-chip--brass mx-chip--sm">Updated</span>' : NEW_CHIP;
      return `
        <div class="mx-row">
          <span class="mx-row-ico"><span class="ui-icon">${icon('users')}</span></span>
          <div class="mx-row-main"><span class="mx-kicker">Coached by</span><span class="mx-row-title">${esc(inv.coachUsername)}</span></div>
          <button type="button" class="mx-outline mx-outline--danger" data-yc-leave="${esc(inv.coachUid)}" data-yc-name="${esc(inv.coachUsername)}">Leave</button>
        </div>
        ${asn.currentProgram ? `
          <div class="mx-row">
            <div class="mx-row-main"><span class="mx-lbl">Program ${programState}</span><span class="mx-row-title">${esc(asn.currentProgram)}</span>
              ${program ? `<span class="mx-row-sub">${program.days.length} day${program.days.length === 1 ? '' : 's'} a week · ${esc(arr(program.frequency).join(', '))}</span>` : ''}</div>
            ${program ? `<button type="button" class="mx-outline" data-yc-import="${esc(inv.coachUid)}" data-yc-rev="${esc(programRev)}">${startedRev === programRev ? 'Restart' : 'Start'}</button>` : ''}
          </div>` : ''}
        ${m ? `
          <div class="mx-row">
            <div class="mx-row-main"><span class="mx-lbl">Macro targets</span><span class="mx-row-title">${m.calories} kcal · ${m.protein}P / ${m.carbs}C / ${m.fat}F</span></div>
            <button type="button" class="mx-outline" data-yc-macros="${esc(inv.coachUid)}">Apply</button>
          </div>` : (asn.nutritionSummary ? `
          <div class="mx-row"><div class="mx-row-main"><span class="mx-lbl">Nutrition</span><span class="mx-row-title">${esc(asn.nutritionSummary)}</span></div></div>` : '')}
        ${asn.trainingMode ? `
          <div class="mx-row"><div class="mx-row-main"><span class="mx-lbl">Training focus</span><span class="mx-row-title">${esc(asn.trainingMode)}</span></div></div>` : ''}`;
    }).join('');

    const planHtml = active.length && state.plan ? `
        <div class="mx-row">
          <div class="mx-row-main"><span class="mx-lbl">Coaching plan</span><span class="mx-row-title">${esc(planTitle(state.plan))}</span>
            <span class="mx-row-sub">Phases, nutrition targets and weekly volume</span></div>
          <button type="button" class="mx-outline" data-yc-plan="1">View</button>
        </div>` : '';

    const sharingHtml = active.length ? `
      <div class="pod-row"><h4 class="pod-title mx-h3">What your coach sees</h4></div>
      ${switchRow('checkIns', 'Check-ins', 'Scores, notes and the date of your latest check-in')}
      ${switchRow('bodyweight', 'Bodyweight', 'Your weigh-ins from the last 4 months')}
      ${switchRow('workouts', 'Workouts', 'Sessions per week and how closely you follow your program')}` : '';

    const cv = root.CoachVideos;
    const videosHtml = state.videos.length && cv ? `
      <div class="pod-row"><h4 class="pod-title mx-h3">Videos from your coach</h4><span class="mx-meta">${state.videos.length}</span></div>
      ${state.videos.map(v => `
        <button type="button" class="mx-row yc-video" data-yc-video="${esc(v.id)}" aria-label="Play ${esc(v.title)}">
          <span class="cv-thumb" aria-hidden="true"><span class="ui-icon">${icon('video')}</span></span>
          <span class="mx-row-main">
            <span class="mx-row-title">${esc(v.title)}</span>
            <span class="mx-row-sub">${esc(cv.categoryLabel(v.category))} · ${esc(v.coachUsername)}${v.createdAt ? ' · ' + esc(fmtDate(Date.parse(v.createdAt))) : ''}</span>
          </span>
        </button>`).join('')}` : '';

    const since = seenAt();
    const shown = state.notes.slice(0, showAllNotes ? 100 : 10);
    const notesHtml = state.notes.length ? `
      <div class="pod-row"><h4 class="pod-title mx-h3">Messages from your coach</h4><span class="mx-meta">${state.notes.length}</span></div>
      ${shown.map(n => noteRow(n, since)).join('')}
      ${state.notes.length > shown.length ? `<button type="button" class="mx-outline mx-outline--block" data-yc-more="1">Show all ${state.notes.length}</button>` : ''}` : '';

    section.innerHTML = `
      <section class="pod mx-pod yc-pod" aria-label="Your coach">
        <div class="pod-row"><h3 class="pod-title mx-h3">Your Coach</h3></div>
        ${pendingHtml}${activeHtml}${planHtml}${pending.length || active.length ? '' : emptyHtml()}
      </section>
      ${notesHtml ? `<section class="pod mx-pod yc-pod" id="ycNotes">${notesHtml}</section>` : ''}
      ${videosHtml ? `<section class="pod mx-pod yc-pod" id="ycVideos">${videosHtml}</section>` : ''}
      ${sharingHtml ? `<section class="pod mx-pod yc-pod">${sharingHtml}</section>` : ''}`;
  }

  let showAllNotes = false;

  // ── Home card ────────────────────────────────────────────────────

  function renderHome() {
    const el = doc.getElementById('yourCoachHomeCard');
    if (!el) return;
    const pending = state.invites.filter(i => i.status === 'pending');
    const active = state.invites.filter(i => i.status === 'active');
    if (!root.localStorage.getItem('token') || (!pending.length && !active.length)) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    const since = seenAt();
    const u = unseenCounts(state, since);
    const total = u.notes + u.videos + u.plans;
    const head = chip => `<div class="pod-row"><h3 class="pod-title mx-h3">Your Coach</h3>${chip || ''}</div>`;

    if (pending.length && !active.length) {
      const inv = pending[0];
      el.innerHTML = `
        <section class="pod mx-pod yc-pod yc-home yc-home--invite" aria-label="Coach invite">
          ${head('<span class="mx-chip mx-chip--green mx-chip--sm">New invite</span>')}
          <div class="mx-row">
            <span class="mx-row-ico"><span class="ui-icon">${icon('users')}</span></span>
            <div class="mx-row-main"><span class="mx-row-title">${esc(inv.coachUsername)} wants to coach you</span>
              <span class="mx-row-sub">They'll see your check-ins, bodyweight and workout counts. You can change this any time.</span></div>
          </div>
          <div class="yc-actions">
            <button type="button" class="mx-cta" data-yc-accept="${esc(inv.coachUsername)}"><span>Accept</span><span class="mx-cta-icon"><span class="ui-icon">${icon('check')}</span></span></button>
            <button type="button" class="mx-outline" data-yc-open="1">Details</button>
          </div>
        </section>`;
      return;
    }

    const coach = active[0];
    const asn = state.assignments.find(a => a.coachUid === coach.coachUid || a.coachUsername === coach.coachUsername) || {};
    const latest = state.notes[0];
    const p = latest ? parseNote(latest.text) : null;
    const m = asn.macroTargets;
    el.innerHTML = `
      <section class="pod mx-pod yc-pod yc-home" aria-label="Your coach">
        ${head(total ? `<span class="mx-chip mx-chip--brass mx-chip--sm">${total} new</span>` : '')}
        <div class="mx-row">
          <span class="mx-row-ico"><span class="ui-icon">${icon('users')}</span></span>
          <div class="mx-row-main"><span class="mx-kicker">Coached by</span><span class="mx-row-title">${esc(active.map(a => a.coachUsername).join(', '))}</span></div>
        </div>
        ${latest ? `
        <button type="button" class="mx-row yc-home-msg" data-yc-open="ycNotes">
          <span class="mx-row-main">
            <span class="mx-row-sub yc-msg-meta">${esc(fmtDate(latest.createdAt))} · Message${KIND_CHIP[p.kind] || ''}${tsMs(latest.createdAt) > since ? NEW_CHIP : ''}</span>
            <span class="yc-note yc-note--clamp">${esc(p.text)}</span>
          </span>
        </button>` : ''}
        ${asn.currentProgram ? `
        <div class="mx-row"><div class="mx-row-main"><span class="mx-lbl">Program</span><span class="mx-row-title">${esc(asn.currentProgram)}</span></div></div>` : ''}
        ${m ? `
        <div class="mx-row"><div class="mx-row-main"><span class="mx-lbl">Macro targets</span><span class="mx-row-title">${m.calories} kcal · ${m.protein}P / ${m.carbs}C / ${m.fat}F</span></div></div>` : ''}
        ${u.videos ? `
        <div class="mx-row"><div class="mx-row-main"><span class="mx-lbl">Videos</span><span class="mx-row-title">${u.videos} new video${u.videos === 1 ? '' : 's'}</span></div></div>` : ''}
        <button type="button" class="mx-outline mx-outline--block yc-home-open" data-yc-open="1">Open Your Coach</button>
      </section>`;
  }

  // Settings › Your Coach, scrolled to a part of it (ycNotes, ycVideos).
  function openYourCoach(anchorId) {
    if (typeof root.showTab === 'function') root.showTab('settingsTab');
    const go = () => {
      const section = doc.getElementById('yourCoachSection');
      if (!section || section.hidden) return;
      const target = (anchorId && doc.getElementById(anchorId)) || section;
      target.scrollIntoView({ block: 'start' });
    };
    // Opening Settings starts a refresh; scroll once it has drawn.
    Promise.resolve(inflight).catch(() => {}).then(() => setTimeout(go, 120));
  }

  // Opening Settings counts as having seen what's in Your Coach. Wait a
  // moment so the "New" markers are visible before Home's count clears.
  let seenTimer = null;
  function markSeenSoon() {
    clearTimeout(seenTimer);
    seenTimer = setTimeout(() => {
      const tab = doc.getElementById('settingsTab');
      const visible = tab && (tab.classList.contains('active') || tab.style.display === 'block' || tab.offsetParent !== null);
      if (!visible || !state.loadedAt) return;
      root.localStorage.setItem(seenKey(), String(Date.now()));
      renderHome();
    }, 4000);
  }

  // Cheap enough to call from Home renders: only fetches when the last load
  // is older than maxAgeMs.
  function refreshYourCoach(maxAgeMs) {
    if (state.loadedAt && Date.now() - state.loadedAt < (maxAgeMs == null ? 60000 : maxAgeMs)) { renderHome(); return Promise.resolve(); }
    return renderYourCoachSection();
  }

  async function renderYourCoachSection() {
    const section = doc.getElementById('yourCoachSection');
    if (!section) return;
    if (!root.localStorage.getItem('token')) { section.hidden = true; section.innerHTML = ''; renderHome(); return; }
    // One fetch at a time; a call made mid-fetch (say, right after Accept)
    // waits for it and then fetches again so it sees the latest state.
    if (inflight) return inflight.then(() => renderYourCoachSection());
    inflight = (async () => {
      const ok = await load();
      // Keep showing what we already have if a refresh fails.
      if (!ok) { if (!loadedOnce) renderFailed(); return; }
      loadedOnce = true;
      render();
      renderHome();
      pushShare();
    })().finally(() => { inflight = null; });
    return inflight;
  }
  let inflight = null;
  let loadedOnce = false;

  // A new pending invite in the bell that Settings doesn't know about yet:
  // re-fetch so Your Coach shows it without a restart.
  function onNotificationsChanged(e) {
    const items = (e && e.detail && e.detail.items) || [];
    const known = new Set(state.invites.map(i => String(i.coachUsername).toLowerCase()));
    const fresh = items.some(n => n && n.type === 'coach_invite' && n.data && n.data.status === 'pending'
      && !known.has(String(n.data.coach || n.actor || '').toLowerCase()));
    if (fresh) renderYourCoachSection();
  }

  // Accept a coach's invite. Shared by the Accept button here and the one in
  // the notifications sheet (src/js/notifications.js).
  async function acceptCoachInvite(coachUsername) {
    await api$('POST', '/api/coach/clients/accept', { coachUsername });
    root.localStorage.setItem(linkKey(), 'true');
    await renderYourCoachSection();
    pushShare({ force: true });
    if (root.Notifications) root.Notifications.refresh().catch(() => {});
  }

  async function onClick(e) {
    const t = e.target.closest('[data-yc-accept],[data-yc-leave],[data-yc-import],[data-yc-macros],[data-yc-share],[data-yc-video],[data-yc-refresh],[data-yc-open],[data-yc-plan],[data-yc-more]');
    if (!t) return;

    if (t.dataset.ycOpen) { openYourCoach(t.dataset.ycOpen === '1' ? '' : t.dataset.ycOpen); return; }

    if (t.dataset.ycMore) { showAllNotes = true; render(); return; }

    if (t.dataset.ycPlan) {
      if (typeof root.showTab === 'function') root.showTab('programTab');
      if (typeof root.showProgramView === 'function') root.showProgramView('plan');
      return;
    }

    if (t.dataset.ycRefresh) {
      t.disabled = true;
      await renderYourCoachSection();
      t.disabled = false;
      return;
    }

    if (t.dataset.ycVideo) {
      const v = state.videos.find(x => x.id === t.dataset.ycVideo);
      if (v && root.CoachVideos) root.CoachVideos.openPlayer(v);
      return;
    }

    if (t.dataset.ycAccept) {
      t.disabled = true;
      try {
        await acceptCoachInvite(t.dataset.ycAccept);
        toast(`You're now coached by ${t.dataset.ycAccept}.`);
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
        if (root.Notifications) root.Notifications.refresh().catch(() => {});
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
      if (imported) {
        core.startProgram(root, imported.id, { userId: user() });
        const started = readJSON(root.localStorage, startedKey(), {});
        started[asn.coachUid] = t.dataset.ycRev || '';
        root.localStorage.setItem(startedKey(), JSON.stringify(started));
        render();
      }
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
    doc.getElementById('yourCoachHomeCard')?.addEventListener('click', onClick);
    hookCheckInSaves();
    renderYourCoachSection();
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'hidden') pushShare();
      else renderYourCoachSection();
    });
    doc.addEventListener('pc:notifications-changed', onNotificationsChanged);
  }

  root.renderYourCoachSection = renderYourCoachSection;
  root.refreshYourCoach = refreshYourCoach;
  root.openYourCoach = openYourCoach;
  root.markYourCoachSeen = markSeenSoon;
  root.acceptCoachInvite = acceptCoachInvite;
  root.pushCoachShare = pushShare;
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : null);
