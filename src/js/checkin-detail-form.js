/*
 * Check-in tab: the detailed sections (Training, Nutrition, Lifestyle &
 * health) under the scores. Option lists and cleaning live in
 * src/js/checkin-detail.js; index.html calls
 *   renderCheckInDetailForm(userId, { date, archetypeKeys })  from renderCheckInTab
 *   readCheckInDetailForm()                                    from saveWeeklyCheckIn
 *
 * Answers saved for the chosen date are filled back in. Re-rendering for the
 * same date keeps what was typed. Every answer is optional; tapping a picked
 * option again clears it.
 */
(function (root) {
  'use strict';
  if (!root || !root.document) return;
  const doc = root.document;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const D = () => root.checkInDetail;

  function readJSON(key, fallback) {
    try { const v = JSON.parse(root.localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch (_e) { return fallback; }
  }

  // Planned sessions per week and start date of the active program.
  function programInfo(userId) {
    const active = readJSON(`activeProgram_${userId}`, null) || readJSON('activeProgram', null);
    if (!active) return { perWeek: null, startDate: '' };
    const id = active.programId || active.id;
    const list = readJSON(`programs_${userId}`, null) || readJSON('programs', []);
    const program = (Array.isArray(list) ? list : []).find(p => p && (p.id === id || p.programId === id)) || null;
    const perWeek = program ? ((Array.isArray(program.frequency) && program.frequency.length) || (Array.isArray(program.days) && program.days.length) || null) : null;
    return { perWeek, startDate: String(active.startDate || (program && program.startDate) || '').slice(0, 10) };
  }

  // One tappable choice group. `options`: [[value, label, hint?]].
  function choices(path, options, value, opts = {}) {
    return `<div class="ci-choices${opts.compact ? ' ci-choices--compact' : ''}" role="radiogroup" style="--ci-cols:${options.length}" data-detail-choice="${esc(path)}"${opts.day ? ` data-day="${esc(opts.day)}"` : ''}${opts.label ? ` aria-label="${esc(opts.label)}"` : ''}>`
      + options.map(([v, label, hint]) => `<button type="button" class="ci-choice${String(value) === String(v) ? ' on' : ''}" role="radio" aria-checked="${String(value) === String(v)}" data-v="${esc(v)}"${hint ? ` title="${esc(hint)}"` : ''}>${esc(label)}</button>`).join('')
      + '</div>';
  }

  function scale(path, label, min, max, value, lo, hi) {
    const opts = [];
    for (let n = min; n <= max; n++) opts.push([String(n), String(n)]);
    return `<div class="ci-detail-scale">
      <div class="ci-detail-q">${esc(label)}</div>
      <div class="ci-detail-scale-row">${choices(path, opts, value, { label, compact: true })}</div>
      <div class="ci-detail-ends"><span>${esc(lo)}</span><span>${esc(hi)}</span></div>
    </div>`;
  }

  function area(path, label, value, placeholder, hint) {
    return `<div class="ci-field ci-field-full"><label>${esc(label)}${hint ? ` <span class="ci-opt">${esc(hint)}</span>` : ''}
      <textarea rows="2" data-detail="${esc(path)}" placeholder="${esc(placeholder || '')}">${esc(value || '')}</textarea></label></div>`;
  }

  function input(path, label, value, attrs) {
    return `<div class="ci-field"><label>${esc(label)}<input ${attrs} data-detail="${esc(path)}" value="${esc(value ?? '')}"></label></div>`;
  }

  // A labelled matrix: one choice group per row.
  function matrix(rows, options, values, pathFor, legend) {
    return `<div class="ci-matrix">${legend ? `<div class="ci-matrix-legend">${legend}</div>` : ''}`
      + rows.map(([key, label, sub]) => `<div class="ci-matrix-row"><span class="ci-matrix-label">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>`
        + choices(pathFor(key), options, values[key], { label, day: pathFor(key).includes('workload') ? label : '' }) + '</div>').join('')
      + '</div>';
  }

  function render(userId, opts = {}) {
    const box = doc.getElementById('checkInDetailSections');
    const api = D();
    if (!box || !api) return;
    const date = opts.date || new Date().toISOString().slice(0, 10);
    const archetypeKeys = new Set(opts.archetypeKeys || []);
    const key = `${date}|${[...archetypeKeys].sort().join(',')}`;
    if (box.dataset.renderedFor === key) return; // keep what was typed
    const saved = ((root.checkinEngine && root.checkinEngine.loadCheckIns(userId)) || []).find(e => e.date === date);
    const d = (saved && saved.detail) || {};
    const t = d.training || {};
    const n = d.nutrition || {};
    const l = d.lifestyle || {};
    const prog = programInfo(userId);

    const days = api.workloadDays(prog.perWeek);
    (t.workload || []).forEach(w => { if (!days.includes(w.day) && days.length < api.MAX_DAYS) days.push(w.day); });
    const workloadValues = {};
    (t.workload || []).forEach(w => { workloadValues[w.day] = w.rating; });
    const nutritionRows = api.NUTRITION.filter(([k]) => !archetypeKeys.has(k));
    const recLegend = api.RECOVERY.map(([, label]) => esc(label)).join(' · ');

    box.innerHTML = `
      <div class="ci-card">
        <h3 class="ci-card-title"><span class="ui-icon" data-icon="dumbbell"></span> Training</h3>
        <p class="ci-card-desc">Since your last check-in. The more detail, the better your coach can adjust the plan.</p>
        ${input('training.programWeek', 'Week and day of training you\'re up to', t.programWeek || api.programWeekLabel(prog.startDate, date), 'type="text" maxlength="60" placeholder="e.g. Week 4, Day 2"')}
        <div class="ci-detail-q">How did each muscle recover between sessions?</div>
        ${matrix(api.MUSCLES, api.RECOVERY.map(([v, label]) => [v, label]), t.recovery || {}, k => `training.recovery.${k}`)}
        <div class="ci-detail-q">How was the workload of each session?</div>
        ${matrix(days.map(x => [x, x]), api.WORKLOAD, workloadValues, k => `training.workload.${k}`)}
        ${area('training.workloadNotes', 'Detail on workload and soreness', t.workloadNotes, 'Which days were too much or too easy, what was still sore…')}
        ${area('training.jointPain', 'Joint pain', t.jointPain, 'Joint, movement and when it hurts. Leave blank if none')}
        ${area('training.performance', 'Performance: did you progress?', t.performance, 'Lifts that went up, stalled or dropped')}
        ${scale('training.pump', 'Pumps in the gym', 1, 5, t.pump, 'No pump', 'Skin splitting')}
        ${area('training.pumpNotes', 'Pump detail', t.pumpNotes, 'Optional')}
        ${archetypeKeys.has('cardioAdherence') ? '' : scale('training.cardioAdherence', 'Cardio / steps adherence', 1, 5, t.cardioAdherence, 'Did none', '100%')}
        ${area('training.cardioNotes', 'Cardio / steps detail', t.cardioNotes, 'Average steps, sessions missed…')}
      </div>

      <div class="ci-card">
        <h3 class="ci-card-title"><span class="ui-icon" data-icon="package"></span> Nutrition</h3>
        <p class="ci-card-desc">5 = easily manageable, 1 = unmanageable. Skip the ones that don't apply.</p>
        ${matrix(nutritionRows, [['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']], n.ratings || {}, k => `nutrition.ratings.${k}`)}
        ${area('nutrition.offPlanMeals', 'Off-plan meals this week', n.offPlanMeals, 'Include any missed meals')}
        <div class="ci-detail-q">Did you hit your water target?</div>
        ${choices('nutrition.water', api.WATER, n.water, { label: 'Water target' })}
      </div>

      <div class="ci-card">
        <h3 class="ci-card-title"><span class="ui-icon" data-icon="brain"></span> Lifestyle &amp; health</h3>
        ${archetypeKeys.has('fatigue') ? '' : scale('lifestyle.physicalFatigue', 'Physical fatigue', 1, 10, l.physicalFatigue, 'Fresh', 'Exhausted')}
        ${scale('lifestyle.trainingEnergy', 'Energy in training', 1, 10, l.trainingEnergy, 'Flat', 'Explosive')}
        ${area('lifestyle.markerNotes', 'Detail on any low scores', l.markerNotes, 'Stress, fatigue, energy, sleep…')}
        ${area('lifestyle.mentalStruggles', 'Any mental struggles this week?', l.mentalStruggles, 'Motivation, mood, cravings, anything on your mind')}
        ${area('lifestyle.sleepInsights', 'Sleep insights', l.sleepInsights, 'Hours, REM / deep sleep from your tracker, wake-ups')}
        <div class="ci-row-2">
          ${input('lifestyle.caffeineMg', 'Caffeine (mg/day)', l.caffeineMg, 'type="number" inputmode="numeric" min="0" max="2000" step="10" placeholder="e.g. 300"')}
          <div></div>
        </div>
        ${scale('lifestyle.supplementAdherence', 'Supplement adherence', 1, 5, l.supplementAdherence, 'Missed most', 'Every day')}
        ${area('lifestyle.medications', 'Medications this week', l.medications, 'e.g. ADHD, antidepressants, antibiotics')}
        <details class="ci-detail-private"${l.peds || l.pedNotes ? ' open' : ''}>
          <summary>Performance-enhancing drugs <span class="ci-opt">(optional, only shared with your coach)</span></summary>
          <div class="ci-detail-q">Were PEDs taken and timed correctly?</div>
          ${choices('lifestyle.peds', api.PEDS, l.peds, { label: 'PEDs taken and timed correctly' })}
          ${area('lifestyle.pedNotes', 'PED detail', l.pedNotes, 'Missed doses, timing changes, side effects')}
        </details>
        ${area('lifestyle.otherFeedback', 'Anything else your coach should know?', l.otherFeedback, '')}
      </div>`;
    box.dataset.renderedFor = key;
    // The shared icon set is a global const in index.html (not on window).
    if (typeof ICONS !== 'undefined') {
      box.querySelectorAll('[data-icon]').forEach(el => { const svg = ICONS[el.dataset.icon]; if (svg) el.innerHTML = svg; }); // eslint-disable-line no-undef
    }
  }

  // Tap to pick, tap again to clear.
  doc.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('#checkInDetailSections .ci-choice');
    if (!btn) return;
    const group = btn.closest('[data-detail-choice]');
    const wasOn = btn.classList.contains('on');
    group.querySelectorAll('.ci-choice').forEach(b => { b.classList.remove('on'); b.setAttribute('aria-checked', 'false'); });
    if (!wasOn) { btn.classList.add('on'); btn.setAttribute('aria-checked', 'true'); }
  });

  function setPath(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    parts.slice(0, -1).forEach(p => { cur = cur[p] = cur[p] && typeof cur[p] === 'object' ? cur[p] : {}; });
    cur[parts[parts.length - 1]] = value;
  }

  // → the cleaned detail, or null when nothing was answered.
  function read() {
    const box = doc.getElementById('checkInDetailSections');
    const api = D();
    if (!box || !api) return null;
    const raw = {};
    const workload = [];
    box.querySelectorAll('[data-detail-choice]').forEach(g => {
      const on = g.querySelector('.ci-choice.on');
      const path = g.dataset.detailChoice;
      if (g.dataset.day) { workload.push({ day: g.dataset.day, rating: on ? on.dataset.v : null }); return; }
      if (on) setPath(raw, path, on.dataset.v);
    });
    if (workload.some(w => w.rating)) setPath(raw, 'training.workload', workload.filter(w => w.rating));
    box.querySelectorAll('[data-detail]').forEach(el => { if (el.value.trim()) setPath(raw, el.dataset.detail, el.value); });
    return api.cleanDetail(raw);
  }

  root.renderCheckInDetailForm = render;
  root.readCheckInDetailForm = read;
})(typeof window !== 'undefined' ? window : null);
