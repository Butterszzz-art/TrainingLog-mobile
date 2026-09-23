/* =============================================================
   WEEKLY RECAP
   "Last week in review" — a Monday-to-Sunday look back across
   everything the user logged: lifting volume, per-muscle sets and
   frequency, top lifts, bodyweight trend, cardio / conditioning,
   nutrition and recovery. A compact card sits on Home; tapping it
   opens a bottom sheet with the full breakdown and lets the user
   step back through previous weeks.

   buildWeeklyRecap() is pure (data in, summary out) so it can be
   unit-tested under Node; everything below it is browser glue.
   ============================================================= */

(function () {
  'use strict';

  const LB_TO_KG = 0.45359237;
  const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const FALLBACK_MUSCLE_TARGETS = {
    chest: 14, back: 16, shoulders: 12, traps: 8, biceps: 10, triceps: 10,
    forearms: 8, quads: 14, hamstrings: 10, glutes: 10, calves: 8,
    adductors: 6, abductors: 6, abs: 8
  };

  /* ── Date helpers (local time, YYYY-MM-DD keys) ──────────── */

  function _pad(n) { return String(n).padStart(2, '0'); }

  function toDateKey(d) {
    return `${d.getFullYear()}-${_pad(d.getMonth() + 1)}-${_pad(d.getDate())}`;
  }

  function parseDateKey(key) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key || ''));
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }

  function addDays(key, n) {
    const d = parseDateKey(key);
    d.setDate(d.getDate() + n);
    return toDateKey(d);
  }

  /** Monday (YYYY-MM-DD) of the week containing `date`. */
  function mondayOf(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const offset = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
    d.setDate(d.getDate() - offset);
    return toDateKey(d);
  }

  /** Normalise any stored date (YYYY-MM-DD, ISO timestamp, toDateString) to a local key. */
  function _entryKey(value) {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const d = new Date(value);
    return isNaN(d) ? null : toDateKey(d);
  }

  function _num(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }

  function _toKg(weight, unit) {
    return unit === 'lb' ? weight * LB_TO_KG : weight;
  }

  function _fromKg(kg, unit) {
    return unit === 'lb' ? kg / LB_TO_KG : kg;
  }

  function _e1rm(weight, reps) {
    if (!(weight > 0) || !(reps > 0)) return 0;
    return reps === 1 ? weight : weight * (1 + reps / 30);
  }

  /* ── Lifting ─────────────────────────────────────────────── */

  // Walk every counted set of every workout in [start, end]. Skipped sets
  // (session-queue marks them) don't count; weight is normalised to kg.
  function _eachSet(workouts, start, end, fn) {
    (workouts || []).forEach(w => {
      const day = _entryKey(w && w.date);
      if (!day || day < start || day > end) return;
      (Array.isArray(w.log) ? w.log : []).forEach(entry => {
        if (!entry || !entry.exercise) return;
        const reps = Array.isArray(entry.repsArray) ? entry.repsArray : [];
        const weights = Array.isArray(entry.weightsArray) ? entry.weightsArray : [];
        const skipped = Array.isArray(entry.skippedArray) ? entry.skippedArray : [];
        const unit = entry.unit === 'lb' ? 'lb' : 'kg';
        const n = Math.max(reps.length, weights.length);
        if (n === 0) {
          // Legacy entries with only a set count and no per-set arrays.
          for (let i = 0; i < _num(entry.sets); i++) fn({ day, entry, reps: 0, kg: 0 });
          return;
        }
        for (let i = 0; i < n; i++) {
          if (skipped[i] === true) continue;
          const r = _num(reps[i]);
          const wt = _num(weights[i]);
          if (r <= 0 && wt <= 0) continue;
          fn({ day, entry, reps: r, kg: _toKg(wt, unit) });
        }
      });
    });
  }

  function _trainingTotals(workouts, start, end) {
    const days = new Set();
    let sets = 0, reps = 0, volumeKg = 0;
    const exercises = new Set();
    _eachSet(workouts, start, end, s => {
      days.add(s.day);
      exercises.add(s.entry.exercise.trim().toLowerCase());
      sets++;
      reps += s.reps;
      volumeKg += s.kg * s.reps;
    });
    return { sessions: days.size, days, sets, reps, volumeKg, exercises: exercises.size };
  }

  function _muscleBreakdown(workouts, start, end, getMuscleGroup, targets) {
    const byMuscle = {};
    _eachSet(workouts, start, end, s => {
      const muscle = (getMuscleGroup && getMuscleGroup(s.entry.exercise)) || 'other';
      const row = byMuscle[muscle] || (byMuscle[muscle] = { muscle, sets: 0, days: new Set() });
      row.sets++;
      row.days.add(s.day);
    });

    const rows = Object.values(byMuscle).map(r => ({
      muscle: r.muscle,
      sets: r.sets,
      frequency: r.days.size,
      target: targets[r.muscle] || 0
    }));
    // Muscles the user has a weekly target for but didn't touch at all.
    const missed = Object.keys(targets)
      .filter(m => targets[m] > 0 && !byMuscle[m]);
    rows.sort((a, b) => b.sets - a.sets || a.muscle.localeCompare(b.muscle));
    return { rows, missed };
  }

  function _topLifts(workouts, start, end) {
    const best = {};   // this week, by exercise
    const prior = {};  // best e1RM before `start`
    (workouts || []).forEach(w => {
      const day = _entryKey(w && w.date);
      if (!day || day > end) return;
      (Array.isArray(w.log) ? w.log : []).forEach(entry => {
        if (!entry || !entry.exercise) return;
        const key = entry.exercise.trim().toLowerCase();
        const reps = Array.isArray(entry.repsArray) ? entry.repsArray : [];
        const weights = Array.isArray(entry.weightsArray) ? entry.weightsArray : [];
        const skipped = Array.isArray(entry.skippedArray) ? entry.skippedArray : [];
        const unit = entry.unit === 'lb' ? 'lb' : 'kg';
        for (let i = 0; i < reps.length; i++) {
          if (skipped[i] === true) continue;
          const r = _num(reps[i]);
          const kg = _toKg(_num(weights[i]), unit);
          const e = _e1rm(kg, r);
          if (!e) continue;
          if (day < start) {
            prior[key] = Math.max(prior[key] || 0, e);
          } else if (!best[key] || e > best[key].e1rmKg) {
            best[key] = { exercise: entry.exercise.trim(), kg, reps: r, e1rmKg: e };
          }
        }
      });
    });

    return Object.entries(best).map(([key, b]) => {
      const prev = prior[key] || 0;
      return {
        ...b,
        priorE1rmKg: prev || null,
        isPR: prev > 0 && b.e1rmKg > prev + 0.01,
        changePct: prev > 0 ? ((b.e1rmKg - prev) / prev) * 100 : null
      };
    }).sort((a, b) =>
      (b.isPR - a.isPR) ||
      ((b.changePct ?? -Infinity) - (a.changePct ?? -Infinity)) ||
      (b.e1rmKg - a.e1rmKg)
    );
  }

  /* ── Body, cardio, nutrition, recovery ───────────────────── */

  function _bodyweight(log, start, end) {
    const inWeek = [];
    let before = null;
    (log || []).forEach(e => {
      const day = _entryKey(e && e.date);
      if (!day) return;
      const kg = e.weightKg != null ? _num(e.weightKg) : _toKg(_num(e.weight), e.unit);
      if (!(kg > 0)) return;
      if (day >= start && day <= end) inWeek.push({ day, kg });
      else if (day < start && (!before || day > before.day)) before = { day, kg };
    });
    if (!inWeek.length) return null;
    inWeek.sort((a, b) => a.day.localeCompare(b.day));
    const avgKg = inWeek.reduce((s, e) => s + e.kg, 0) / inWeek.length;
    const first = inWeek[0].kg;
    const last = inWeek[inWeek.length - 1].kg;
    // Prefer change vs the last weigh-in before the week; fall back to
    // first→last within the week when there's nothing earlier.
    const baseline = before ? before.kg : (inWeek.length > 1 ? first : null);
    return {
      entries: inWeek.length,
      avgKg,
      startKg: first,
      endKg: last,
      changeKg: baseline != null ? last - baseline : null,
      minKg: Math.min(...inWeek.map(e => e.kg)),
      maxKg: Math.max(...inWeek.map(e => e.kg))
    };
  }

  function _cardio(log, start, end) {
    const byType = {};
    let sessions = 0, minutes = 0, distanceKm = 0, calories = 0;
    const days = new Set();
    (log || []).forEach(e => {
      const day = _entryKey(e && e.date);
      if (!day || day < start || day > end) return;
      sessions++;
      days.add(day);
      const mins = _num(e.duration);
      minutes += mins;
      distanceKm += _num(e.distance);
      calories += _num(e.calories) || _num(e.estimatedCalories);
      const type = String(e.type || 'Other').trim() || 'Other';
      byType[type] = (byType[type] || 0) + mins;
    });
    const types = Object.entries(byType)
      .map(([type, mins]) => ({ type, minutes: mins }))
      .sort((a, b) => b.minutes - a.minutes);
    return { sessions, minutes, distanceKm, calories, days, types };
  }

  function _countInWeek(list, start, end, dateField) {
    return (list || []).filter(e => {
      const day = _entryKey(e && e[dateField]);
      return day && day >= start && day <= end;
    }).length;
  }

  function _nutrition(history, target, start, end) {
    // macroHistory is an array of { date, totals }; tolerate the older
    // object-keyed-by-date shape too. Last save of a day wins.
    const byDay = {};
    const list = Array.isArray(history)
      ? history
      : Object.entries(history || {}).map(([date, v]) => ({ date, ...(v || {}) }));
    list.forEach(e => {
      const day = _entryKey(e && e.date);
      if (!day || day < start || day > end) return;
      const t = e.totals || e;
      const kcal = _num(t.calories);
      if (kcal > 0) byDay[day] = { calories: kcal, protein: _num(t.protein) };
    });
    const days = Object.values(byDay);
    if (!days.length) return null;
    const calTarget = _num(target && target.calories);
    const proteinTarget = _num(target && target.protein);
    return {
      daysLogged: days.length,
      avgCalories: days.reduce((s, d) => s + d.calories, 0) / days.length,
      avgProtein: days.reduce((s, d) => s + d.protein, 0) / days.length,
      calorieTarget: calTarget || null,
      proteinTarget: proteinTarget || null,
      daysOnTarget: calTarget > 0
        ? days.filter(d => d.calories >= calTarget * 0.9 && d.calories <= calTarget * 1.1).length
        : null
    };
  }

  function _recovery(readiness, steps, dayKeys) {
    const scores = [];
    const stepCounts = [];
    dayKeys.forEach(key => {
      const r = readiness && readiness[parseDateKey(key).toDateString()];
      if (r && !r.skipped && r.score != null) scores.push(_num(r.score));
      const s = _num(steps && steps[key]);
      if (s > 0) stepCounts.push(s);
    });
    return {
      avgReadiness: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
      readinessDays: scores.length,
      avgSteps: stepCounts.length ? stepCounts.reduce((a, b) => a + b, 0) / stepCounts.length : null,
      stepDays: stepCounts.length
    };
  }

  /* ── Public: build the recap ─────────────────────────────── */

  /**
   * @param {object} data   raw logs (workouts, cardioLog, bodyweightLog,
   *                        macroHistory, macroTargets, mobilitySessions,
   *                        crossfitLog, readiness, steps, muscleTargets)
   * @param {object} opts   { weekStart: 'YYYY-MM-DD' (a Monday),
   *                          getMuscleGroup: fn, today?: 'YYYY-MM-DD' }
   */
  function buildWeeklyRecap(data, opts) {
    data = data || {};
    opts = opts || {};
    const start = opts.weekStart;
    const end = addDays(start, 6);
    const prevStart = addDays(start, -7);
    const prevEnd = addDays(start, -1);
    const dayKeys = DAY_NAMES.map((_, i) => addDays(start, i));
    const today = opts.today || toDateKey(new Date());

    const targets = { ...FALLBACK_MUSCLE_TARGETS, ...(opts.defaultMuscleTargets || {}) };
    Object.entries(data.muscleTargets || {}).forEach(([m, v]) => {
      if (Number.isFinite(Number(v))) targets[m] = Number(v);
    });

    const training = _trainingTotals(data.workouts, start, end);
    const prevTraining = _trainingTotals(data.workouts, prevStart, prevEnd);
    const cardio = _cardio(data.cardioLog, start, end);
    const prevCardio = _cardio(data.cardioLog, prevStart, prevEnd);
    const crossfit = _countInWeek(data.crossfitLog, start, end, 'date');
    const mobility = _countInWeek(data.mobilitySessions, start, end, 'completedAt');
    const muscles = _muscleBreakdown(data.workouts, start, end, opts.getMuscleGroup, targets);
    const bodyweight = _bodyweight(data.bodyweightLog, start, end);
    const nutrition = _nutrition(data.macroHistory, data.macroTargets, start, end);
    const recovery = _recovery(data.readiness, data.steps, dayKeys);

    const days = dayKeys.map((key, i) => ({
      key,
      name: DAY_NAMES[i],
      lifted: training.days.has(key),
      cardio: cardio.days.has(key),
      future: key > today
    }));
    const activeDays = days.filter(d => d.lifted || d.cardio).length;

    const hasData = training.sets > 0 || cardio.sessions > 0 || crossfit > 0 ||
      mobility > 0 || !!bodyweight || !!nutrition;

    return {
      start,
      end,
      inProgress: today >= start && today <= end,
      hasData,
      days,
      activeDays,
      training: {
        sessions: training.sessions,
        sets: training.sets,
        reps: training.reps,
        volumeKg: training.volumeKg,
        exercises: training.exercises
      },
      prevTraining: {
        sessions: prevTraining.sessions,
        sets: prevTraining.sets,
        volumeKg: prevTraining.volumeKg
      },
      muscles: muscles.rows,
      missedMuscles: muscles.missed,
      topLifts: _topLifts(data.workouts, start, end).slice(0, 5),
      bodyweight,
      cardio: {
        sessions: cardio.sessions,
        minutes: cardio.minutes,
        distanceKm: cardio.distanceKm,
        calories: cardio.calories,
        types: cardio.types
      },
      prevCardio: { sessions: prevCardio.sessions, minutes: prevCardio.minutes },
      conditioning: { crossfit, mobility },
      nutrition,
      recovery
    };
  }

  const api = { buildWeeklyRecap, mondayOf, addDays, toDateKey, parseDateKey };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  /* ══════════════════════════════════════════════════════════
     Browser: data gathering + rendering
     ══════════════════════════════════════════════════════════ */

  function _user() {
    return (window.getActiveUsername && window.getActiveUsername()) ||
      window.currentUser ||
      localStorage.getItem('fitnessAppUser') ||
      localStorage.getItem('username') || '';
  }

  function _parse(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v == null ? fallback : v;
    } catch {
      return fallback;
    }
  }

  function _gather(username) {
    return {
      workouts: (window.getAllWorkoutsForUser && window.getAllWorkoutsForUser(username)) ||
        _parse(`workouts_${username}`, []),
      cardioLog: _parse(`cardioLog_${username}`, []),
      bodyweightLog: _parse(`bodyweightLog_${username}`, []),
      macroHistory: _parse(`macroHistory_${username}`, []),
      macroTargets: _parse(`macroTargets_${username}`, {}),
      mobilitySessions: _parse(`mobilitySessions_${username}`, []),
      crossfitLog: _parse(`crossfitLog_${username}`, []),
      readiness: _parse('dailyReadiness_v1', {}),
      steps: _parse('dailySteps', {}),
      muscleTargets: _parse(`muscleWeeklyTargets_${username}`, {})
    };
  }

  function _recapFor(username, weekStart) {
    return buildWeeklyRecap(_gather(username), {
      weekStart,
      getMuscleGroup: window.getMuscleGroup,
      defaultMuscleTargets: window.DEFAULT_WEEKLY_MUSCLE_TARGETS
    });
  }

  /* ── Formatting ─────────────────────────────────────────── */

  function _esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function _liftUnit() {
    const s = _parse(`settings_${_user()}`, null);
    const u = (s && s.unit) || localStorage.getItem('defaultWeightUnit') || 'kg';
    return u === 'lb' ? 'lb' : 'kg';
  }

  function _bodyUnit() {
    const pref = typeof window.getBodyweightPreference === 'function'
      ? window.getBodyweightPreference() : null;
    return pref && pref.unit === 'lb' ? 'lb' : 'kg';
  }

  function _fmtBig(n) {
    if (n >= 100000) return Math.round(n / 1000) + 'k';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n));
  }

  function _fmtW(kg, unit, dp = 1) {
    const v = _fromKg(kg, unit);
    return (Math.round(v * 10 ** dp) / 10 ** dp).toString();
  }

  function _pctDelta(cur, prev) {
    if (!(prev > 0)) return '';
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct === 0) return '<span class="wr-delta wr-delta--flat">±0%</span>';
    const cls = pct > 0 ? 'wr-delta--pos' : 'wr-delta--neg';
    return `<span class="wr-delta ${cls}">${pct > 0 ? '+' : ''}${pct}%</span>`;
  }

  function _countDelta(cur, prev) {
    const d = cur - prev;
    if (!prev && !cur) return '';
    if (d === 0) return '<span class="wr-delta wr-delta--flat">same</span>';
    const cls = d > 0 ? 'wr-delta--pos' : 'wr-delta--neg';
    return `<span class="wr-delta ${cls}">${d > 0 ? '+' : ''}${d}</span>`;
  }

  function _range(r) {
    const a = parseDateKey(r.start);
    const b = parseDateKey(r.end);
    try {
      const fmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
      if (typeof fmt.formatRange === 'function') return fmt.formatRange(a, b);
    } catch { /* fall through */ }
    const sameMonth = a.getMonth() === b.getMonth();
    const fa = a.toLocaleDateString(undefined, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
    const fb = b.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    return `${fa} – ${fb}`;
  }

  function _muscleName(m) {
    return m === 'other' ? 'Other' : m.charAt(0).toUpperCase() + m.slice(1);
  }

  function _weekLabel(r) {
    const thisMonday = mondayOf(new Date());
    if (r.start === thisMonday) return 'This week so far';
    if (r.start === addDays(thisMonday, -7)) return 'Last week';
    return 'Week recap';
  }

  function _headline(r) {
    const t = r.training;
    if (!r.hasData) return r.inProgress ? 'Nothing logged yet this week.' : 'Nothing logged this week.';
    const bits = [];
    if (t.sessions) bits.push(`${t.sessions} lifting session${t.sessions === 1 ? '' : 's'}`);
    if (r.cardio.sessions) bits.push(`${Math.round(r.cardio.minutes)} min cardio`);
    if (r.conditioning.crossfit) bits.push(`${r.conditioning.crossfit} WOD${r.conditioning.crossfit === 1 ? '' : 's'}`);
    if (!bits.length) return 'No training logged — body and nutrition only.';
    return bits.join(' · ');
  }

  /* ── Compact Home card ──────────────────────────────────── */

  function _dayStrip(r) {
    return `<div class="wr-days" role="img" aria-label="Active days: ${
      r.days.filter(d => d.lifted || d.cardio).map(d => d.name).join(', ') || 'none'}">
      ${r.days.map(d => `
        <div class="wr-day${d.lifted ? ' is-lift' : ''}${d.cardio ? ' is-cardio' : ''}${d.future ? ' is-future' : ''}">
          <span class="wr-day-dot"></span>
          <span class="wr-day-n">${d.name.charAt(0)}</span>
        </div>`).join('')}
    </div>`;
  }

  function _cardHtml(r) {
    const unit = _liftUnit();
    const bwUnit = _bodyUnit();
    const t = r.training;
    const topMuscles = r.muscles.filter(m => m.muscle !== 'other').slice(0, 4);
    const bw = r.bodyweight;

    const bwTile = bw
      ? `<div class="mx-stat"><span class="mx-stat-l">Bodyweight</span>
           <span class="mx-stat-v">${_fmtW(bw.avgKg, bwUnit)}<small>${bwUnit}</small></span>
           ${bw.changeKg != null ? `<span class="wr-sub">${bw.changeKg > 0 ? '+' : ''}${_fmtW(bw.changeKg, bwUnit)} ${bwUnit}</span>` : '<span class="wr-sub">avg</span>'}
         </div>`
      : `<div class="mx-stat"><span class="mx-stat-l">Cardio</span>
           <span class="mx-stat-v">${r.cardio.minutes ? Math.round(r.cardio.minutes) + '<small>min</small>' : '—'}</span>
           ${_countDelta(Math.round(r.cardio.minutes), Math.round(r.prevCardio.minutes)) || '<span class="wr-sub">&nbsp;</span>'}
         </div>`;

    return `
      <section class="pod mx-pod wr-card" aria-label="${_esc(_weekLabel(r))} recap">
        <div class="pod-row wr-head">
          <span class="mx-kicker">${_esc(_weekLabel(r))}</span>
          <span class="mx-meta">${_range(r)}</span>
        </div>
        <p class="wr-headline">${_esc(_headline(r))}</p>
        ${_dayStrip(r)}
        <div class="mx-tiles">
          <div class="mx-stat"><span class="mx-stat-l">Sets</span>
            <span class="mx-stat-v">${t.sets || '—'}</span>
            ${_countDelta(t.sets, r.prevTraining.sets) || '<span class="wr-sub">&nbsp;</span>'}
          </div>
          <div class="mx-stat"><span class="mx-stat-l">Volume</span>
            <span class="mx-stat-v">${t.volumeKg ? _fmtBig(_fromKg(t.volumeKg, unit)) + `<small>${unit}</small>` : '—'}</span>
            ${_pctDelta(t.volumeKg, r.prevTraining.volumeKg) || '<span class="wr-sub">&nbsp;</span>'}
          </div>
          ${bwTile}
        </div>
        ${topMuscles.length ? `<div class="wr-chips">${topMuscles.map(m =>
          `<span class="mx-tag${m.target && m.sets >= m.target ? ' mx-tag--hi' : ''}">${_esc(_muscleName(m.muscle))} ${m.sets}<em>·${m.frequency}×</em></span>`
        ).join('')}${r.missedMuscles.length && !r.inProgress
          ? `<span class="mx-tag mx-tag--brass">${r.missedMuscles.length} missed</span>` : ''}</div>` : ''}
        <button type="button" class="mx-link wr-open" data-wr-open="${r.start}">See full recap ›</button>
      </section>`;
  }

  /* ── Full recap sheet ───────────────────────────────────── */

  function _section(title, body, meta) {
    return `<section class="wr-sec">
      <div class="wr-sec-head"><span class="mx-lbl">${title}</span>${meta ? `<span class="mx-meta">${meta}</span>` : ''}</div>
      ${body}
    </section>`;
  }

  function _musclesHtml(r) {
    if (!r.muscles.length) return '<p class="wr-empty">No lifting logged.</p>';
    const rows = r.muscles.map(m => {
      const pct = m.target ? Math.min(100, Math.round((m.sets / m.target) * 100)) : 100;
      const tone = !m.target ? '' : m.sets >= m.target ? ' is-hit' : pct < 50 ? ' is-low' : '';
      return `<div class="wr-mrow${tone}">
        <span class="wr-mname">${_esc(_muscleName(m.muscle))}</span>
        <div class="mx-meter mx-meter--thin"><i style="width:${pct}%"></i></div>
        <span class="wr-mval">${m.sets}${m.target ? `<small>/${m.target}</small>` : ''}</span>
        <span class="wr-mfreq" title="Days trained">${m.frequency}×</span>
      </div>`;
    }).join('');
    const missed = r.missedMuscles.length
      ? `<p class="wr-note">${r.inProgress ? 'Not trained yet' : 'Not trained'}: ${r.missedMuscles.map(m => _esc(_muscleName(m))).join(', ')}</p>`
      : '';
    const legend = '<p class="wr-legend">Sets / weekly target · days trained</p>';
    return legend + `<div class="wr-mtable">${rows}</div>` + missed;
  }

  function _liftsHtml(r) {
    const unit = _liftUnit();
    if (!r.topLifts.length) return '<p class="wr-empty">No weighted sets logged.</p>';
    return `<div class="wr-lifts">${r.topLifts.map(l => {
      const tag = l.isPR
        ? `<span class="mx-chip mx-chip--green mx-chip--sm">PR +${l.changePct.toFixed(1)}%</span>`
        : l.priorE1rmKg == null
          ? '<span class="mx-chip mx-chip--sm">New</span>'
          : Math.abs(l.changePct) < 0.05
            ? '<span class="wr-sub">Matched</span>'
            : `<span class="wr-sub">${l.changePct > 0 ? '+' : ''}${l.changePct.toFixed(1)}%</span>`;
      return `<div class="wr-lift">
        <div class="wr-lift-main">
          <span class="wr-lift-name">${_esc(l.exercise)}</span>
          <span class="wr-sub">${_fmtW(l.kg, unit, 1)} ${unit} × ${l.reps} · e1RM ${_fmtW(l.e1rmKg, unit, 0)} ${unit}</span>
        </div>
        ${tag}
      </div>`;
    }).join('')}</div><p class="wr-legend">Best set per lift vs. your previous best (last ~4 weeks on this device)</p>`;
  }

  function _bodyHtml(r) {
    const bw = r.bodyweight;
    if (!bw) return '<p class="wr-empty">No weigh-ins logged.</p>';
    const u = _bodyUnit();
    const change = bw.changeKg == null ? '—'
      : `${bw.changeKg > 0 ? '+' : ''}${_fmtW(bw.changeKg, u)}<small>${u}</small>`;
    return `<div class="mx-tiles">
      <div class="mx-stat"><span class="mx-stat-l">Average</span><span class="mx-stat-v">${_fmtW(bw.avgKg, u)}<small>${u}</small></span></div>
      <div class="mx-stat"><span class="mx-stat-l">Change</span><span class="mx-stat-v">${change}</span></div>
      <div class="mx-stat"><span class="mx-stat-l">Weigh-ins</span><span class="mx-stat-v">${bw.entries}<small>/7</small></span></div>
    </div>
    ${bw.entries > 1 ? `<p class="wr-legend">Range ${_fmtW(bw.minKg, u)}–${_fmtW(bw.maxKg, u)} ${u}</p>` : ''}`;
  }

  function _cardioHtml(r) {
    const c = r.cardio;
    const cond = r.conditioning;
    if (!c.sessions && !cond.crossfit && !cond.mobility) return '<p class="wr-empty">No cardio or conditioning logged.</p>';
    const tiles = `<div class="mx-tiles">
      <div class="mx-stat"><span class="mx-stat-l">Minutes</span><span class="mx-stat-v">${Math.round(c.minutes) || '—'}</span>${_countDelta(Math.round(c.minutes), Math.round(r.prevCardio.minutes))}</div>
      <div class="mx-stat"><span class="mx-stat-l">Distance</span><span class="mx-stat-v">${c.distanceKm ? c.distanceKm.toFixed(1) + '<small>km</small>' : '—'}</span></div>
      <div class="mx-stat"><span class="mx-stat-l">Calories</span><span class="mx-stat-v">${c.calories ? _fmtBig(c.calories) + '<small>kcal</small>' : '—'}</span></div>
    </div>`;
    const types = c.types.length
      ? `<div class="wr-chips">${c.types.map(t => `<span class="mx-tag">${_esc(t.type)} ${Math.round(t.minutes)}<em>min</em></span>`).join('')}</div>`
      : '';
    const extra = [
      c.sessions ? `${c.sessions} cardio session${c.sessions === 1 ? '' : 's'}` : '',
      cond.crossfit ? `${cond.crossfit} WOD${cond.crossfit === 1 ? '' : 's'}` : '',
      cond.mobility ? `${cond.mobility} mobility session${cond.mobility === 1 ? '' : 's'}` : ''
    ].filter(Boolean).join(' · ');
    return tiles + types + (extra ? `<p class="wr-legend">${extra}</p>` : '');
  }

  function _nutritionHtml(r) {
    const n = r.nutrition;
    if (!n) return '<p class="wr-empty">No meals logged.</p>';
    return `<div class="mx-tiles">
      <div class="mx-stat"><span class="mx-stat-l">Avg kcal</span><span class="mx-stat-v">${Math.round(n.avgCalories)}</span>${n.calorieTarget ? `<span class="wr-sub">target ${Math.round(n.calorieTarget)}</span>` : ''}</div>
      <div class="mx-stat"><span class="mx-stat-l">Avg protein</span><span class="mx-stat-v">${Math.round(n.avgProtein)}<small>g</small></span>${n.proteinTarget ? `<span class="wr-sub">target ${Math.round(n.proteinTarget)}g</span>` : ''}</div>
      <div class="mx-stat"><span class="mx-stat-l">${n.daysOnTarget != null ? 'On target' : 'Days logged'}</span><span class="mx-stat-v">${n.daysOnTarget != null ? n.daysOnTarget : n.daysLogged}<small>/${n.daysOnTarget != null ? n.daysLogged : 7}</small></span></div>
    </div>`;
  }

  function _recoveryHtml(r) {
    const rec = r.recovery;
    if (rec.avgReadiness == null && rec.avgSteps == null) return '';
    return _section('Recovery', `<div class="mx-tiles mx-tiles--2">
      <div class="mx-stat"><span class="mx-stat-l">Avg readiness</span><span class="mx-stat-v">${rec.avgReadiness != null ? Math.round(rec.avgReadiness) + '<small>%</small>' : '—'}</span>${rec.readinessDays ? `<span class="wr-sub">${rec.readinessDays} check-in${rec.readinessDays === 1 ? '' : 's'}</span>` : ''}</div>
      <div class="mx-stat"><span class="mx-stat-l">Avg steps</span><span class="mx-stat-v">${rec.avgSteps != null ? _fmtBig(rec.avgSteps) : '—'}</span>${rec.stepDays ? `<span class="wr-sub">${rec.stepDays} day${rec.stepDays === 1 ? '' : 's'}</span>` : ''}</div>
    </div>`);
  }

  function _sheetBody(r) {
    const unit = _liftUnit();
    const t = r.training;
    const training = t.sets ? `<div class="mx-tiles mx-tiles--4">
        <div class="mx-stat"><span class="mx-stat-l">Sessions</span><span class="mx-stat-v">${t.sessions}</span>${_countDelta(t.sessions, r.prevTraining.sessions)}</div>
        <div class="mx-stat"><span class="mx-stat-l">Sets</span><span class="mx-stat-v">${t.sets}</span>${_countDelta(t.sets, r.prevTraining.sets)}</div>
        <div class="mx-stat"><span class="mx-stat-l">Reps</span><span class="mx-stat-v">${_fmtBig(t.reps)}</span></div>
        <div class="mx-stat"><span class="mx-stat-l">Volume</span><span class="mx-stat-v">${_fmtBig(_fromKg(t.volumeKg, unit))}<small>${unit}</small></span>${_pctDelta(t.volumeKg, r.prevTraining.volumeKg)}</div>
      </div><p class="wr-legend">${t.exercises} exercise${t.exercises === 1 ? '' : 's'} · ${r.activeDays} active day${r.activeDays === 1 ? '' : 's'} · change vs. the week before</p>`
      : '<p class="wr-empty">No lifting logged.</p>';

    return `
      <p class="wr-headline">${_esc(_headline(r))}</p>
      ${_dayStrip(r)}
      <div class="wr-legend wr-key"><span class="wr-key-dot is-lift"></span>Lifting <span class="wr-key-dot is-cardio"></span>Cardio</div>
      ${_section('Training', training)}
      ${_section('Muscle frequency', _musclesHtml(r))}
      ${_section('Top lifts', _liftsHtml(r))}
      ${_section('Bodyweight', _bodyHtml(r))}
      ${_section('Cardio &amp; conditioning', _cardioHtml(r))}
      ${_section('Nutrition', _nutritionHtml(r))}
      ${_recoveryHtml(r)}`;
  }

  let _sheetWeek = null;

  function _renderSheet() {
    const overlay = document.getElementById('weeklyRecapSheet');
    if (!overlay) return;
    const username = _user();
    const r = _recapFor(username, _sheetWeek);
    const thisMonday = mondayOf(new Date());
    const oldest = addDays(thisMonday, -7 * 12);
    overlay.querySelector('.wr-sheet-title').textContent = _weekLabel(r);
    overlay.querySelector('.wr-sheet-range').textContent = _range(r);
    overlay.querySelector('[data-wr-nav="-1"]').disabled = _sheetWeek <= oldest;
    overlay.querySelector('[data-wr-nav="1"]').disabled = _sheetWeek >= thisMonday;
    overlay.querySelector('.wr-sheet-body').innerHTML = _sheetBody(r);
  }

  function _closeSheet() {
    const overlay = document.getElementById('weeklyRecapSheet');
    if (overlay) overlay.remove();
    document.removeEventListener('keydown', _onKey);
  }

  function _onKey(e) {
    if (e.key === 'Escape') _closeSheet();
  }

  function openWeeklyRecap(weekStart) {
    _closeSheet();
    _sheetWeek = weekStart || addDays(mondayOf(new Date()), -7);
    const closeIcon = (typeof ICONS !== 'undefined' && ICONS.x) || '×';
    const overlay = document.createElement('div');
    overlay.id = 'weeklyRecapSheet';
    overlay.className = 'mx-sheet-backdrop';
    overlay.innerHTML = `
      <div class="mx-sheet wr-sheet" role="dialog" aria-modal="true" aria-labelledby="wrSheetTitle">
        <div class="mx-sheet-head">
          <div class="wr-sheet-titles">
            <h3 class="pod-title mx-h3 wr-sheet-title" id="wrSheetTitle"></h3>
            <span class="mx-meta wr-sheet-range"></span>
          </div>
          <button type="button" class="mx-iconbtn mx-iconbtn--ghost" data-wr-close aria-label="Close"><span class="ui-icon">${closeIcon}</span></button>
        </div>
        <div class="wr-nav">
          <button type="button" class="mx-outline wr-nav-btn" data-wr-nav="-1" aria-label="Previous week">‹ Prev</button>
          <button type="button" class="mx-outline wr-nav-btn" data-wr-nav="1" aria-label="Next week">Next ›</button>
        </div>
        <div class="wr-sheet-body"></div>
      </div>`;
    overlay.addEventListener('click', e => {
      if (e.target === overlay || e.target.closest('[data-wr-close]')) { _closeSheet(); return; }
      const nav = e.target.closest('[data-wr-nav]');
      if (nav && !nav.disabled) {
        _sheetWeek = addDays(_sheetWeek, 7 * Number(nav.dataset.wrNav));
        _renderSheet();
      }
    });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', _onKey);
    _renderSheet();
  }

  function renderWeeklyRecapCard() {
    const host = document.getElementById('weeklyRecapCard');
    if (!host) return;
    const username = _user();
    if (!username) { host.innerHTML = ''; return; }
    const r = _recapFor(username, addDays(mondayOf(new Date()), -7));
    // Nothing to recap (new user, or took the week off with no logs at all).
    host.innerHTML = r.hasData ? _cardHtml(r) : '';
  }

  document.addEventListener('click', e => {
    const btn = e.target.closest && e.target.closest('[data-wr-open]');
    if (btn) openWeeklyRecap(btn.dataset.wrOpen);
  });

  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(renderWeeklyRecapCard, 1000);
  });

  window.buildWeeklyRecap = buildWeeklyRecap;
  window.renderWeeklyRecapCard = renderWeeklyRecapCard;
  window.openWeeklyRecap = openWeeklyRecap;
})();
