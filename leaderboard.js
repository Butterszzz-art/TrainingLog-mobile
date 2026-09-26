/* =============================================================
   LEADERBOARD
   Rank card (your position, gap to the next person, weekly trend),
   podium for the top three, an "around you" ladder, the full table
   with rank-change arrows, and local personal stats. Styles live in
   css/social-ui.css.
   ============================================================= */

let leaderboardData = [];
let _currentSortKey  = 'workoutsLogged';
let _showAllRows     = false;
let _hasRenderedOnce = false;
let barChart;
let lineChart;

const TABLE_LIMIT       = 10;  // ranks shown (podium included) before "Show all"
const AROUND_MIN_RANK   = 6;   // show the "around you" ladder from this rank down
const RANK_BASELINE_KEY = 'lbRankBaseline_v1';

/* ── Helpers ─────────────────────────────────────────────────── */

function getAuthHeaders() {
  if (typeof localStorage === 'undefined') return {};
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function sum(arr) {
  return Array.isArray(arr) ? arr.reduce((t, n) => t + n, 0) : 0;
}

function _parse(k) {
  try { return JSON.parse(localStorage.getItem(k)) || null; } catch { return null; }
}

function _escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const _ARROW = {
  up:   '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 1.5 9 7.5H1z" fill="currentColor"/></svg>',
  down: '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M5 8.5 1 2.5h8z" fill="currentColor"/></svg>',
};
const _CROWN = '<svg class="sx-crown" viewBox="0 0 24 18" aria-hidden="true"><path d="M2 5l5 4 5-7 5 7 5-4-2 11H4z" fill="currentColor"/></svg>';

// GET /leaderboard returns { success, items: [{ username, totalVolume,
// workoutCount }] }. Map that onto the row shape the cards/charts use.
function normalizeLeaderboardResponse(data) {
  const rows = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
  return rows
    .map(r => ({
      name:           String(r?.username ?? r?.name ?? '').trim(),
      workoutsLogged: Number(r?.workoutCount ?? r?.workoutsLogged) || 0,
      totalVolume:    Math.round(Number(r?.totalVolume) || 0),
    }))
    .filter(r => r.name);
}

function _formatValue(value, sortKey) {
  if (sortKey === 'totalVolume') {
    return value >= 1000 ? `${(value / 1000).toFixed(1)}k kg` : `${value} kg`;
  }
  return String(value);
}

// Number and unit split, for the big Anton numerals.
function _valueParts(value, sortKey) {
  if (sortKey === 'totalVolume') {
    if (value >= 1e6)  return { num: (value / 1e6).toFixed(1), unit: 'M kg' };
    if (value >= 1000) return { num: (value / 1000).toFixed(1), unit: 'k kg' };
    return { num: String(value), unit: 'kg' };
  }
  return { num: String(value), unit: value === 1 ? 'workout' : 'workouts' };
}

function _gapText(gap, sortKey) {
  if (sortKey === 'totalVolume') return _formatValue(gap, sortKey);
  return `${gap} workout${gap === 1 ? '' : 's'}`;
}

function _username() {
  return (window.getActiveUsername && window.getActiveUsername()) ||
    localStorage.getItem('fitnessAppUser') ||
    localStorage.getItem('username') || '';
}

function _isMe(name, username) {
  return !!username && String(name).toLowerCase() === String(username).toLowerCase();
}

function _initials(name) {
  const parts = String(name || '?').trim().split(/[\s._-]+/).filter(Boolean);
  const two = parts.length > 1 ? parts[0][0] + parts[1][0] : String(name || '?').slice(0, 1);
  return two.toUpperCase();
}

function _localISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Monday of the week containing `date`, as a local YYYY-MM-DD.
function _weekStartISO(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return _localISO(d);
}

function _reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/* ── Pure helpers (exported for tests) ──────────────────────── */

// Rank change since the first time the board was seen this week. The
// baseline is { week, ranks: { [sortKey]: { [lowercased name]: rank } } }.
// Returns the per-name delta (positive = climbed) and the baseline to save.
function computeRankDeltas(sorted, sortKey, baseline, weekStart) {
  const current = {};
  sorted.forEach((d, i) => { current[String(d.name).toLowerCase()] = i + 1; });

  const next = baseline && baseline.week === weekStart && baseline.ranks
    ? { week: weekStart, ranks: { ...baseline.ranks } }
    : { week: weekStart, ranks: {} };
  if (!next.ranks[sortKey]) next.ranks[sortKey] = current;

  const base = next.ranks[sortKey];
  const deltas = {};
  Object.keys(current).forEach(name => {
    deltas[name] = base[name] ? base[name] - current[name] : 0;
  });
  return { deltas, baseline: next };
}

// Indices for a window of `span` people above and below `idx`, shifted so
// it stays full near either end of the board.
function aroundYouWindow(total, idx, span = 2) {
  if (idx < 0 || idx >= total) return [];
  const size = Math.min(total, span * 2 + 1);
  let start = Math.max(0, idx - span);
  start = Math.min(start, total - size);
  return Array.from({ length: size }, (_, i) => start + i);
}

function workoutVolume(w) {
  let v = 0;
  for (const e of (w?.log || [])) {
    const wts = e.weightsArray || [];
    const rps = e.repsArray    || [];
    for (let i = 0; i < rps.length; i++) v += (+wts[i] || 0) * (+rps[i] || 0);
  }
  return v;
}

// Workouts (or volume) per Monday-start week, oldest first, ending with
// the current week.
function weeklySeries(workouts, sortKey, weeks = 8, today = new Date()) {
  const DAY = 86400000;
  const utc = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const thisWeek = utc(_weekStartISO(today));
  const out = new Array(weeks).fill(0);
  for (const w of (workouts || [])) {
    const iso = String(w?.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) continue;
    const t = utc(iso);
    const back = t >= thisWeek ? 0 : Math.ceil((thisWeek - t) / (7 * DAY));
    const slot = weeks - 1 - back;
    if (slot < 0) continue;
    out[slot] += sortKey === 'totalVolume' ? workoutVolume(w) : 1;
  }
  return out;
}

/* ── Local personal stats ───────────────────────────────────── */

function _allWorkouts(username) {
  return (typeof window !== 'undefined' && window.getAllWorkoutsForUser && window.getAllWorkoutsForUser(username)) ||
    _parse(`workouts_${username}`) || [];
}

function buildLocalStats(username) {
  if (!username) return null;

  const workouts    = _allWorkouts(username);
  const prBoard     = _parse(`prBoard_${username}`)  || {};
  const weightLog   = _parse(`weightLog_${username}`) || _parse('weightEntries') || [];
  const readiness   = _parse('dailyReadiness_v1') || {};

  // Workout streak (vacation days count as "kept" so they don't break the streak)
  const workedDates   = new Set(workouts.map(w => w.date).filter(Boolean));
  const _isVacation   = typeof window.isVacationDate === 'function' ? window.isVacationDate : () => false;
  const _isSick       = typeof window.isSickDate === 'function' ? window.isSickDate : () => false;
  let streak = 0;
  const today = new Date();
  const check = new Date(today);
  check.setHours(0, 0, 0, 0);
  while (true) {
    const ds = check.toISOString().slice(0, 10);
    if (workedDates.has(ds) || _isVacation(ds) || _isSick(ds)) {
      streak++;
      check.setDate(check.getDate() - 1);
    } else {
      break;
    }
  }

  // Workouts this month
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const monthEnd   = today.toISOString().slice(0, 10);
  const monthWorkouts = workouts.filter(w => w.date >= monthStart && w.date <= monthEnd).length;

  // Total volume (all time)
  let totalVolume = 0;
  for (const w of workouts) totalVolume += workoutVolume(w);

  // Top PR by e1RM
  const topPR = Object.entries(prBoard)
    .map(([ex, pr]) => ({ ex, e1rm: pr.e1rm || 0, unit: pr.unit || 'kg' }))
    .sort((a, b) => b.e1rm - a.e1rm)[0] || null;

  // Average readiness (last 30 days)
  const rangeStart = new Date(today);
  rangeStart.setDate(rangeStart.getDate() - 29);
  const rsStr = rangeStart.toISOString().slice(0, 10);
  const rEntries = Object.entries(readiness)
    .filter(([k, v]) => !v.skipped && k >= rsStr);
  const avgReadiness = rEntries.length
    ? Math.round(rEntries.reduce((s, [, v]) => s + v.score, 0) / rEntries.length)
    : null;

  // Latest weight
  const lastWeight = weightLog.length ? weightLog[weightLog.length - 1] : null;

  return {
    username,
    streak,
    monthWorkouts,
    totalWorkouts: workouts.length,
    totalVolume:   Math.round(totalVolume),
    topPR,
    avgReadiness,
    lastWeight,
  };
}

function renderPersonalStats() {
  const el = document.getElementById('lbPersonalStats');
  if (!el) return;
  const username = _username();
  if (!username) {
    el.innerHTML = `<p class="sx-note">Log in to see your personal stats.</p>`;
    return;
  }
  const s = buildLocalStats(username);
  if (!s) { el.innerHTML = ''; return; }

  const vol = _valueParts(s.totalVolume, 'totalVolume');
  const readCls = s.avgReadiness === null ? '' : s.avgReadiness >= 67 ? 'is-good' : s.avgReadiness >= 40 ? 'is-warn' : 'is-low';
  const lastW = s.lastWeight ? (s.lastWeight.weight || s.lastWeight.kg) : null;
  const plural = (n, one) => `${one}${n === 1 ? '' : 's'}`;

  el.innerHTML = `
    <div class="sx-tiles sx-anim">
      <div class="sx-tile sx-in" style="--i:0"><span class="sx-lbl">This month</span><span class="sx-num">${s.monthWorkouts}<small>${plural(s.monthWorkouts, 'workout')}</small></span></div>
      <div class="sx-tile sx-in" style="--i:1"><span class="sx-lbl">Streak</span><span class="sx-num">${s.streak}<small>${plural(s.streak, 'day')}</small></span></div>
      <div class="sx-tile sx-in" style="--i:2"><span class="sx-lbl">All-time</span><span class="sx-num">${s.totalWorkouts}<small>${plural(s.totalWorkouts, 'workout')}</small></span></div>
      <div class="sx-tile sx-in" style="--i:3"><span class="sx-lbl">Total volume</span><span class="sx-num">${vol.num}<small>${vol.unit}</small></span></div>
      <div class="sx-tile sx-in" style="--i:4"><span class="sx-lbl">Avg readiness</span><span class="sx-num ${readCls}">${s.avgReadiness === null ? '—' : `${s.avgReadiness}<small>%</small>`}</span></div>
      <div class="sx-tile sx-in" style="--i:5"><span class="sx-lbl">Last weight</span><span class="sx-num">${lastW ? `${_escapeHtml(lastW)}<small>kg</small>` : '—'}</span></div>
    </div>
    ${s.topPR ? `
    <div class="pod sx-kv sx-kv--pr">
      <div><div class="sx-lbl">Top PR · e1RM</div><div class="sx-kv-name">${_escapeHtml(s.topPR.ex)}</div></div>
      <div class="sx-num">${_escapeHtml(s.topPR.e1rm)}<small>${_escapeHtml(String(s.topPR.unit).toUpperCase())}</small></div>
    </div>` : ''}
  `;
}

/* ── Rows, podium, ladder ────────────────────────────────────── */

function _deltaHTML(delta) {
  if (!delta) return '';
  const dir = delta > 0 ? 'up' : 'down';
  return `<span class="sx-delta ${dir}" aria-label="${delta > 0 ? 'Up' : 'Down'} ${Math.abs(delta)} this week">${_ARROW[dir]}${Math.abs(delta)}</span>`;
}

function _rowHTML(d, rank, sortKey, topValue, username, delta, extraClass = '') {
  const value = d[sortKey] || 0;
  const pct   = Math.max(2, Math.round((value / (topValue || 1)) * 100));
  const me    = _isMe(d.name, username);
  const name  = _escapeHtml(d.name);
  const parts = _valueParts(value, sortKey);
  return `
    <div class="sx-row ${me ? 'is-me' : ''} ${extraClass}" data-name="${name}" role="button" tabindex="0">
      <span class="sx-row-rk">${rank}</span>
      <span class="sx-av" data-avatar-user="${name}">${_escapeHtml(_initials(d.name))}</span>
      <div style="min-width:0">
        <div class="sx-row-nm"><span>${name}</span>${me ? '<span class="sx-you">You</span>' : ''}</div>
        <div class="sx-meter"><i style="width:${pct}%"></i></div>
      </div>
      <div class="sx-row-val"><span class="sx-num">${parts.num}</span>${sortKey === 'totalVolume' ? `<span class="sx-unit">${parts.unit}</span>` : ''}${_deltaHTML(delta)}</div>
    </div>`;
}

function _renderPodium(sorted, sortKey, username) {
  const el = document.getElementById('lbPodium');
  if (!el) return;
  const top = sorted.slice(0, 3);
  if (!top.length) { el.innerHTML = ''; return; }

  // Visual order 2 · 1 · 3; blocks rise 3 → 2 → 1.
  const slots = top.length === 1 ? [[top[0], 1, 0]]
    : top.length === 2 ? [[top[1], 2, 0], [top[0], 1, 120]]
    : [[top[1], 2, 120], [top[0], 1, 240], [top[2], 3, 0]];

  el.classList.toggle('is-1', top.length === 1);
  el.classList.toggle('is-2', top.length === 2);
  el.innerHTML = slots.map(([d, r, delay]) => {
    const name = _escapeHtml(d.name);
    const me = _isMe(d.name, username);
    const parts = _valueParts(d[sortKey] || 0, sortKey);
    return `
      <div class="sx-pd r${r} ${me ? 'is-me' : ''}" style="--d:${delay}ms" data-name="${name}" role="button" tabindex="0" aria-label="${name}, rank ${r}">
        <span class="sx-av" data-avatar-user="${name}">${_escapeHtml(_initials(d.name))}</span>${r === 1 ? _CROWN : ''}
        <span class="sx-pd-name">${name}${me ? ' · You' : ''}</span>
        <span class="sx-num sx-pd-val">${parts.num}${sortKey === 'totalVolume' ? `<span class="sx-unit">${parts.unit}</span>` : ''}</span>
        <div class="sx-pd-block">${r}</div>
      </div>`;
  }).join('');
}

function _renderAroundYou(sorted, sortKey, username, deltas) {
  const el = document.getElementById('lbAroundYou');
  if (!el) return;
  const idx = sorted.findIndex(d => _isMe(d.name, username));
  if (idx < 0 || idx + 1 < AROUND_MIN_RANK) { el.style.display = 'none'; el.innerHTML = ''; return; }

  const myVal = sorted[idx][sortKey] || 0;
  const rows = aroundYouWindow(sorted.length, idx, 2).map((i, n) => {
    const d = sorted[i];
    const value = d[sortKey] || 0;
    const isMe = i === idx;
    const diff = Math.abs(value - myVal);
    const gap = isMe ? `${_formatValue(value, sortKey)}${sortKey === 'workoutsLogged' ? ` ${_valueParts(value, sortKey).unit}` : ''}`
      : diff === 0 ? 'Level with you'
      : i < idx ? `${_gapText(diff, sortKey)} ahead${i === idx - 1 ? ' · next up' : ''}`
      : `${_gapText(diff, sortKey)} behind you`;
    const parts = _valueParts(value, sortKey);
    const name = _escapeHtml(d.name);
    return `
      <div class="sx-row sx-in ${isMe ? 'is-me' : ''} ${i === idx - 1 ? 'is-target' : ''}" style="--i:${n}" data-name="${name}" role="button" tabindex="0">
        <span class="sx-row-rk">${i + 1}</span>
        <div style="min-width:0">
          <div class="sx-row-nm"><span>${name}</span>${isMe ? '<span class="sx-you">You</span>' : ''}</div>
          <span class="sx-gap">${gap}</span>
        </div>
        <div class="sx-row-val"><span class="sx-num">${parts.num}</span>${_deltaHTML(deltas[String(d.name).toLowerCase()])}</div>
      </div>`;
  }).join('');

  el.style.display = 'block';
  el.innerHTML = `
    <div class="sx-sec"><span class="sx-lbl">Around you</span></div>
    <div class="sx-ladder">${rows}</div>`;
}

/* ── Main render ─────────────────────────────────────────────── */

function _placeSegThumb(seg) {
  if (typeof window !== 'undefined' && window.sxPlaceThumb) window.sxPlaceThumb(seg);
}

function _replay(el) {
  if (!el) return;
  el.classList.remove('sx-anim');
  void el.offsetWidth;
  el.classList.add('sx-anim');
}

function renderLeaderboard(sortKey = _currentSortKey) {
  const sortChanged = _hasRenderedOnce && sortKey !== _currentSortKey;
  _currentSortKey = sortKey;

  // Sync hidden select for JS compatibility
  const sel = document.getElementById('leaderSortStatic');
  if (sel) sel.value = sortKey;

  document.querySelectorAll('.lb-sort-pill').forEach(btn => {
    const on = btn.dataset.sort === sortKey;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  _placeSegThumb(document.getElementById('lbSortPills'));

  const container = document.getElementById('leaderboardContainer');
  if (!container) return;
  const tableHead = document.getElementById('lbTableHead');
  const username  = _username();

  if (!leaderboardData.length) {
    container.innerHTML = '';
    ['lbPodium', 'lbAroundYou'].forEach(id => { const n = document.getElementById(id); if (n) n.innerHTML = ''; });
    if (tableHead) tableHead.style.display = 'none';
    renderYourRankBanner([], sortKey, username);
    _updatePin(null);
    return;
  }

  const sorted   = [...leaderboardData].sort((a, b) => (b[sortKey] || 0) - (a[sortKey] || 0));
  const topValue = sorted[0]?.[sortKey] || 1;

  // Rank deltas against this week's baseline
  const { deltas, baseline } = computeRankDeltas(sorted, sortKey, _parse(RANK_BASELINE_KEY), _weekStartISO());
  try { localStorage.setItem(RANK_BASELINE_KEY, JSON.stringify(baseline)); } catch { /* quota */ }

  // FLIP: remember where each row sat before re-rendering
  const before = new Map();
  if (sortChanged) container.querySelectorAll('.sx-row').forEach(r => before.set(r.dataset.name, r.getBoundingClientRect().top));

  // Table: everyone below the podium
  const rest  = sorted.slice(3);
  const shown = _showAllRows ? rest : rest.slice(0, Math.max(0, TABLE_LIMIT - 3));
  container.innerHTML = shown.map((d, i) =>
    _rowHTML(d, i + 4, sortKey, topValue, username, deltas[String(d.name).toLowerCase()], sortChanged ? '' : 'sx-in')
  ).join('') + (rest.length > shown.length
    ? `<button type="button" class="sx-more" id="lbShowAll">Show all ${sorted.length}</button>` : '');
  container.querySelectorAll('.sx-row').forEach((r, i) => r.style.setProperty('--i', i));

  if (tableHead) {
    tableHead.style.display = rest.length ? '' : 'none';
    const count = document.getElementById('lbCount');
    if (count) count.textContent = `${sorted.length} ranked`;
  }

  const showAll = document.getElementById('lbShowAll');
  if (showAll) showAll.addEventListener('click', () => { _showAllRows = true; renderLeaderboard(_currentSortKey); });

  _renderPodium(sorted, sortKey, username);
  _renderAroundYou(sorted, sortKey, username, deltas);
  renderYourRankBanner(sorted, sortKey, username, deltas);

  // Entry animation on first paint; on a sort change rows glide (FLIP)
  // to their new places and the podium rises again.
  if (!sortChanged) {
    _replay(document.getElementById('lbPage'));
  } else {
    _replay(document.getElementById('lbPodium'));
    if (before.size && !_reducedMotion()) {
      container.querySelectorAll('.sx-row').forEach(r => {
        const was = before.get(r.dataset.name);
        if (was === undefined) {
          r.animate([{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: 'ease-out' });
          return;
        }
        const dy = was - r.getBoundingClientRect().top;
        if (dy) r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 500, easing: 'cubic-bezier(.25,.46,.45,.94)' });
      });
    }
  }

  _wireRowClicks();
  _hasRenderedOnce = true;
  const meIdx = sorted.findIndex(d => _isMe(d.name, username));
  _updatePin(meIdx >= 0 ? { d: sorted[meIdx], rank: meIdx + 1, sortKey, topValue, username, delta: deltas[String(sorted[meIdx].name).toLowerCase()] } : null);
  renderCharts(sorted);
}

function _wireRowClicks() {
  const tab = document.getElementById('leaderboardTab');
  if (!tab || tab.dataset.sxWired) return;
  tab.dataset.sxWired = '1';
  const open = el => { if (el && window.showUserStats) window.showUserStats(el.dataset.name); };
  tab.addEventListener('click', e => {
    if (e.target.closest('[data-avatar-open]')) return;
    open(e.target.closest('.sx-row[data-name], .sx-pd[data-name]'));
  });
  tab.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('.sx-row[data-name], .sx-pd[data-name]');
    if (el) { e.preventDefault(); open(el); }
  });
}

