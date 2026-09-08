// =============================================================
// ARCHETYPE FEATURE SCRIPTS
// Macro rings, progress photo upload, WOD interval timer,
// powerlifting attempt sheet, weigh-in reminder, step widget.
// =============================================================

// ── Helpers ───────────────────────────────────────────────────

/** Tiny Web Audio beep — no external files required. */
function _beep(freq = 880, duration = 0.18, gain = 0.3) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.connect(g);
    g.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = 'sine';
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch (_) {}
}

function _pad(n) { return String(n).padStart(2, '0'); }

function _fmt(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${_pad(m)}:${_pad(s)}`;
}

// ── Macro progress rings ──────────────────────────────────────

(function initMacroRings() {
  const RING_CONFIGS = [
    { barId: 'calsBar',    fillId: 'calsRingFill',    valId: 'calsRingValue',    r: 44 },
    { barId: 'proteinBar', fillId: 'proteinRingFill',  valId: 'proteinRingValue', r: 37 },
    { barId: 'carbBar',    fillId: 'carbsRingFill',    valId: 'carbsRingValue',   r: 37 },
    { barId: 'fatBar',     fillId: 'fatRingFill',      valId: 'fatRingValue',     r: 37 },
  ];

  function syncRing({ barId, fillId, valId, r }) {
    const bar  = document.getElementById(barId);
    const fill = document.getElementById(fillId);
    const val  = document.getElementById(valId);
    if (!bar || !fill || !val) return;
    const pct = bar.max > 0 ? Math.min(bar.value / bar.max, 1) : 0;
    const c = 2 * Math.PI * r;
    fill.style.strokeDasharray  = c;
    fill.style.strokeDashoffset = c * (1 - pct);
    val.textContent = Math.round(bar.value);
  }

  const VIS_BAR_CONFIGS = [
    { barId: 'calsBar',    fillId: 'calsVisBar' },
    { barId: 'proteinBar', fillId: 'proteinVisBar' },
    { barId: 'carbBar',    fillId: 'carbsVisBar' },
    { barId: 'fatBar',     fillId: 'fatVisBar' },
  ];

  function syncVisBar({ barId, fillId }) {
    const bar  = document.getElementById(barId);
    const fill = document.getElementById(fillId);
    if (!bar || !fill) return;
    const pct = bar.max > 0 ? Math.min((bar.value / bar.max) * 100, 100) : 0;
    fill.style.width = pct + '%';
  }

  function syncAll() {
    RING_CONFIGS.forEach(syncRing);
    VIS_BAR_CONFIGS.forEach(syncVisBar);
  }

  // Poll at 300 ms so we don't need to touch every JS call that sets bar values.
  // Interval is paused when the app is backgrounded to avoid draining battery.
  document.addEventListener('DOMContentLoaded', () => {
    let _pollId = setInterval(syncAll, 300);
    syncAll();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearInterval(_pollId);
        _pollId = 0;
      } else if (!_pollId) {
        _pollId = setInterval(syncAll, 300);
        syncAll(); // immediate sync on resume
      }
    });
  });

  // Expose for callers that update bar values programmatically
  window.syncMacroRings = syncAll;
})();

// ── Progress photo upload ─────────────────────────────────────

(function initPhotoUpload() {
  const SLOTS = ['front', 'side', 'back'];

  function _storageKey(slot) {
    const user = window.currentUser || localStorage.getItem('fitnessAppUser') || 'guest';
    return `progressPhoto_${user}_${slot}`;
  }

  function _loadSaved() {
    SLOTS.forEach(slot => {
      const saved = localStorage.getItem(_storageKey(slot));
      if (!saved) return;
      const preview = document.getElementById(`photoPreview_${slot}`);
      if (preview) {
        preview.src = saved;
        preview.style.display = 'block';
        preview.parentElement?.querySelector('.photo-placeholder')?.remove();
        preview.parentElement?.classList.add('has-photo');
      }
    });
  }

  function _onFileChange(slot, input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = e.target.result;
      localStorage.setItem(_storageKey(slot), data);
      const preview = document.getElementById(`photoPreview_${slot}`);
      if (preview) {
        preview.src = data;
        preview.style.display = 'block';
        preview.parentElement?.querySelector('.photo-placeholder')?.remove();
        preview.parentElement?.classList.add('has-photo');
      }
      // Keep the hidden text input in sync for backward compat with saveWeeklyCheckIn
      const legacyInput = document.getElementById(`checkIn${slot.charAt(0).toUpperCase() + slot.slice(1)}PhotoInput`);
      if (legacyInput) legacyInput.value = data;
    };
    reader.readAsDataURL(file);
  }

  document.addEventListener('DOMContentLoaded', () => {
    SLOTS.forEach(slot => {
      const input = document.getElementById(`photoFile_${slot}`);
      if (input) input.addEventListener('change', () => _onFileChange(slot, input));

      const slotEl = document.getElementById(`photoSlot_${slot}`);
      if (slotEl) {
        slotEl.addEventListener('click', () => {
          document.getElementById(`photoFile_${slot}`)?.click();
        });
      }
    });
    _loadSaved();
  });

  // Reload when the user changes (login)
  window.addEventListener('traininglog:user-changed', _loadSaved);
  window.reloadProgressPhotos = _loadSaved;
})();

// ── WOD Interval Timer ────────────────────────────────────────

(function initWodTimer() {
  let _format  = 'amrap'; // amrap | emom | tabata | fortime
  let _timer   = null;
  let _running = false;
  let _elapsed = 0;      // seconds elapsed (for countup)
  let _remaining = 0;    // seconds remaining (for countdown)
  let _totalDuration = 0;
  let _round = 0;        // current round / interval
  let _tabataPhase = 'work'; // 'work' | 'rest'

  const FORMAT_LABELS = {
    amrap:   'AMRAP',
    emom:    'EMOM',
    tabata:  'TABATA',
    fortime: 'For Time',
  };

  function _getEl(id) { return document.getElementById(id); }

  function _getConfig() {
    return {
      duration: parseInt(_getEl('wodDuration')?.value || 20) * 60,
      rounds:   parseInt(_getEl('wodRounds')?.value   || 8),
      work:     parseInt(_getEl('wodWork')?.value     || 20),
      rest:     parseInt(_getEl('wodRest')?.value     || 10),
    };
  }

  function _renderConfig() {
    const cfg = [
      { id: 'wodConfigDuration', show: ['amrap', 'emom', 'fortime'] },
      { id: 'wodConfigRounds',   show: ['emom'] },
      { id: 'wodConfigWork',     show: ['tabata'] },
      { id: 'wodConfigRest',     show: ['tabata'] },
    ];
    cfg.forEach(({ id, show }) => {
      const el = _getEl(id);
      if (el) el.style.display = show.includes(_format) ? '' : 'none';
    });
  }

  function _updateDisplay(clock, phase) {
    const clockEl = _getEl('wodClock');
    const phaseEl = _getEl('wodPhase');
    if (clockEl) clockEl.textContent = clock;
    if (phaseEl) phaseEl.textContent = phase || '';
  }

  function _tick() {
    const cfg = _getConfig();

    if (_format === 'amrap' || _format === 'fortime') {
      if (_format === 'amrap') {
        _remaining = Math.max(0, _totalDuration - _elapsed);
        _updateDisplay(_fmt(_remaining), `Round ${_round + 1}`);
        if (_remaining <= 3 && _remaining > 0) _beep(440, 0.3);
        if (_remaining === 0) { _stop(); _beep(880, 0.5); return; }
      } else {
        _elapsed++;
        _updateDisplay(_fmt(_elapsed), 'GO!');
      }
      _elapsed++;
    }

    else if (_format === 'emom') {
      _elapsed++;
      const intervalLen = 60;
      const secondsIntoMinute = _elapsed % intervalLen;
      const minutesDone = Math.floor(_elapsed / intervalLen);
      const remaining = intervalLen - secondsIntoMinute;

      if (secondsIntoMinute === 0 && minutesDone > 0) {
        _round = minutesDone;
        _beep(880, 0.25);
      }
      if (remaining <= 3 && remaining > 0) _beep(660, 0.1);

      const totalRounds = cfg.rounds;
      if (minutesDone >= totalRounds) { _stop(); _beep(880, 0.6); return; }

      _updateDisplay(_fmt(remaining), `Minute ${minutesDone + 1} / ${totalRounds}`);
    }

    else if (_format === 'tabata') {
      _elapsed++;
      const phaseLen = _tabataPhase === 'work' ? cfg.work : cfg.rest;
      const secondsIntoPhase = _elapsed % phaseLen;
      const phasesCompleted = Math.floor(_elapsed / phaseLen);

      if (secondsIntoPhase === 0 && phasesCompleted > 0) {
        _tabataPhase = _tabataPhase === 'work' ? 'rest' : 'work';
        if (_tabataPhase === 'work') _round++;
        _beep(_tabataPhase === 'work' ? 880 : 440, 0.2);
      }

      if (_round >= cfg.rounds) { _stop(); _beep(880, 0.5); return; }

      const remaining = phaseLen - secondsIntoPhase;
      const phaseLabel = _tabataPhase === 'work' ? '🔥 WORK' : '😮‍💨 REST';
      _updateDisplay(_fmt(remaining), `${phaseLabel} — Round ${_round + 1} / ${cfg.rounds}`);
    }
  }

  function _start() {
    if (_running) return;
    const cfg = _getConfig();
    _totalDuration = cfg.duration;

    if (_elapsed === 0) {
      // Fresh start
      _round = 0;
      _tabataPhase = 'work';
      if (_format === 'amrap') {
        _remaining = _totalDuration;
        _updateDisplay(_fmt(_remaining), 'GO!');
      }
    }

    _running = true;
    _timer = setInterval(_tick, 1000);
    _beep(660, 0.15);

    const startBtn = _getEl('wodStartBtn');
    const pauseBtn = _getEl('wodPauseBtn');
    if (startBtn) startBtn.style.display = 'none';
    if (pauseBtn) pauseBtn.style.display = '';
  }

  function _pause() {
    _running = false;
    clearInterval(_timer);
    const startBtn = _getEl('wodStartBtn');
    const pauseBtn = _getEl('wodPauseBtn');
    if (startBtn) { startBtn.style.display = ''; startBtn.textContent = 'Resume'; }
    if (pauseBtn) pauseBtn.style.display = 'none';
  }

  function _stop() {
    _running = false;
    _elapsed = 0;
    _round = 0;
    _tabataPhase = 'work';
    clearInterval(_timer);
    const startBtn = _getEl('wodStartBtn');
    const pauseBtn = _getEl('wodPauseBtn');
    if (startBtn) { startBtn.style.display = ''; startBtn.textContent = 'Start'; }
    if (pauseBtn) pauseBtn.style.display = 'none';
    _updateDisplay('00:00', 'Ready');
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.wod-format-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _stop();
        _format = btn.dataset.wodFormat;
        document.querySelectorAll('.wod-format-btn').forEach(b => b.classList.toggle('active', b === btn));
        _renderConfig();
        _updateDisplay('00:00', FORMAT_LABELS[_format]);
      });
    });

    _getEl('wodStartBtn')?.addEventListener('click', _start);
    _getEl('wodPauseBtn')?.addEventListener('click', _pause);
    _getEl('wodResetBtn')?.addEventListener('click', _stop);

    _renderConfig();
    _updateDisplay('00:00', 'AMRAP');
  });
})();

// ── Powerlifting: attempt selection + weigh-in reminder ───────

(function initAttemptSheet() {
  const LIFTS = ['squat', 'bench', 'deadlift'];
  const ATTEMPTS = ['opener', 'second', 'third'];
  let _statuses = {}; // { squat_opener: 'pending'|'good'|'no-lift', ... }

  function _statusKey(lift, attempt) { return `${lift}_${attempt}`; }

  function _getStorageKey() {
    const user = window.currentUser || localStorage.getItem('fitnessAppUser') || 'guest';
    return `plAttempts_${user}`;
  }

  function _save() {
    const data = {};
    LIFTS.forEach(lift => {
      ATTEMPTS.forEach(attempt => {
        const input = document.getElementById(`attempt_${lift}_${attempt}`);
        data[`${lift}_${attempt}_weight`] = input ? input.value : '';
        data[`${lift}_${attempt}_status`] = _statuses[_statusKey(lift, attempt)] || 'pending';
      });
    });
    localStorage.setItem(_getStorageKey(), JSON.stringify(data));
    _updateTotal();
  }

  function _load() {
    const raw = localStorage.getItem(_getStorageKey());
    if (!raw) { _autofillOpeners(); return; }
    const data = JSON.parse(raw);
    LIFTS.forEach(lift => {
      ATTEMPTS.forEach(attempt => {
        const input = document.getElementById(`attempt_${lift}_${attempt}`);
        if (input) input.value = data[`${lift}_${attempt}_weight`] || '';
        const status = data[`${lift}_${attempt}_status`] || 'pending';
        _statuses[_statusKey(lift, attempt)] = status;
        _applyStatusBtn(lift, attempt, status);
      });
    });
    _updateTotal();
  }

  // Best tested 1RM per lift, read from the 1RM Tracker sub-tab's real
  // storage (plOneRM_<user>, written by saveOneRMEntry() in index.html —
  // this used to point at a "pl1RMHistory" key that tab never wrote to).
  function _bestOneRMByLift() {
    const user = window.currentUser || localStorage.getItem('fitnessAppUser') || 'guest';
    let entries = [];
    try { entries = JSON.parse(localStorage.getItem(`plOneRM_${user}`) || '[]'); } catch (_) { entries = []; }
    const liftKeyMap = { Squat: 'squat', 'Bench Press': 'bench', Deadlift: 'deadlift' };
    const best = {};
    entries.forEach(e => {
      const key = liftKeyMap[e.lift];
      if (!key || !Number.isFinite(e.estimated)) return;
      if (!best[key] || e.estimated > best[key]) best[key] = e.estimated;
    });
    return best;
  }

  // Fills opener/2nd/3rd for every lift with a tested 1RM, using the
  // opener-≈90% / 2nd-is-your-real-1RM / 3rd-held-in-reserve algorithm
  // (src/js/powerlifting-peak-week.js). Only overwrites blank inputs
  // (or inputs already marked good/no-lift keeps its opener status) so
  // it's safe to re-run — used both on first load and from the explicit
  // "Fill from 1RM Tracker" button on the Meet Day tab.
  function _autofillOpeners(force) {
    const bestByLift = _bestOneRMByLift();
    let filledAny = false;
    LIFTS.forEach(lift => {
      const oneRM = bestByLift[lift];
      if (!oneRM) return;
      const suggestion = window.PowerliftingPeakWeek
        ? window.PowerliftingPeakWeek.suggestAttempts(oneRM, 2.5)
        : { opener: Math.floor(oneRM * 0.90 / 2.5) * 2.5, second: null, third: null };
      if (!suggestion) return;

      ATTEMPTS.forEach((attempt, idx) => {
        const value = idx === 0 ? suggestion.opener : idx === 1 ? suggestion.second : suggestion.third;
        if (value == null) return;
        const input = document.getElementById(`attempt_${lift}_${attempt}`);
        if (input && (force || !input.value)) {
          input.value = value;
          filledAny = true;
        }
      });
    });
    _updateTotal();
    return filledAny;
  }

  function fillSuggestedAttempts() {
    const filled = _autofillOpeners(true);
    _save();
    if (!filled && typeof window.showToast === 'function') {
      window.showToast('Log a 1RM for at least one lift on the 1RM Tracker tab first.', 'warn');
    } else if (typeof window.showToast === 'function') {
      window.showToast('Filled openers/2nd/3rd from your best tested 1RMs.');
    }
  }

  function clearAttemptSheet() {
    LIFTS.forEach(lift => {
      ATTEMPTS.forEach(attempt => {
        const input = document.getElementById(`attempt_${lift}_${attempt}`);
        if (input) input.value = '';
        _statuses[_statusKey(lift, attempt)] = 'pending';
        _applyStatusBtn(lift, attempt, 'pending');
      });
    });
    localStorage.removeItem(_getStorageKey());
    _updateTotal();
    if (typeof window.showToast === 'function') window.showToast('Attempt sheet cleared.');
  }

  function _cycleStatus(lift, attempt) {
    const key = _statusKey(lift, attempt);
    const cycle = { pending: 'good', good: 'no-lift', 'no-lift': 'pending' };
    _statuses[key] = cycle[_statuses[key] || 'pending'];
    _applyStatusBtn(lift, attempt, _statuses[key]);
    _save();
  }

  function _applyStatusBtn(lift, attempt, status) {
    const btn = document.getElementById(`status_${lift}_${attempt}`);
    if (!btn) return;
    btn.className = `attempt-status-btn ${status}`;
    const labels = { pending: '— Pending', good: '✓ Good lift', 'no-lift': '✗ No lift' };
    btn.textContent = labels[status] || '— Pending';
  }

  function _updateTotal() {
    const el = document.getElementById('attemptTotal');
    if (!el) return;
    const unit = localStorage.getItem('defaultWeightUnit') || 'kg';

    if (window.PowerliftingPeakWeek) {
      // Real IPF scoring: a 0/3 lift (all 3 attempts missed) zeroes the
      // whole meet total, not just that lift — the naive per-lift-best
      // sum below doesn't know that.
      const attempts = {};
      LIFTS.forEach(lift => {
        attempts[lift] = ATTEMPTS.map(attempt => ({
          weight: parseFloat(document.getElementById(`attempt_${lift}_${attempt}`)?.value) || 0,
          status: _statuses[_statusKey(lift, attempt)] || 'pending'
        }));
      });
      const result = window.PowerliftingPeakWeek.computeMeetResult(attempts);
      if (result.bombedOut) { el.textContent = 'Bombed out'; return; }
      el.textContent = result.total != null ? `${result.total} ${unit}` : `— ${unit}`;
      return;
    }

    // Fallback if powerlifting-peak-week.js hasn't loaded for some reason.
    let total = 0;
    LIFTS.forEach(lift => {
      let best = 0;
      ATTEMPTS.forEach(attempt => {
        const status = _statuses[_statusKey(lift, attempt)] || 'pending';
        const input  = document.getElementById(`attempt_${lift}_${attempt}`);
        const w = parseFloat(input?.value) || 0;
        if (status === 'good' && w > best) best = w;
      });
      total += best;
    });
    el.textContent = total > 0 ? `${total} ${unit}` : `— ${unit}`;
  }

  function _renderWeighInAlert() {
    const alertEl = document.getElementById('weighInAlert');
    if (!alertEl) return;
    const meetDetails = JSON.parse(localStorage.getItem('plMeetDetails') || 'null');
    if (!meetDetails?.date) { alertEl.style.display = 'none'; return; }

    const daysOut = Math.ceil((new Date(meetDetails.date) - new Date()) / 86400000);
    if (daysOut <= 0 || daysOut > 14) { alertEl.style.display = 'none'; return; }

    alertEl.style.display = 'flex';
    const weightClass = meetDetails.weightClass || '—';
    alertEl.innerHTML = `
      <span class="weighin-alert-icon">⚖️</span>
      <div>
        <strong>${daysOut === 1 ? 'Weigh-in Tomorrow' : `${daysOut} days to meet`}</strong> —
        target weight class <strong>${weightClass}</strong>.
        ${daysOut <= 3 ? 'Start your water cut protocol now.' : 'Monitor your weight daily.'}
      </div>`;
  }

  document.addEventListener('DOMContentLoaded', () => {
    _load();
    _renderWeighInAlert();

    // Status button clicks (delegated)
    document.getElementById('attemptSheetTable')?.addEventListener('click', e => {
      const btn = e.target.closest('.attempt-status-btn');
      if (!btn) return;
      const [lift, attempt] = btn.id.replace('status_', '').split('_');
      _cycleStatus(lift, attempt);
    });

    // Auto-save on weight input change
    document.getElementById('attemptSheetTable')?.addEventListener('input', () => _save());
  });

  // Re-render weigh-in alert whenever meet prep is saved
  window.addEventListener('traininglog:meet-saved', _renderWeighInAlert);
  window.renderWeighInAlert = _renderWeighInAlert;
  window.fillSuggestedAttempts = fillSuggestedAttempts;
  window.clearAttemptSheet = clearAttemptSheet;
})();

// ── Step tracking widget ──────────────────────────────────────

(function initStepWidget() {
  function _getGoal() {
    const user = window.currentUser || localStorage.getItem('fitnessAppUser') || 'guest';
    const s = JSON.parse(localStorage.getItem(`settings_${user}`) || '{}');
    return s?.profile?.goals?.stepsTarget || 10000;
  }

  function _getTodayKey() { return new Date().toISOString().split('T')[0]; }

  function _getCount() {
    const data = JSON.parse(localStorage.getItem('dailySteps') || '{}');
    return parseInt(data[_getTodayKey()] || 0);
  }

  function _saveCount(count) {
    const data = JSON.parse(localStorage.getItem('dailySteps') || '{}');
    data[_getTodayKey()] = count;
    localStorage.setItem('dailySteps', JSON.stringify(data));
  }

  // Once a wearable is connected via Activity Sync, its step count is
  // authoritative — the manual input is hidden rather than left editable
  // alongside a synced number, avoiding two competing "steps today" values.
  // Flag is written by activity-sync-bridge.js after each successful sync.
  function _isSynced() {
    return localStorage.getItem('activitySyncConnected') === '1';
  }

  function _syncRing(count, goal) {
    const fill = document.getElementById('stepRingFill');
    if (!fill) return;
    const r = 34;
    const c = 2 * Math.PI * r;
    const pct = goal > 0 ? Math.min(count / goal, 1) : 0;
    fill.style.strokeDasharray  = c;
    fill.style.strokeDashoffset = c * (1 - pct);

    const countEl = document.getElementById('stepRingCount');
    if (countEl) countEl.textContent = count >= 1000 ? `${(count / 1000).toFixed(1)}k` : count;

    const goalEl = document.getElementById('stepGoalLabel');
    if (goalEl) goalEl.textContent = `Goal: ${goal.toLocaleString()} steps`;

    const synced = _isSynced();
    const inputRow = document.querySelector('.step-input-row');
    if (inputRow) inputRow.style.display = synced ? 'none' : '';
    const syncedLabel = document.getElementById('stepSyncedLabel');
    if (syncedLabel) syncedLabel.style.display = synced ? '' : 'none';

    const input = document.getElementById('stepCountInput');
    if (input && !synced && !input.matches(':focus')) input.value = count || '';
  }

  function refreshStepWidget() {
    _syncRing(_getCount(), _getGoal());
  }

  document.addEventListener('DOMContentLoaded', () => {
    refreshStepWidget();

    document.getElementById('stepSaveBtn')?.addEventListener('click', () => {
      const input = document.getElementById('stepCountInput');
      const count = parseInt(input?.value) || 0;
      _saveCount(count);
      refreshStepWidget();
    });

    // Refresh when switching to homeTab
    document.addEventListener('traininglog:tab-changed', (e) => {
      if (e.detail?.tab === 'homeTab') refreshStepWidget();
    });
  });

  window.refreshStepWidget = refreshStepWidget;
})();
