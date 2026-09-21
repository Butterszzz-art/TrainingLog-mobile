/**
 * today-program.js
 * Renders a "Today's Session" card on the home tab showing:
 *  - Today's program day name (e.g. "Upper B") or Rest Day
 *  - Current week number in the program
 *  - Weekly split strip: Mon–Sun with day labels & today indicator
 */
(function () {
  'use strict';

  const WEEKDAY_ABBR  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const WEEKDAY_MAP   = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  // ── Data helpers ───────────────────────────────────────────────────────────

  function _user() {
    return window.currentUser || localStorage.getItem('fitnessAppUser');
  }

  function _getActiveRecord() {
    const u = _user();
    if (!u) return null;
    return JSON.parse(
      localStorage.getItem(`activeProgram_${u}`) ||
      localStorage.getItem('activeProgram') ||
      'null'
    );
  }

  function _getPrograms() {
    const u = _user();
    if (!u) return [];
    return (
      JSON.parse(localStorage.getItem(`programs_${u}`)) ||
      JSON.parse(localStorage.getItem('programs') || '[]')
    );
  }

  /** Parse "YYYY-MM-DD" as local midnight (avoids UTC-offset day-off-by-one). */
  function _parseLocalDate(str) {
    if (!str) return null;
    const [y, m, d] = str.split('-').map(Number);
    if (!y) return null;
    return new Date(y, m - 1, d);
  }

  /** Count training days from `from` (inclusive) up to but NOT including `until`. */
  function _countTrainingDaysBetween(from, until, trainingDayNums) {
    let count = 0;
    const cur = new Date(from);
    while (cur < until) {
      if (trainingDayNums.includes(cur.getDay())) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  }

  // ── Multi-week programs ────────────────────────────────────────────────────
  // Library programs run for several weeks with different sets each week. Day
  // and week come from how many training days have passed, so a missed week
  // doesn't skip ahead; single-week programs behave exactly as before.

  function _core() { return window.programBuilderV2Core || null; }

  function _weekCount(program) {
    const core = _core();
    return core ? core.getWeekCount(program) : 1;
  }

  /** The program day for the nth training day since the start (0-based). */
  function _dayAt(program, trainingIndex, nDays) {
    const core = _core();
    const week = Math.floor(trainingIndex / nDays) + 1;
    const list = core ? core.getWeekDays(program, week) : program.days;
    return (list && list[trainingIndex % nDays]) || program.days[trainingIndex % nDays];
  }

  /** The phase label of a 1-based program week, e.g. "12 working sets". */
  function _phaseFor(program, week) {
    if (!Array.isArray(program.weeks) || !program.weeks.length) return '';
    const w = program.weeks[(week - 1) % program.weeks.length];
    return (w && w.phase) || '';
  }

  // ── Core logic ─────────────────────────────────────────────────────────────

  function _buildInfo() {
    const active = _getActiveRecord();
    if (!active) return null;

    const programs = _getPrograms();
    const program  = programs.find(p => p.id === active.programId);
    if (!program || !Array.isArray(program.days) || !program.days.length) return null;

    // Normalise training weekday list → JS getDay() numbers
    const rawFreq = program.frequency || program.weekdays || ['Mon', 'Wed', 'Fri'];
    const trainingNums = rawFreq
      .map(d => WEEKDAY_MAP[d])
      .filter(n => n !== undefined);

    if (!trainingNums.length) return null;

    const startDate = _parseLocalDate(active.startDate || program.startDate);
    if (!startDate) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Training days completed before today
    const tdBefore  = _countTrainingDaysBetween(startDate, today, trainingNums);
    const nDays     = program.days.length;
    const todayIdx  = tdBefore % nDays;
    const isTrain   = trainingNums.includes(today.getDay()) && today >= startDate;

    // Week number (1-based). Multi-week programs follow training days done.
    const weekCount = _weekCount(program);
    const weekNum = weekCount > 1
      ? (Math.floor(tdBefore / nDays) % weekCount) + 1
      : Math.floor((today - startDate) / (7 * 86400000)) + 1;
    const todayDay = _dayAt(program, tdBefore, nDays);

    // Monday of the current week
    const dow       = today.getDay();
    const toMon     = dow === 0 ? -6 : 1 - dow;
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() + toMon);

    // Training days before the start of this week
    const tdBeforeWeek = _countTrainingDaysBetween(startDate, weekStart, trainingNums);

    // Build 7-day strip
    let weekTrainCount = 0;
    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const d    = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const dNum = d.getDay();
      const active_day = trainingNums.includes(dNum) && d >= startDate;

      let dayName = null;
      if (active_day) {
        const idx = (tdBeforeWeek + weekTrainCount) % nDays;
        dayName = _dayAt(program, tdBeforeWeek + weekTrainCount, nDays)?.name || `Day ${idx + 1}`;
        weekTrainCount++;
      }

      weekDays.push({
        date:        d,
        abbr:        WEEKDAY_ABBR[dNum],
        isTraining:  active_day,
        dayName,
        isToday:     d.getTime() === today.getTime(),
        isPast:      d < today,
      });
    }

    return {
      program,
      isTodayTraining: isTrain,
      todayDayName:    todayDay?.name || `Day ${todayIdx + 1}`,
      weekNum:         Math.max(1, weekNum),
      weekCount,
      phase:           weekCount > 1 ? _phaseFor(program, weekNum) : '',
      weekDays,
      totalCompleted:  tdBefore,
    };
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  /** Shorten long day names for the narrow split strip cells. */
  function _short(name) {
    if (!name) return '';
    // "Upper Body A" → "Upper A"  |  "Push Day 1" → "Push 1"  |  short names untouched
    return name
      .replace(/\s*\([^)]*\)/g, '')
      .replace(/\b(body|day)\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 10);
  }

  function renderTodayProgramCard() {
    const el = document.getElementById('todayProgramCard');
    if (!el) return;

    const info = _buildInfo();
    if (!info) { el.innerHTML = ''; return; }

    const { program, isTodayTraining, todayDayName, weekNum, weekCount, phase, weekDays } = info;

    // Weekly split strip
    const strip = weekDays.map(d => {
      const cls = ['tpc-split-cell'];
      if (d.isToday)                 cls.push('tpc-split-cell--today');
      if (d.isPast && d.isTraining)  cls.push('tpc-split-cell--done');
      if (!d.isTraining)             cls.push('tpc-split-cell--rest');

      return `
        <div class="${cls.join(' ')}">
          <span class="tpc-split-abbr">${d.abbr}</span>
          <span class="tpc-split-name">${d.isTraining ? _short(d.dayName) : '–'}</span>
          ${d.isToday ? '<span class="tpc-split-dot"></span>' : ''}
        </div>`;
    }).join('');

    el.innerHTML = `
      <div class="tpc-card">
        <div class="tpc-header">
          <span class="tpc-eyebrow">📅 Today's Session</span>
          <span class="tpc-week-badge">${weekCount > 1 ? `Week ${weekNum} of ${weekCount}` : `Week ${weekNum}`}</span>
        </div>

        <div class="tpc-main">
          ${isTodayTraining
            ? `<span class="tpc-day-name">${todayDayName}</span>`
            : `<span class="tpc-day-name tpc-day-name--rest">Rest Day 💤</span>`
          }
          <span class="tpc-program-name">${program.name}${phase ? ` · ${phase}` : ''}</span>
        </div>

        <div class="tpc-strip">${strip}</div>
      </div>`;
  }

  /** Today's program day name (e.g. "Push Day"), or null on a rest day / no active program. */
  function getTodayWorkoutName() {
    try {
      const info = _buildInfo();
      return info && info.isTodayTraining ? info.todayDayName : null;
    } catch {
      return null;
    }
  }

  window.renderTodayProgramCard = renderTodayProgramCard;
  window.getTodayWorkoutName = getTodayWorkoutName;
})();