/* ── Your rank card ──────────────────────────────────────────── */

function _sparkSVG(series) {
  const W = 300, H = 44, pad = 4;
  const max = Math.max(...series, 1) * 1.15;
  const pts = series.map((v, i) => [
    pad + i * (W - pad * 2) / Math.max(1, series.length - 1),
    H - pad - (v / max) * (H - pad * 2),
  ]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return `
    <svg class="sx-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Your last ${series.length} weeks">
      <defs><linearGradient id="sxSparkFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d9d73" stop-opacity=".35"/><stop offset="1" stop-color="#3d9d73" stop-opacity="0"/></linearGradient></defs>
      <path d="${line} L${W - pad} ${H} L${pad} ${H} Z" fill="url(#sxSparkFill)"/>
      <path d="${line}" fill="none" stroke="#6fae8b" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
      <circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.5" fill="#8ec2a4" stroke="#050807" stroke-width="2" vector-effect="non-scaling-stroke"/>
    </svg>
    <div class="sx-spark-cap"><span>${series.length} weeks ago</span><span>This week</span></div>`;
}

function renderYourRankBanner(sorted, sortKey, username, deltas = {}) {
  const el = document.getElementById('lbYourRank');
  if (!el) return;
  if (!username) { el.style.display = 'none'; return; }

  const idx = sorted.findIndex(d => _isMe(d.name, username));
  const series = weeklySeries(_allWorkouts(username), sortKey);
  const spark = series.some(Boolean) ? _sparkSVG(series) : '';

  el.style.display = 'block';
  if (idx === -1) {
    el.innerHTML = `
      <div class="pod pod--hero sx-rank">
        <div class="sx-num sx-rank-big">—</div>
        <div class="sx-rank-next"><b>You're not on the board yet.</b><br>Log a workout and you'll show up here.</div>
        ${spark}
      </div>`;
    return;
  }

  const rank  = idx + 1;
  const d     = sorted[idx];
  const value = d[sortKey] || 0;
  const above = rank > 1 ? sorted[rank - 2] : null;
  const below = sorted[rank] || null;
  const gap   = above ? (above[sortKey] || 0) - value : 0;
  const delta = deltas[String(d.name).toLowerCase()] || 0;
  const pct   = above ? Math.max(4, Math.min(100, Math.round((value / ((above[sortKey] || 0) || 1)) * 100))) : 100;

  let next;
  if (!above) {
    const lead = below ? value - (below[sortKey] || 0) : 0;
    next = `<b>You're top of the board.</b>${below ? `<br>${_gapText(lead, sortKey)} clear of ${_escapeHtml(below.name)}.` : ''}`;
  } else if (gap === 0) {
    next = `<b>Level with ${_escapeHtml(above.name)}</b> for #${rank - 1}.<br>One more ${sortKey === 'totalVolume' ? 'session' : 'workout'} moves you up.`;
  } else {
    next = `<b>${_gapText(gap, sortKey)}</b> behind ${_escapeHtml(above.name)} for #${rank - 1}.`;
  }

  const chip = delta > 0 ? `<span class="sx-chip sx-chip--up">${_ARROW.up}${delta} this week</span>`
    : delta < 0 ? `<span class="sx-chip sx-chip--down">${_ARROW.down}${-delta} this week</span>`
    : `<span class="sx-chip">Holding</span>`;

  el.innerHTML = `
    <div class="pod pod--hero sx-rank">
      <div class="sx-num sx-rank-big">#${rank}<small>/ ${sorted.length}</small></div>
      <div class="sx-rank-next">${next}</div>
      <div class="sx-rank-foot">
        <div class="sx-meter" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progress to the next rank"><i></i></div>
        ${chip}
      </div>
      ${spark}
    </div>`;
  const bar = el.querySelector('.sx-meter > i');
  if (bar) requestAnimationFrame(() => requestAnimationFrame(() => { bar.style.width = pct + '%'; }));
}

/* ── Pinned "you" row ────────────────────────────────────────── */

let _pinObserver = null;
let _tabObserver = null;
const _pinVisible = new Set();

function _syncPin() {
  const pin = document.getElementById('lbPinnedMe');
  if (!pin) return;
  const tab = document.getElementById('leaderboardTab');
  const active = !!tab && tab.classList.contains('active');
  pin.hidden = !pin.dataset.ready || !active || _pinVisible.size > 0;
}

function _updatePin(ctx) {
  if (typeof document === 'undefined') return;
  let pin = document.getElementById('lbPinnedMe');
  if (_pinObserver) { _pinObserver.disconnect(); _pinVisible.clear(); }
  if (!ctx || typeof IntersectionObserver === 'undefined') {
    if (pin) { pin.dataset.ready = ''; pin.hidden = true; }
    return;
  }

  if (!pin) {
    pin = document.createElement('div');
    pin.id = 'lbPinnedMe';
    pin.hidden = true;
    document.body.appendChild(pin);
    pin.addEventListener('click', () => {
      const target = document.querySelector('#leaderboardTab .sx-row.is-me, #leaderboardTab .sx-pd.is-me') || document.getElementById('lbYourRank');
      if (target) target.scrollIntoView({ behavior: _reducedMotion() ? 'auto' : 'smooth', block: 'center' });
    });
  }
  const tmp = document.createElement('div');
  tmp.innerHTML = _rowHTML(ctx.d, ctx.rank, ctx.sortKey, ctx.topValue, ctx.username, ctx.delta).trim();
  const row = tmp.firstElementChild;
  pin.className = `${row.className} sx-pin`;
  pin.setAttribute('role', 'button');
  pin.setAttribute('aria-label', 'Jump to your position');
  pin.innerHTML = row.innerHTML;
  pin.dataset.ready = '1';

  const tab = document.getElementById('leaderboardTab');
  const targets = [
    document.getElementById('lbYourRank'),
    ...document.querySelectorAll('#leaderboardTab .sx-row.is-me, #leaderboardTab .sx-pd.is-me'),
  ].filter(Boolean);
  _pinObserver = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) _pinVisible.add(e.target); else _pinVisible.delete(e.target); });
    _syncPin();
  }, { rootMargin: '0px 0px -90px 0px' });
  targets.forEach(t => _pinObserver.observe(t));

  // Hide straight away when the user leaves the tab
  if (tab && !_tabObserver && typeof MutationObserver !== 'undefined') {
    _tabObserver = new MutationObserver(_syncPin);
    _tabObserver.observe(tab, { attributes: true, attributeFilter: ['class'] });
  }
}

