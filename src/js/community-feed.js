/* =============================================================
   COMMUNITY FEED
   - Activity feed: your recent workouts + your posts, as typed cards
     (workout summary, PR, update) grouped by day
   - Post composer (collapsed to one line until tapped)
   - Group search filter chips + sort link
   - Weekly challenge card (progress ring + Mon–Sun strip)
   - Exercise leaderboard inline rendering
   Styles: css/social-ui.css (sx-*), helpers: src/js/social-ui.js
   ============================================================= */

(function initCommunityFeed() {
  'use strict';

  /* ── Helpers ─────────────────────────────────────────────── */

  function _parse(k) {
    try { return JSON.parse(localStorage.getItem(k)) || null; } catch { return null; }
  }

  function _save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ }
  }

  function _user() {
    return (window.getActiveUsername && window.getActiveUsername()) ||
      localStorage.getItem('fitnessAppUser') ||
      localStorage.getItem('username') || '';
  }

  function _attr(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function _initial(name) {
    return (name || '?').slice(0, 1).toUpperCase();
  }

  function _icon(name) {
    return window.sxIcon ? window.sxIcon(name) : '';
  }

  function _localISO(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function _timeAgo(isoStr) {
    if (!isoStr) return '';
    const diff = Date.now() - new Date(isoStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  function _replay(el) {
    if (!el) return;
    el.classList.remove('sx-anim');
    void el.offsetWidth;
    el.classList.add('sx-anim');
  }

  /* ── Pure helpers (exported for tests) ───────────────────── */

  // Headline numbers for a logged workout.
  function summariseWorkout(w) {
    const log = Array.isArray(w?.log) ? w.log : [];
    let volume = 0, sets = 0, top = null;
    const names = [];
    for (const e of log) {
      const name = e.name || e.exercise || '';
      if (name && !names.includes(name)) names.push(name);
      const wts = e.weightsArray || [];
      const rps = e.repsArray    || [];
      if (rps.length) sets += rps.length;
      else sets += +e.sets || 0;
      for (let i = 0; i < rps.length; i++) {
        const kg = +wts[i] || 0, reps = +rps[i] || 0;
        volume += kg * reps;
        if (kg > 0 && reps > 0 && (!top || kg > top.kg || (kg === top.kg && reps > top.reps))) {
          top = { name, kg, reps };
        }
      }
    }
    return { exercises: names.length, names, sets, volume: Math.round(volume), top };
  }

  // 'Today' / 'Yesterday' / 'This week' / 'Earlier' for a YYYY-MM-DD date.
  function dayBucket(dateStr, now = new Date()) {
    if (!dateStr) return 'Earlier';
    const today = _localISO(now);
    const y = new Date(now); y.setDate(y.getDate() - 1);
    const wk = new Date(now); wk.setDate(wk.getDate() - 6);
    const d = String(dateStr).slice(0, 10);
    if (d >= today) return 'Today';
    if (d === _localISO(y)) return 'Yesterday';
    if (d >= _localISO(wk)) return 'This week';
    return 'Earlier';
  }

  function _fmtKg(v) {
    if (v >= 1e6)  return { n: (v / 1e6).toFixed(1), u: 'M kg' };
    if (v >= 1000) return { n: (v / 1000).toFixed(1), u: 'k kg' };
    return { n: String(v), u: 'kg' };
  }

  // Node (jest): expose the pure helpers and stop before touching the DOM.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { summariseWorkout, dayBucket };
  }
  if (typeof document === 'undefined') return;

  /* ── Activity feed ───────────────────────────────────────── */

  function _buildActivityItems(username) {
    // workouts_{user} alone only covers a rolling ~7 days (older entries
    // move to workoutHistory_{user} — see archiveOldWorkouts.js). Merge
    // both so the "last 15 workouts" feed still has something to show for
    // users who train less than 15 times a week.
    const workouts = (window.getAllWorkoutsForUser && window.getAllWorkoutsForUser(username)) || [];
    const posts    = _parse('communityPosts_v1') || [];
    const items    = [];

    [...workouts].reverse().slice(0, 15).forEach(w => {
      items.push({
        kind:  'session',
        user:  username,
        title: w.title || w.name || 'Workout',
        stats: summariseWorkout(w),
        date:  w.date,
        ts:    w.timestamp || w.date,
      });
    });

    posts.forEach(p => items.push({
      kind: 'post',
      type: p.type || 'update',
      user: p.user || username,
      text: p.text,
      ts:   p.ts,
      date: p.ts ? _localISO(new Date(p.ts)) : '',
    }));

    // Sort newest-first
    items.sort((a, b) => (b.ts || b.date || '') > (a.ts || a.date || '') ? 1 : -1);
    return items.slice(0, 30);
  }

  function _head(item, sub, chip) {
    const user = _attr(item.user);
    return `
      <div class="sx-post-h">
        <span class="sx-av" data-avatar-user="${user}" data-avatar-open>${_initial(item.user)}</span>
        <div style="min-width:0"><b>${user}</b><small>${sub}</small></div>
        ${chip}
      </div>`;
  }

  function _cardHTML(item, i) {
    if (item.kind === 'session') {
      const s = item.stats;
      const vol = _fmtKg(s.volume);
      const when = item.ts && item.ts !== item.date ? _timeAgo(item.ts) : '';
      const sub = `${_attr(item.title)}${when ? ` · ${when}` : ''}`;
      const names = s.names.slice(0, 3).map(_attr).join(', ') + (s.names.length > 3 ? ` +${s.names.length - 3}` : '');
      return `
        <article class="pod sx-post sx-in" style="--i:${i}">
          ${_head(item, sub, '<span class="sx-chip sx-chip--up">Workout</span>')}
          <div class="sx-wk">
            <div><span class="sx-lbl">Volume</span><span class="sx-num">${vol.n}<small>${vol.u}</small></span></div>
            <div><span class="sx-lbl">Exercises</span><span class="sx-num">${s.exercises}</span></div>
            <div><span class="sx-lbl">Sets</span><span class="sx-num">${s.sets}</span></div>
          </div>
          ${s.top ? `<div class="sx-topset"><span>Top set</span><b>${_attr(s.top.name)} ${s.top.kg} kg × ${s.top.reps}</b></div>`
            : names ? `<div class="sx-topset"><span>Exercises</span><b>${names}</b></div>` : ''}
        </article>`;
    }

    const sub = `${item.type === 'pr' ? 'New PR' : item.type === 'workout' ? 'Workout' : 'Update'} · ${_timeAgo(item.ts) || _attr(item.date)}`;
    if (item.type === 'pr') {
      return `
        <article class="pod sx-post sx-post--pr sx-in" style="--i:${i}">
          ${_head(item, sub, '<span class="sx-chip sx-chip--down">PR</span>')}
          <div class="sx-pr-row">
            <span class="sx-medal">${_icon('trophy')}</span>
            <p>${_attr(item.text)}</p>
          </div>
        </article>`;
    }
    const chip = item.type === 'workout' ? '<span class="sx-chip sx-chip--up">Workout</span>' : '<span class="sx-chip">Update</span>';
    return `
      <article class="pod sx-post sx-in" style="--i:${i}">
        ${_head(item, sub, chip)}
        <p>${_attr(item.text)}</p>
      </article>`;
  }

  function renderActivityFeed() {
    const container = document.getElementById('activityFeed');
    if (!container) return;
    const username = _user();

    // Update composer avatar
    const av = document.getElementById('feedComposerAvatar');
    if (av) {
      if (!av.querySelector('img')) av.textContent = _initial(username);
      if (username) av.setAttribute('data-avatar-user', username);
    }
    const seg = document.getElementById('feedTagSeg');
    if (seg && window.sxPlaceThumb) window.sxPlaceThumb(seg);

    if (!username) {
      container.innerHTML = `<div class="pod sx-empty">Log in to see your activity feed.</div>`;
      return;
    }

    const items = _buildActivityItems(username);
    if (!items.length) {
      container.innerHTML = `<div class="pod sx-empty">No activity yet. Log a workout and it shows up here.</div>`;
      return;
    }

    let last = null;
    container.innerHTML = items.map((item, i) => {
      const bucket = dayBucket(item.date);
      const label = bucket !== last ? `<div class="sx-lbl sx-day-lbl">${bucket}</div>` : '';
      last = bucket;
      return label + _cardHTML(item, Math.min(i, 8));
    }).join('');
    _replay(container);
  }

  window.renderActivityFeed = renderActivityFeed;

  /* ── Post composer ───────────────────────────────────────── */

  let _selectedPostTag = 'workout';

  function _setComposerOpen(open) {
    const toggle = document.getElementById('feedComposerToggle');
    const body   = document.getElementById('feedComposerBody');
    if (!toggle || !body) return;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    body.classList.toggle('is-open', open);
    if (open) {
      const seg = document.getElementById('feedTagSeg');
      setTimeout(() => {
        if (seg && window.sxPlaceThumb) window.sxPlaceThumb(seg);
        const ta = document.getElementById('feedPostText');
        if (ta) ta.focus({ preventScroll: true });
      }, 60);
    }
  }

  function _initComposer() {
    const toggle = document.getElementById('feedComposerToggle');
    if (toggle) toggle.addEventListener('click', () => _setComposerOpen(toggle.getAttribute('aria-expanded') !== 'true'));

    document.querySelectorAll('.feed-tag-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.feed-tag-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _selectedPostTag = btn.dataset.tag;
        if (window.sxPlaceThumb) window.sxPlaceThumb(btn.parentElement);
      });
    });
  }

  function submitCommunityPost() {
    const ta       = document.getElementById('feedPostText');
    const username = _user();
    const text     = ta ? ta.value.trim() : '';
    if (!text) return;

    const posts = _parse('communityPosts_v1') || [];
    posts.unshift({ user: username, text, type: _selectedPostTag, ts: new Date().toISOString() });
    // Keep last 200
    _save('communityPosts_v1', posts.slice(0, 200));
    if (ta) ta.value = '';
    _setComposerOpen(false);
    renderActivityFeed();
    if (typeof window.showToast === 'function') window.showToast('Posted');
  }

  window.submitCommunityPost = submitCommunityPost;

  /* ── Group filter chips + sort link ─────────────────────── */

  const SORT_MODES = [
    { value: '',        label: 'Default' },
    { value: 'active',  label: 'Most active' },
    { value: 'members', label: 'Most members' },
    { value: 'alpha',   label: 'A–Z' },
  ];

  function _initGroupFilterPills() {
    // Tag chips → sync to hidden #tagFilter input + call doGroupSearch
    document.querySelectorAll('#commTagPills .comm-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#commTagPills .comm-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tf = document.getElementById('tagFilter');
        if (tf) tf.value = btn.dataset.tag;
        if (window.doGroupSearch) window.doGroupSearch();
      });
    });

    // Sort link cycles through the modes → hidden #sortFilter select
    const sortBtn = document.getElementById('commSortLink');
    if (sortBtn) {
      sortBtn.addEventListener('click', () => {
        const sf = document.getElementById('sortFilter');
        const cur = SORT_MODES.findIndex(m => m.value === (sf ? sf.value : ''));
        const next = SORT_MODES[(cur + 1) % SORT_MODES.length];
        if (sf) sf.value = next.value;
        const lbl = document.getElementById('commSortLabel');
        if (lbl) lbl.textContent = next.label;
        if (window.doGroupSearch) window.doGroupSearch();
      });
    }
  }

  // Also patch clearGroupFilters to reset the chips and sort label
  const _origClear = window.clearGroupFilters;
  window.clearGroupFilters = function () {
    if (_origClear) _origClear();
    document.querySelectorAll('#commTagPills .comm-pill').forEach((b, i) =>
      b.classList.toggle('active', i === 0));
    const lbl = document.getElementById('commSortLabel');
    if (lbl) lbl.textContent = SORT_MODES[0].label;
  };

  /* ── Weekly challenge card ───────────────────────────────── */

  const WEEKLY_GOALS = [
    { label: 'Log 4 workouts',           key: 'workouts',  target: 4 },
    { label: 'Log 3 cardio sessions',    key: 'cardio',    target: 3 },
    { label: 'Hit your protein target',  key: 'protein',   target: 5 },
    { label: 'Log every day this week',  key: 'daily',     target: 7 },
  ];

  function _thisWeekStart() {
    const d = new Date();
    const day = d.getDay(); // 0=Sun
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return _localISO(d);
  }

  function _weeklyProgress(username) {
    const weekStart = _thisWeekStart();
    const today     = _localISO(new Date());
    // Merge workouts_{user} with workoutHistory_{user} for the same reason
    // as _buildActivityItems above — see archiveOldWorkouts.js.
    const workouts  = ((window.getAllWorkoutsForUser && window.getAllWorkoutsForUser(username)) || [])
      .filter(w => w.date >= weekStart && w.date <= today);

    // Pick the "challenge of the week" based on the week of the month
    const wk = Math.ceil(new Date().getDate() / 7);
    const challenge = WEEKLY_GOALS[wk % WEEKLY_GOALS.length];

    let progress = 0;
    let doneDates = new Set();
    if (challenge.key === 'workouts') {
      progress  = workouts.length;
      doneDates = new Set(workouts.map(w => String(w.date).slice(0, 10)));
    } else if (challenge.key === 'cardio') {
      const cardio = (_parse(`cardioLog_${username}`) || _parse('cardioLog') || []).filter(e => e.date >= weekStart);
      progress  = cardio.length;
      doneDates = new Set(cardio.map(e => String(e.date).slice(0, 10)));
    } else if (challenge.key === 'daily') {
      doneDates = new Set(workouts.map(w => String(w.date).slice(0, 10)));
      progress  = doneDates.size;
    } else if (challenge.key === 'protein') {
      const diary = _parse(`foodDiary_${username}`) || [];
      const targets = _parse(`macroTargets_${username}`) || {};
      const pTarget = targets.protein || 0;
      if (pTarget > 0) {
        const hit = diary.filter(e => e.date >= weekStart && (e.protein || 0) >= pTarget);
        progress  = hit.length;
        doneDates = new Set(hit.map(e => String(e.date).slice(0, 10)));
      }
    }

    return { challenge, progress, target: challenge.target, doneDates, weekStart, today };
  }

  function renderWeeklyChallenge() {
    const el = document.getElementById('communityChallenge');
    if (!el) return;
    const username = _user();
    if (!username) { el.innerHTML = ''; return; }

    const { challenge, progress, target, doneDates, weekStart, today } = _weeklyProgress(username);
    const done = progress >= target;
    const ring = window.sxRing
      ? window.sxRing(progress / target, `<span class="sx-num">${Math.min(progress, target)}/${target}</span>`, done)
      : '';

    const start = new Date(weekStart + 'T12:00:00');
    const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((letter, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const iso = _localISO(d);
      const cls = [doneDates.has(iso) ? 'is-done' : '', iso === today ? 'is-today' : ''].join(' ');
      return `<div class="sx-day ${cls}"><i></i>${letter}</div>`;
    }).join('');

    const daysLeft = 7 - Math.round((new Date(today + 'T12:00:00') - start) / 86400000) - 1;
    const sub = done
      ? '<b>Challenge complete.</b> Nice work.'
      : `${target - progress} to go · ${daysLeft <= 0 ? 'last day' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}`;

    el.innerHTML = `
      <div class="pod pod--hero" style="margin-bottom:14px">
        <div class="sx-chal">
          ${ring}
          <div style="min-width:0">
            <div class="sx-lbl">This week's challenge</div>
            <div class="sx-chal-t">${challenge.label}</div>
            <div class="sx-chal-sub">${sub}</div>
          </div>
        </div>
        <div class="sx-days" aria-hidden="true">${days}</div>
      </div>`;
    if (window.sxFillRings) window.sxFillRings(el);
  }

  window.renderWeeklyChallenge = renderWeeklyChallenge;

  /* ── Exercise leaderboard inline ─────────────────────────── */

  function _initExerciseLbInline() {
    const sel = document.getElementById('exerciseLbSelectInline');
    if (!sel || typeof sampleExerciseLeaderboard === 'undefined') return;

    // Populate exercise select
    Object.keys(sampleExerciseLeaderboard).forEach(ex => {
      const opt = document.createElement('option');
      opt.value = ex; opt.textContent = ex;
      sel.appendChild(opt);
    });

    let currentRange = 'weekly';

    function renderInline() {
      const exercise = sel.value;
      const data = sampleExerciseLeaderboard[exercise]?.[currentRange] || [];
      const container = document.getElementById('exerciseLeaderboardInline');
      if (!container) return;

      const username = _user();
      const topVal   = data[0]?.volume || 1;

      container.innerHTML = data.map((d, i) => {
        const rank  = i + 1;
        const pct   = Math.round((d.volume / topVal) * 100);
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `<span class="lb-rank-num">#${rank}</span>`;
        const isMe  = username && d.user.toLowerCase() === username.toLowerCase();
        return `
          <div class="lb-card ${rank <= 3 ? `lb-card--${['gold','silver','bronze'][rank-1]}` : ''} ${isMe ? 'lb-card--me' : ''}">
            <div class="lb-card-left">
              <div class="lb-card-medal">${medal}</div>
              <div class="lb-card-avatar" data-avatar-user="${_attr(d.user)}" data-avatar-open>${_initial(d.user)}</div>
              <div class="lb-card-info">
                <span class="lb-card-name">${d.user}${isMe ? ' <span class="lb-you-tag">You</span>' : ''}</span>
                <div class="lb-card-bar-wrap">
                  <div class="lb-card-bar" style="width:${pct}%"></div>
                </div>
              </div>
            </div>
            <div class="lb-card-value">${(d.volume/1000).toFixed(1)}k</div>
          </div>`;
      }).join('');
    }

    sel.onchange = renderInline;

    document.querySelectorAll('.lb-time-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.lb-time-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentRange = btn.dataset.range;
        renderInline();
      });
    });

    // Open → render on first expand
    const details = document.getElementById('lbExerciseSection');
    if (details) {
      details.addEventListener('toggle', () => {
        if (details.open) renderInline();
      });
    }
  }

  /* ── Init (after DOM ready) ──────────────────────────────── */

  function _init() {
    _initGroupFilterPills();
    _initComposer();
    _initExerciseLbInline();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

})();
