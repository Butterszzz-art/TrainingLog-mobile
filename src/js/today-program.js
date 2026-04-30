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

    // Week number (1-based)
    const weekNum = Math.floor((today - startDate) / (7 * 86400000)) + 1;

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
        dayName = program.days[idx]?.name || `Day ${idx + 1}`;
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
      todayDayName:    program.days[todayIdx]?.name || `Day ${todayIdx + 1}`,
      weekNum:         Math.max(1, weekNum),
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

    const { program, isTodayTraining, todayDayName, weekNum, weekDays } = info;

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
          <span class="tpc-week-badge">Week ${weekNum}</span>
        </div>

        <div class="tpc-main">
          ${isTodayTraining
            ? `<span class="tpc-day-name">${todayDayName}</span>`
            : `<span class="tpc-day-name tpc-day-name--rest">Rest Day 💤</span>`
          }
          <span class="tpc-program-name">${program.name}</span>
        </div>

        <div class="tpc-strip">${strip}</div>
      </div>`;
  }

  window.renderTodayProgramCard = renderTodayProgramCard;
})();