/* ── Charts ─────────────────────────────────────────────────── */

function renderCharts(data) {
  if (typeof Chart === 'undefined') return;
  const barCtx  = document.getElementById('lbBarChart');
  const lineCtx = document.getElementById('lbLineChart');
  if (!barCtx || !lineCtx) return;

  const labels  = data.map(d => d.name);
  const barData = data.map(d => d.totalVolume || 0);

  const chartDefaults = {
    color: '#b2dfdb',
    grid:  'rgba(255,255,255,0.06)',
    tick:  '#7a8f7d',
  };

  if (barChart) barChart.destroy();
  barChart = new Chart(barCtx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Total Volume (kg)',
        data: barData,
        backgroundColor: 'rgba(95,168,126,0.75)',
        borderColor:     '#5fa87e',
        borderWidth: 1,
        borderRadius: 4,
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
      scales: {
        x: { grid: { color: chartDefaults.grid }, ticks: { color: chartDefaults.tick } },
        y: { grid: { color: chartDefaults.grid }, ticks: { color: chartDefaults.tick } },
      }
    }
  });

  // The backend doesn't send per-week progress yet — hide the line chart
  // rather than drawing an empty one.
  const hasProgress = data.some(d => Array.isArray(d.progress) && d.progress.length);
  lineCtx.style.display = hasProgress ? '' : 'none';
  if (lineChart) { lineChart.destroy(); lineChart = null; }
  if (!hasProgress) return;

  const maxLen   = Math.max(...data.map(d => (d.progress || []).length), 1);
  const lineLbls = Array.from({ length: maxLen }, (_, i) => `W${i + 1}`);
  const palette  = ['#5fa87e','#81c784','#a5d6a7','#4db6ac','#80cbc4','#ffb74d','#ff8a65'];
  const lineSets = data.map((d, i) => ({
    label:       d.name,
    data:        d.progress || [],
    tension:     0.4,
    fill:        false,
    borderColor: palette[i % palette.length],
    pointBackgroundColor: palette[i % palette.length],
    pointRadius: 3,
  }));

  lineChart = new Chart(lineCtx, {
    type: 'line',
    data: { labels: lineLbls, datasets: lineSets },
    options: {
      responsive: true,
      plugins: { tooltip: { enabled: true }, legend: { labels: { color: chartDefaults.color } } },
      scales: {
        x: { grid: { color: chartDefaults.grid }, ticks: { color: chartDefaults.tick } },
        y: { grid: { color: chartDefaults.grid }, ticks: { color: chartDefaults.tick } },
      }
    }
  });
}

