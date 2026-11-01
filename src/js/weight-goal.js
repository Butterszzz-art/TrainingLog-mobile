/* Weight goal — a target bodyweight the Weight tab's trend colours follow.
 *
 * Stored per user as weightGoal_<user>:
 *   { targetKg, startKg, startDate, dueDate|null, setAt }
 *
 * With a goal set, moving towards it reads green and drifting away reads
 * red (for a maintain goal: staying close is green). Without one, the
 * colours follow the macro goal (Cut / Maintain / Bulk) instead, and only
 * with neither does the Weight tab keep its old colours (down = green).
 *
 * The first time someone opens the Weight tab with no goal, they're asked
 * to set one (weightGoalPrompted_<user> records that we asked).
 */
(function () {
  const wt = () => window.weightTab || {};

  function user() {
    return (typeof currentUser !== 'undefined' && currentUser) || window.currentUser || null;
  }

  function readJSON(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v == null ? fallback : v;
    } catch (_e) {
      return fallback;
    }
  }

  function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function entryKg(e) {
    if (typeof getEntryWeightKg === 'function') return getEntryWeightKg(e);
    const n = Number(e?.weightKg ?? e?.weight);
    return Number.isFinite(n) ? n : null;
  }

  function readLog() {
    const u = user();
    if (!u) return [];
    const log = readJSON(`bodyweightLog_${u}`, []);
    return (Array.isArray(log) ? log : [])
      .filter((e) => e && e.date && entryKg(e) != null)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }

  function latestKg(log = readLog()) {
    return log.length ? entryKg(log[log.length - 1]) : null;
  }

  function unit() {
    const pref = typeof getBodyweightPreference === 'function' ? getBodyweightPreference() : null;
    return pref?.unit === 'lb' ? 'lb' : 'kg';
  }

  function toDisp(kg, decimals = 1) {
    if (kg == null || !Number.isFinite(Number(kg))) return null;
    if (typeof convertWeightValue === 'function') return convertWeightValue(Number(kg), 'kg', unit(), decimals);
    return Number(Number(kg).toFixed(decimals));
  }

  function toKg(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    if (typeof convertWeightValue === 'function') return convertWeightValue(n, unit(), 'kg', 2);
    return n;
  }

  // ── Storage ─────────────────────────────────────────────────────────────
  function getWeightGoal() {
    const u = user();
    if (!u) return null;
    const g = readJSON(`weightGoal_${u}`, null);
    if (!g || !Number.isFinite(Number(g.targetKg)) || !Number.isFinite(Number(g.startKg))) return null;
    return { ...g, targetKg: Number(g.targetKg), startKg: Number(g.startKg) };
  }

  function saveWeightGoal(goal) {
    const u = user();
    if (!u) return;
    localStorage.setItem(`weightGoal_${u}`, JSON.stringify(goal));
    localStorage.setItem(`weightGoalPrompted_${u}`, '1');
  }

  function clearWeightGoal() {
    const u = user();
    if (u) localStorage.removeItem(`weightGoal_${u}`);
  }

  function goalDirection(goal = getWeightGoal()) {
    if (!goal || !wt().weightGoalDirection) return null;
    return wt().weightGoalDirection(goal.startKg, goal.targetKg);
  }

  // Macro goal → weight direction. Recomp holds weight, so it reads as maintain.
  const MACRO_DIRECTION = { cut: 'lose', bulk: 'gain', maintain: 'maintain', recomp: 'maintain' };

  /**
   * The macro goal as a weight direction, or null when none is set. Uses the
   * Macros tab's picked preset (e.g. "cut-moderate"), else the last preset
   * targets were calculated with, else the goal picked in onboarding.
   */
  function macroGoalDirection() {
    const fromKey = (key) => MACRO_DIRECTION[String(key || '').split('-')[0]] || null;
    const picked = fromKey(document.getElementById('macroPreset')?.value);
    if (picked) return picked;
    const lastUsed = fromKey(localStorage.getItem('trainingPreset'));
    if (lastUsed) return lastUsed;
    const u = user();
    const onboarding = u ? readJSON(`macroSettings_${u}`, null) : null;
    return fromKey(onboarding?.macroGoal);
  }

  /**
   * 'good' | 'bad' | 'flat' for a change against the weight goal, falling
   * back to the macro goal; null when neither is set.
   */
  function weightGoalTone(deltaKg, opts) {
    const dir = goalDirection() || macroGoalDirection();
    if (!dir || !wt().weightTrendTone) return null;
    return wt().weightTrendTone(deltaKg, dir, opts);
  }

  // ── Shared summary (Weight tab card + Goals card) ─────────────────────────
  function summary() {
    const goal = getWeightGoal();
    if (!goal) return null;
    const log = readLog();
    const currentKg = latestKg(log) ?? goal.startKg;
    const progress = wt().weightGoalProgress({ startKg: goal.startKg, currentKg, targetKg: goal.targetKg });
    const trend = wt().computeWeightChangeRate ? wt().computeWeightChangeRate(log, 21) : { kgPerWeek: 0, days: 0 };
    const hasTrend = trend.days >= 5;
    const tone = progress.reached ? 'good'
      : hasTrend ? wt().weightTrendTone(trend.kgPerWeek, progress.direction, { holdKg: 0.15 })
      : 'flat';
    const weeks = hasTrend ? wt().weeksToGoal({ currentKg, targetKg: goal.targetKg, kgPerWeek: trend.kgPerWeek }) : null;

    let neededPerWeek = null;
    if (goal.dueDate && !progress.reached && progress.direction !== 'maintain') {
      const daysLeft = (new Date(`${goal.dueDate}T00:00:00`) - new Date()) / 86400000;
      if (daysLeft > 0) neededPerWeek = Math.abs(progress.remainingKg) / (daysLeft / 7);
    }
    return { goal, currentKg, progress, trend, hasTrend, tone, weeks, neededPerWeek };
  }

  function headline(s) {
    const u = unit();
    if (s.progress.reached) return s.progress.direction === 'maintain' ? 'Holding at goal' : 'Goal reached';
    if (s.progress.direction === 'maintain') {
      return `${toDisp(Math.abs(s.progress.remainingKg))} ${u} ${s.progress.remainingKg > 0 ? 'under' : 'over'}`;
    }
    return `${toDisp(Math.abs(s.progress.remainingKg))} ${u} to go`;
  }

  function paceLine(s) {
    const u = unit();
    if (s.progress.reached) {
      return s.progress.direction === 'maintain' ? 'Within half a kilo of your target.' : 'Nice work. Set a new goal when you\'re ready.';
    }
    if (!s.hasTrend) return 'Log a few more weigh-ins to see your pace.';
    if (s.progress.direction === 'maintain') {
      return s.tone === 'good' ? 'Steady. You\'re holding your weight.' : 'Drifting. Your weight is moving away from target.';
    }
    if (s.tone === 'bad') return 'Heading away from your goal.';
    if (s.tone === 'flat' || s.weeks == null) return 'Stalled. No clear movement yet.';
    const w = Math.max(1, Math.round(s.weeks));
    return `About ${w} week${w === 1 ? '' : 's'} at this pace.`;
  }

  function dueLine(s) {
    if (!s.goal.dueDate) return '';
    const d = new Date(`${s.goal.dueDate}T00:00:00`);
    const label = isNaN(d) ? s.goal.dueDate : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    if (s.neededPerWeek == null) return `By ${label}`;
    return `By ${label} · needs ${toDisp(s.neededPerWeek, 2)} ${unit()}/wk`;
  }

  // ── Weight tab card ───────────────────────────────────────────────────────
  function renderWeightGoalCard() {
    const el = document.getElementById('wtGoalCard');
    if (!el) return;
    const s = summary();
    if (!s) {
      el.className = 'wg-card wg-card--empty';
      const macroDir = macroGoalDirection();
      const sub = macroDir
        ? `Colours follow your ${{ lose: 'Cut', gain: 'Bulk', maintain: 'Maintain' }[macroDir]} macro goal for now. Set a target weight to track progress.`
        : 'Set a target so your trend colours mean something.';
      el.innerHTML = `<div class="wg-empty-text"><span class="pod-kicker">Weight goal</span>
          <span class="wg-empty-sub">${sub}</span></div>
        <button type="button" class="mx-outline wg-edit-btn" onclick="openWeightGoalSheet()">Set goal</button>`;
      return;
    }
    const u = unit();
    const dirLabel = { lose: 'Lose', gain: 'Gain', maintain: 'Maintain' }[s.progress.direction];
    const due = dueLine(s);
    el.className = `wg-card pod wg-tone-${s.tone}`;
    el.innerHTML = `
      <div class="wg-top">
        <span class="pod-kicker">Goal · ${dirLabel} to ${toDisp(s.goal.targetKg)} ${u}</span>
        <button type="button" class="wg-link" onclick="openWeightGoalSheet()">Edit</button>
      </div>
      <div class="wg-headline">${esc(headline(s))}</div>
      <div class="wg-track" role="progressbar" aria-label="Progress to weight goal"
           aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(s.progress.percent)}">
        <div class="wg-fill" style="width:${s.progress.direction === 'maintain' ? 100 : s.progress.percent.toFixed(1)}%"></div>
      </div>
      <div class="wg-ends"><span>${toDisp(s.goal.startKg)} ${u}</span><span>${toDisp(s.goal.targetKg)} ${u}</span></div>
      <div class="wg-pace">${esc(paceLine(s))}${due ? ` <span class="wg-due">${esc(due)}</span>` : ''}</div>`;
  }

  // ── Goals (Insights) card ─────────────────────────────────────────────────
  function weightGoalInsightHtml() {
    const s = summary();
    if (!s) {
      return `<div class="goal-card wg-insight-empty">
        <div class="goal-card-top"><span class="goal-card-title">Weight goal</span></div>
        <small class="goal-card-meta">No target weight yet. Your Weight tab trend colours follow it.</small>
        <button type="button" class="mx-outline wg-edit-btn" onclick="openWeightGoalSheet()">Set weight goal</button>
      </div>`;
    }
    const u = unit();
    const status = s.progress.reached ? 'Reached'
      : s.tone === 'good' ? 'On track' : s.tone === 'bad' ? 'Off track' : 'Stalled';
    const color = s.tone === 'good' ? 'var(--primary)' : s.tone === 'bad' ? 'var(--danger)' : 'var(--highlight)';
    const due = s.goal.dueDate ? `Due ${esc(s.goal.dueDate)}` : 'No deadline';
    const pct = s.progress.direction === 'maintain' ? 100 : s.progress.percent;
    return `<div class="goal-card">
      <div class="goal-card-top">
        <span class="goal-card-title">Bodyweight ${toDisp(s.goal.targetKg)} ${u}</span>
        <button class="goal-card-remove" onclick="openWeightGoalSheet()">Edit</button>
      </div>
      <small class="goal-card-meta">${esc(headline(s))} • ${due}</small>
      <div class="goal-card-track"><div class="goal-card-fill" style="width:${pct.toFixed(1)}%;background:${color};"></div></div>
      <small class="goal-card-foot">${toDisp(s.currentKg)} / ${toDisp(s.goal.targetKg)} ${u} • ${status}</small>
    </div>`;
  }

  // ── Set / edit sheet ──────────────────────────────────────────────────────
  let sheetEl = null;
  let lastFocus = null;

  function closeWeightGoalSheet() {
    if (!sheetEl) return;
    sheetEl.remove();
    sheetEl = null;
    document.removeEventListener('keydown', onKey);
    if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
  }

  function onKey(e) {
    if (e.key === 'Escape') closeWeightGoalSheet();
  }

  function refreshAll() {
    if (typeof renderWeights === 'function') {
      try { renderWeights(); } catch (_e) { /* tab not mounted */ }
    } else {
      renderWeightGoalCard();
    }
    if (typeof renderGoalProgressList === 'function') {
      try { renderGoalProgressList(); } catch (_e) { /* insights not mounted */ }
    }
  }

  function openWeightGoalSheet({ firstTime = false } = {}) {
    if (!user()) return;
    closeWeightGoalSheet();
    lastFocus = document.activeElement;
    const u = unit();
    const goal = getWeightGoal();
    const nowKg = latestKg();
    const needsCurrent = nowKg == null;

    sheetEl = document.createElement('div');
    sheetEl.className = 'wg-sheet-backdrop';
    sheetEl.innerHTML = `
      <div class="wg-sheet" role="dialog" aria-modal="true" aria-labelledby="wgSheetTitle">
        ${firstTime ? '<div class="pod-kicker">Before you start</div>' : ''}
        <h3 id="wgSheetTitle" class="wg-sheet-title">${goal ? 'Edit your weight goal' : 'Set your weight goal'}</h3>
        <p class="wg-sheet-copy">Your trend colours follow this goal: green when you're moving towards it, red when you're drifting away.</p>
        <form id="wgSheetForm" novalidate>
          <div class="wg-sheet-grid">
            <label class="wg-field">
              <span class="wt-field-label">Now</span>
              ${needsCurrent
                ? `<span class="wg-input-wrap"><input id="wgCurrent" class="wt-input" type="number" inputmode="decimal" step="0.1" min="20" max="500" placeholder="e.g. 82" required><span class="wg-unit">${u}</span></span>`
                : `<span class="wg-now">${toDisp(nowKg)} <small>${u}</small></span>`}
            </label>
            <label class="wg-field">
              <span class="wt-field-label">Target</span>
              <span class="wg-input-wrap"><input id="wgTarget" class="wt-input" type="number" inputmode="decimal" step="0.1" min="20" max="500"
                placeholder="e.g. 78" value="${goal ? toDisp(goal.targetKg) : ''}" required><span class="wg-unit">${u}</span></span>
            </label>
          </div>
          <label class="wg-field">
            <span class="wt-field-label">By (optional)</span>
            <input id="wgDue" class="wt-input" type="date" value="${esc(goal?.dueDate || '')}">
          </label>
          <div class="wg-preview" id="wgPreview" aria-live="polite"></div>
          <p class="wg-error" id="wgError" role="alert"></p>
          <div class="wg-sheet-actions">
            <button type="submit" class="wg-save">Save goal</button>
            <button type="button" class="mx-outline" id="wgSecondary">${goal ? 'Remove goal' : 'Not now'}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(sheetEl);
    document.addEventListener('keydown', onKey);

    const $ = (id) => sheetEl.querySelector(`#${id}`);
    const startKgNow = () => (needsCurrent ? toKg($('wgCurrent').value) : nowKg);

    function updatePreview() {
      const targetKg = toKg($('wgTarget').value);
      const startKg = startKgNow();
      const box = $('wgPreview');
      if (targetKg == null || startKg == null || !$('wgTarget').value) {
        box.innerHTML = '';
        return;
      }
      const dir = wt().weightGoalDirection(startKg, targetKg);
      const diff = toDisp(Math.abs(targetKg - startKg));
      const text = dir === 'lose' ? `Lose ${diff} ${u}` : dir === 'gain' ? `Gain ${diff} ${u}` : 'Maintain your weight';
      const good = dir === 'lose' ? '↓ down' : dir === 'gain' ? '↑ up' : '≈ steady';
      const bad = dir === 'lose' ? '↑ up' : dir === 'gain' ? '↓ down' : '↕ drifting';
      box.innerHTML = `<strong>${text}</strong>
        <span class="wg-swatch wg-swatch--good">${good}</span>
        <span class="wg-swatch wg-swatch--bad">${bad}</span>`;
    }

    sheetEl.addEventListener('input', updatePreview);
    sheetEl.addEventListener('click', (e) => { if (e.target === sheetEl) closeWeightGoalSheet(); });
    $('wgSecondary').addEventListener('click', () => {
      if (goal) {
        clearWeightGoal();
        if (typeof window.showToast === 'function') window.showToast('Weight goal removed');
        refreshAll();
      } else {
        localStorage.setItem(`weightGoalPrompted_${user()}`, '1');
      }
      closeWeightGoalSheet();
    });
    $('wgSheetForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const targetKg = toKg($('wgTarget').value);
      const startKg = startKgNow();
      const err = $('wgError');
      if (startKg == null || startKg < 20 || startKg > 500) { err.textContent = 'Enter your current weight.'; return; }
      if (targetKg == null || targetKg < 20 || targetKg > 500 || !$('wgTarget').value) { err.textContent = 'Enter a target weight.'; return; }
      const due = $('wgDue').value || null;
      // Keep the original start when only the target or date changes, so
      // progress isn't reset on every edit.
      const keepStart = goal && wt().weightGoalDirection(goal.startKg, targetKg) === wt().weightGoalDirection(goal.startKg, goal.targetKg);
      saveWeightGoal({
        targetKg,
        startKg: keepStart ? goal.startKg : startKg,
        startDate: keepStart ? goal.startDate : new Date().toISOString().slice(0, 10),
        dueDate: due,
        setAt: new Date().toISOString(),
      });
      if (typeof window.showToast === 'function') window.showToast('Weight goal saved');
      closeWeightGoalSheet();
      refreshAll();
    });

    updatePreview();
    setTimeout(() => (needsCurrent ? $('wgCurrent') : $('wgTarget'))?.focus(), 30);
  }

  /** Ask once, the first time the Weight tab opens with no goal. */
  function maybePromptWeightGoal() {
    const u = user();
    if (!u || getWeightGoal()) return;
    if (localStorage.getItem(`weightGoalPrompted_${u}`)) return;
    localStorage.setItem(`weightGoalPrompted_${u}`, '1');
    openWeightGoalSheet({ firstTime: true });
  }

  Object.assign(window, {
    getWeightGoal,
    saveWeightGoal,
    clearWeightGoal,
    weightGoalTone,
    macroGoalDirection,
    renderWeightGoalCard,
    weightGoalInsightHtml,
    openWeightGoalSheet,
    closeWeightGoalSheet,
    maybePromptWeightGoal,
  });
})();
