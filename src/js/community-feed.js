/* =============================================================
   COMMUNITY FEED  (improvements ⑥ ⑦ ⑨ ⑩ ⑪)
   ⑥  Activity feed — recent workouts from localStorage
   ⑦  Filter pills for group search
   ⑨  Exercise leaderboard inline rendering
   ⑩  Weekly challenge card
   ⑪  Post composer + local posts feed
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

  function _initial(name) {
    return (name || '?').slice(0, 1).toUpperCase();
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

  /* ── ⑥ Activity feed ─────────────────────────────────────── */

  function _buildActivityItems(username) {
    const workouts = _parse(`workouts_${username}`) || [];
    const posts    = _parse('communityPosts_v1') || [];
    const items    = [];

    // Convert last 15 workouts to feed items
    [...workouts].reverse().slice(0, 15).forEach(w => {
      const exercises = (w.log || []).map(e => e.name || e.exercise || '').filter(Boolean);
      const topEx     = exercises.slice(0, 2).join(', ') || 'a workout';
      const setCount  = (w.log || []).reduce((s, e) => s + (e.repsArray?.length || e.sets || 0), 0);
      items.push({
        type:    'workout',
        user:    username,
        text:    `logged ${topEx}${setCount ? ` — ${setCount} sets` : ''}`,
        date:    w.date,
        ts:      w.timestamp || w.date,
        emoji:   '💪',
      });
    });

    // Merge community posts
    posts.forEach(p => items.push({
      type:  p.type || 'update',
      user:  p.user || username,
      text:  p.text,
      ts:    p.ts,
      date:  p.ts ? p.ts.slice(0, 10) : '',
      emoji: p.type === 'pr' ? '🏆' : p.type === 'update' ? '📝' : '💪',
    }));

    // Sort newest-first
    items.sort((a, b) => (b.ts || b.date || '') > (a.ts || a.date || '') ? 1 : -1);
    return items.slice(0, 30);
  }

  function renderActivityFeed() {
    const container = document.getElementById('activityFeed');
    if (!container) return;
    const username = _user();

    // Update composer avatar
    const av = document.getElementById('feedComposerAvatar');
    if (av) av.textContent = _initial(username);

    if (!username) {
      container.innerHTML = `<p class="feed-empty">Log in to see your activity feed.</p>`;
      return;
    }

    const items = _buildActivityItems(username);
    if (!items.length) {
      container.innerHTML = `<p class="feed-empty">No activity yet — log a workout to get started!</p>`;
      return;
    }

    container.innerHTML = items.map(item => `
      <div class="feed-card">
        <div class="feed-card-avatar">${_initial(item.user)}</div>
        <div class="feed-card-body">
          <div class="feed-card-header">
            <strong class="feed-card-name">${item.user}</strong>
            <span class="feed-card-type ${item.type}">${item.emoji}</span>
            <span class="feed-card-time">${item.date || ''}</span>
          </div>
          <p class="feed-card-text">${item.text}</p>
        </div>
      </div>`).join('');
  }

  window.renderActivityFeed = renderActivityFeed;

  /* ── ⑪ Post composer ─────────────────────────────────────── */

  let _selectedPostTag = 'workout';

  // Wire tag buttons
  document.querySelectorAll('.feed-tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.feed-tag-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _selectedPostTag = btn.dataset.tag;
    });
  });

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
    renderActivityFeed();
  }

  window.submitCommunityPost = submitCommunityPost;

  /* ── ⑦ Filter pills for group search ────────────────────── */

  function _initGroupFilterPills() {
    // Tag pills → sync to hidden #tagFilter input + call doGroupSearch
    document.querySelectorAll('#commTagPills .comm-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#commTagPills .comm-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tf = document.getElementById('tagFilter');
        if (tf) tf.value = btn.dataset.tag;
        if (window.doGroupSearch) window.doGroupSearch();
      });
    });

    // Sort pills → sync to hidden #sortFilter select + call doGroupSearch
    document.querySelectorAll('#commSortPills .comm-sort-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#commSortPills .comm-sort-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const sf = document.getElementById('sortFilter');
        if (sf) sf.value = btn.dataset.sort;
        if (window.doGroupSearch) window.doGroupSearch();
      });
    });
  }

  // Also patch clearGroupFilters to reset pills
  const _origClear = window.clearGroupFilters;
  window.clearGroupFilters = function () {
    if (_origClear) _origClear();
    document.querySelectorAll('#commTagPills .comm-pill').forEach((b, i) =>
      b.classList.toggle('active', i === 0));
    document.querySelectorAll('#commSortPills .comm-sort-pill').forEach((b, i) =>
      b.classList.toggle('active', i === 0));
  };

  /* ── ⑩ Weekly challenge card ─────────────────────────────── */

  const WEEKLY_GOALS = [
    { label: 'Log 4 workouts',           key: 'workouts',  target: 4 },
    { label: 'Log 3 cardio sessions',    key: 'cardio',    target: 3 },
    { label: 'Hit your protein target',  key: 'protein',   target: 5 },
    { label: 'Log every day this week',  key: 'daily',     target: 7 },
  ];

  function _thisWeekStart() {
    const d = new Date();
    const day = d.getDay(); // 0=Sun
    const diff = (day === 0 ? -6 : 1 - day);
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }

  function _weeklyProgress(username) {
    const weekStart = _thisWeekStart();
    const today     = new Date().toISOString().slice(0, 10);
    const workouts  = (_parse(`workouts_${username}`) || [])
      .filter(w => w.date >= weekStart && w.date <= today);

    // Pick the "challenge of the week" based on ISO week number
    const wk = Math.ceil(new Date().getDate() / 7);
    const challenge = WEEKLY_GOALS[wk % WEEKLY_GOALS.length];

    let progress = 0;
    if (challenge.key === 'workouts') {
      progress = workouts.length;
    } else if (challenge.key === 'cardio') {
      const cardio = _parse(`cardioLog_${username}`) || _parse('cardioLog') || [];
      progress = cardio.filter(e => e.date >= weekStart).length;
    } else if (challenge.key === 'daily') {
      const workedDates = new Set(workouts.map(w => w.date));
      let d = new Date(weekStart);
      const end = new Date(today);
      while (d <= end) {
        if (workedDates.has(d.toISOString().slice(0, 10))) progress++;
        d.setDate(d.getDate() + 1);
      }
    } else if (challenge.key === 'protein') {
      const diary = _parse(`foodDiary_${username}`) || [];
      const targets = _parse(`macroTargets_${username}`) || {};
      const pTarget = targets.protein || 0;
      if (pTarget > 0) {
        progress = diary.filter(e => e.date >= weekStart && (e.protein || 0) >= pTarget).length;
      }
    }

    return { challenge, progress, target: challenge.target };
  }

  function renderWeeklyChallenge() {
    const el = document.getElementById('communityChallenge');
    if (!el) return;
    const username = _user();
    if (!username) { el.innerHTML = ''; return; }

    const { challenge, progress, target } = _weeklyProgress(username);
    const pct     = Math.min(100, Math.round((progress / target) * 100));
    const done    = progress >= target;

    el.innerHTML = `
      <div class="comm-challenge-card ${done ? 'done' : ''}">
        <div class="comm-challenge-header">
          <span class="comm-challenge-icon">${done ? '✅' : '🎯'}</span>
          <div class="comm-challenge-info">
            <div class="comm-challenge-title">This week's challenge</div>
            <div class="comm-challenge-label">${challenge.label}</div>
          </div>
          <div class="comm-challenge-count">${progress}/${target}</div>
        </div>
        <div class="comm-challenge-bar-wrap">
          <div class="comm-challenge-bar" style="width:${pct}%"></div>
        </div>
        ${done ? '<div class="comm-challenge-badge">🏅 Challenge complete!</div>' : ''}
      </div>`;
  }

  window.renderWeeklyChallenge = renderWeeklyChallenge;

  /* ── ⑨ Exercise leaderboard inline ─────────────────────── */

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
              <div class="lb-card-avatar">${_initial(d.user)}</div>
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
    _initExerciseLbInline();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

})();