/* ── Fetch ───────────────────────────────────────────────────── */

async function fetchLeaderboard() {
  const spinner = document.getElementById('leaderboardLoading');
  const empty   = document.getElementById('leaderboardEmpty');
  if (spinner) spinner.style.display = 'flex';
  if (empty)   empty.style.display   = 'none';
  try {
    const res = await fetch(`${window.SERVER_URL}/leaderboard`, { headers: getAuthHeaders(), signal: AbortSignal.timeout(5000) });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error?.message || data?.error || `Server returned ${res.status}`);
    leaderboardData = normalizeLeaderboardResponse(data);
  } catch (e) {
    console.warn('fetch leaderboard failed', e);
    leaderboardData = [];
  }
  if (spinner) spinner.style.display = 'none';
  if (!leaderboardData.length && empty) empty.style.display = 'block';
}

/* ── Init ───────────────────────────────────────────────────── */

let _lbWired = false;

function initLeaderboard() {
  // Always render personal stats first (local, instant)
  renderPersonalStats();
  _hasRenderedOnce = false;
  _showAllRows = false;

  if (!_lbWired) {
    _lbWired = true;
    // Wire sort pills
    document.querySelectorAll('.lb-sort-pill').forEach(btn => {
      btn.addEventListener('click', () => renderLeaderboard(btn.dataset.sort));
    });

    // Wire hidden select for compatibility
    const sel = document.getElementById('leaderSortStatic');
    if (sel) sel.onchange = () => renderLeaderboard(sel.value);
  }
  _placeSegThumb(document.getElementById('lbSortPills'));

  // Fetch + render board
  fetchLeaderboard().then(() => renderLeaderboard(_currentSortKey));
}

if (typeof window !== 'undefined') {
  window.initLeaderboard = initLeaderboard;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeLeaderboardResponse, renderLeaderboard, fetchLeaderboard,
    computeRankDeltas, aroundYouWindow, weeklySeries, workoutVolume,
  };
}
