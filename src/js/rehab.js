/* =============================================================
   REHAB & INJURY TRACKING
   Injury log, preset rehab routines, AI rehab generation,
   and exercise-level warnings for the Log tab.
   ============================================================= */

(function () {
  'use strict';

  const _u = () => window.currentUser || localStorage.getItem('fitnessAppUser') || 'anon';
  const INJURIES_KEY = () => 'injuries_' + _u();
  const REHAB_LOG_KEY = () => 'rehabLog_' + _u();

  // ── Body part → affected exercises mapping ──────────────────
  const BODY_MAP = {
    shoulder:  ['overhead press','military press','lateral raise','front raise','shoulder press','arnold press','face pull','upright row'],
    chest:     ['bench press','incline press','dumbbell press','chest fly','push up','pushup','dips','cable fly'],
    back:      ['deadlift','barbell row','pull up','pullup','lat pulldown','seated row','t-bar row','chin up'],
    knee:      ['squat','leg press','lunge','leg extension','leg curl','hack squat','step up','split squat','front squat'],
    hip:       ['squat','deadlift','hip thrust','lunge','leg press','good morning','split squat','romanian deadlift'],
    ankle:     ['squat','calf raise','lunge','box jump','jump squat','step up'],
    elbow:     ['bench press','skull crusher','tricep extension','curl','bicep curl','close grip bench','overhead press'],
    wrist:     ['bench press','overhead press','curl','deadlift','front squat','clean'],
    'lower back': ['deadlift','squat','barbell row','good morning','romanian deadlift','bent over row'],
    neck:      ['overhead press','shrug','upright row'],
    hamstring: ['deadlift','romanian deadlift','leg curl','good morning','stiff leg deadlift'],
    quad:      ['squat','leg press','leg extension','lunge','hack squat','front squat','step up'],
    calf:      ['calf raise','box jump','jump squat'],
    bicep:     ['curl','bicep curl','chin up','pull up','barbell row'],
    tricep:    ['bench press','overhead press','skull crusher','tricep extension','dips','close grip bench'],
    forearm:   ['deadlift','curl','barbell row','farmer walk'],
    glute:     ['squat','hip thrust','deadlift','lunge','cable kickback','glute bridge'],
  };

  // ── Injury types ────────────────────────────────────────────
  const INJURY_TYPES = ['strain','sprain','tendinitis','bursitis','impingement','tear','fracture','general pain','other'];

  // ── Preset rehab routines ───────────────────────────────────
  const REHAB_LIBRARY = {
    shoulder: [
      { name: 'Band Pull-Apart', sets: 3, reps: 15, detail: 'Hold band at shoulder width, pull apart squeezing shoulder blades.' },
      { name: 'Face Pull', sets: 3, reps: 12, detail: 'Cable at face height, pull to ears with elbows high.' },
      { name: 'External Rotation', sets: 3, reps: 12, detail: 'Elbow at 90° against side, rotate forearm outward with light band.' },
      { name: 'Wall Slide', sets: 2, reps: 10, detail: 'Back flat on wall, slide arms up overhead keeping contact.' },
    ],
    knee: [
      { name: 'Terminal Knee Extension', sets: 3, reps: 15, detail: 'Band behind knee, straighten leg against resistance.' },
      { name: 'Wall Sit', sets: 3, hold: '30s', detail: 'Back flat on wall, knees at 90°, hold position.' },
      { name: 'Step Down', sets: 3, reps: 10, detail: 'Stand on step, slowly lower opposite foot to ground.' },
      { name: 'Straight Leg Raise', sets: 3, reps: 12, detail: 'Lie flat, lock knee, raise leg 45°.' },
    ],
    'lower back': [
      { name: 'Bird Dog', sets: 3, reps: 10, detail: 'Extend opposite arm and leg from all fours, hold 3s.' },
      { name: 'Dead Bug', sets: 3, reps: 10, detail: 'On back, extend opposite arm and leg while keeping lower back flat.' },
      { name: 'Cat-Cow', sets: 2, reps: 12, detail: 'Alternate between arching and rounding spine on all fours.' },
      { name: 'Glute Bridge', sets: 3, reps: 12, detail: 'On back, drive hips up squeezing glutes, hold 2s at top.' },
    ],
    hip: [
      { name: '90/90 Hip Switch', sets: 2, reps: 10, detail: 'Sit with both legs at 90°, rotate side to side.' },
      { name: 'Clamshell', sets: 3, reps: 15, detail: 'Side-lying, knees bent, open top knee like a clamshell.' },
      { name: 'Hip Flexor Stretch', sets: 2, hold: '45s', detail: 'Half-kneeling, drive hips forward gently.' },
      { name: 'Fire Hydrant', sets: 3, reps: 12, detail: 'All fours, lift knee out to side keeping 90° bend.' },
    ],
    elbow: [
      { name: 'Wrist Extensor Stretch', sets: 3, hold: '30s', detail: 'Arm out, palm down, pull fingers back with other hand.' },
      { name: 'Wrist Flexor Stretch', sets: 3, hold: '30s', detail: 'Arm out, palm up, pull fingers down with other hand.' },
      { name: 'Eccentric Wrist Curl', sets: 3, reps: 12, detail: 'Light dumbbell, slowly lower wrist down over edge of surface.' },
      { name: 'Towel Squeeze', sets: 3, hold: '15s', detail: 'Roll towel, squeeze firmly for 15 seconds.' },
    ],
    chest: [
      { name: 'Doorway Stretch', sets: 3, hold: '30s', detail: 'Arm on door frame at 90°, lean through gently.' },
      { name: 'Band Chest Fly', sets: 3, reps: 15, detail: 'Light band, controlled fly motion, focus on stretch.' },
      { name: 'Wall Push-Up', sets: 3, reps: 12, detail: 'Hands on wall, controlled push-up motion.' },
      { name: 'Foam Roll Thoracic', sets: 1, hold: '60s', detail: 'Roll upper back on foam roller, arms crossed.' },
    ],
    ankle: [
      { name: 'Ankle Alphabet', sets: 2, reps: 1, detail: 'Trace the alphabet with your toe in the air.' },
      { name: 'Calf Raise (Slow)', sets: 3, reps: 15, detail: '3 seconds up, 3 seconds down, full range.' },
      { name: 'Towel Scrunch', sets: 3, reps: 15, detail: 'Sit, place towel on floor, scrunch with toes.' },
      { name: 'Single Leg Balance', sets: 3, hold: '30s', detail: 'Stand on injured leg, eyes open then closed.' },
    ],
  };

  // ── Storage ─────────────────────────────────────────────────

  function getInjuries() {
    try { return JSON.parse(localStorage.getItem(INJURIES_KEY()) || '[]'); } catch { return []; }
  }
  function saveInjuries(list) { localStorage.setItem(INJURIES_KEY(), JSON.stringify(list)); }

  function getRehabLog() {
    try { return JSON.parse(localStorage.getItem(REHAB_LOG_KEY()) || '[]'); } catch { return []; }
  }
  function saveRehabLog(list) { localStorage.setItem(REHAB_LOG_KEY(), JSON.stringify(list)); }

  // ── Injury CRUD ─────────────────────────────────────────────

  function addInjury(data) {
    const injuries = getInjuries();
    injuries.unshift({
      id: 'inj_' + Date.now().toString(36),
      bodyPart: data.bodyPart,
      type: data.type || 'general pain',
      severity: data.severity || 3,
      date: data.date || new Date().toISOString().slice(0, 10),
      notes: data.notes || '',
      status: 'active',
      createdAt: new Date().toISOString(),
    });
    saveInjuries(injuries);
  }

  function updateInjuryStatus(id, status) {
    const injuries = getInjuries();
    const inj = injuries.find(i => i.id === id);
    if (inj) {
      inj.status = status;
      if (status === 'resolved') inj.resolvedAt = new Date().toISOString();
    }
    saveInjuries(injuries);
  }

  function deleteInjury(id) {
    saveInjuries(getInjuries().filter(i => i.id !== id));
  }

  // ── Rehab routine for a body part ───────────────────────────

  function getRehabRoutine(bodyPart) {
    const key = bodyPart.toLowerCase();
    return REHAB_LIBRARY[key] || REHAB_LIBRARY.shoulder;
  }

  function logRehabSession(injuryId) {
    const log = getRehabLog();
    log.unshift({ injuryId, date: new Date().toISOString(), ts: Date.now() });
    saveRehabLog(log);
  }

  function rehabSessionsThisWeek(injuryId) {
    const log = getRehabLog();
    const weekAgo = Date.now() - 7 * 86400000;
    return log.filter(e => e.injuryId === injuryId && e.ts > weekAgo).length;
  }

  // ── Check if exercise conflicts with active injuries ────────

  function getExerciseWarnings(exerciseName) {
    if (!exerciseName) return [];
    const name = exerciseName.toLowerCase();
    const injuries = getInjuries().filter(i => i.status === 'active' || i.status === 'recovering');
    const warnings = [];
    injuries.forEach(inj => {
      const part = inj.bodyPart.toLowerCase();
      const affected = BODY_MAP[part] || [];
      if (affected.some(ex => name.includes(ex) || ex.includes(name))) {
        warnings.push(inj);
      }
    });
    return warnings;
  }

  // ── Render Rehab sub-tab ────────────────────────────────────

  function renderRehabTab(container) {
    if (!container) return;
    const injuries = getInjuries();
    const active = injuries.filter(i => i.status === 'active');
    const recovering = injuries.filter(i => i.status === 'recovering');
    const resolved = injuries.filter(i => i.status === 'resolved');

    let html = '';

    // Log new injury form
    html += '<div class="rehab-card"><h3>Log Injury</h3>'
      + '<div class="rehab-form-grid">'
      + '<label>Body Part<select id="rehabBodyPart">'
      + Object.keys(BODY_MAP).map(p => '<option value="' + p + '">' + p.charAt(0).toUpperCase() + p.slice(1) + '</option>').join('')
      + '</select></label>'
      + '<label>Type<select id="rehabType">'
      + INJURY_TYPES.map(t => '<option value="' + t + '">' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>').join('')
      + '</select></label>'
      + '<label>Date<input type="date" id="rehabDate" value="' + new Date().toISOString().slice(0, 10) + '"></label>'
      + '<label class="rehab-form-full">Notes<input type="text" id="rehabNotes" placeholder="How it happened…"></label>'
      + '</div>'
      + '<div class="rehab-severity-row">'
      + '<span class="rehab-severity-label">Severity</span>'
      + '<div class="rehab-severity-pills" id="rehabSevPills">'
      + [1,2,3,4,5].map(n => '<button class="rehab-sev-pill sev-' + n + (n === 3 ? ' active' : '') + '" data-sev="' + n + '">' + n + '</button>').join('')
      + '</div></div>'
      + '<button class="rehab-save-btn" id="rehabSaveBtn">+ Log Injury</button>'
      + '</div>';

    // Active injuries with rehab routines
    if (active.length || recovering.length) {
      html += '<div class="rehab-card"><h3>Active Injuries (' + (active.length + recovering.length) + ')</h3>';
      [...active, ...recovering].forEach(inj => {
        html += renderInjuryItem(inj);
      });
      html += '</div>';
    }

    // Resolved
    if (resolved.length) {
      html += '<div class="rehab-card"><h3>Resolved (' + resolved.length + ')</h3>';
      resolved.slice(0, 5).forEach(inj => {
        html += renderInjuryItem(inj, true);
      });
      html += '</div>';
    }

    if (!injuries.length) {
      html += '<div class="rehab-empty">No injuries logged. Stay healthy! 💪</div>';
    }

    container.innerHTML = html;

    // Wire events
    container.querySelector('#rehabSevPills')?.addEventListener('click', e => {
      const pill = e.target.closest('.rehab-sev-pill');
      if (!pill) return;
      container.querySelectorAll('.rehab-sev-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
    });

    container.querySelector('#rehabSaveBtn')?.addEventListener('click', () => {
      const bodyPart = container.querySelector('#rehabBodyPart')?.value;
      const type = container.querySelector('#rehabType')?.value;
      const date = container.querySelector('#rehabDate')?.value;
      const notes = container.querySelector('#rehabNotes')?.value;
      const sevPill = container.querySelector('.rehab-sev-pill.active');
      const severity = sevPill ? Number(sevPill.dataset.sev) : 3;
      addInjury({ bodyPart, type, severity, date, notes });
      if (typeof nativeToast === 'function') nativeToast('Injury logged', 'success');
      renderRehabTab(container);
    });

    // Delegated action buttons
    container.addEventListener('click', e => {
      const btn = e.target.closest('[data-rehab-action]');
      if (!btn) return;
      const action = btn.dataset.rehabAction;
      const id = btn.dataset.injId;
      if (action === 'recover') updateInjuryStatus(id, 'recovering');
      else if (action === 'resolve') updateInjuryStatus(id, 'resolved');
      else if (action === 'reactivate') updateInjuryStatus(id, 'active');
      else if (action === 'delete') deleteInjury(id);
      else if (action === 'log-rehab') {
        logRehabSession(id);
        if (typeof nativeToast === 'function') nativeToast('Rehab session logged!', 'success');
      }
      else if (action === 'ai-rehab') {
        generateAiRehab(id, container);
        return;
      }
      renderRehabTab(container);
    });
  }

  function renderInjuryItem(inj, compact) {
    const sevDots = [1,2,3,4,5].map(n =>
      '<div class="injury-sev-dot' + (n <= inj.severity ? ' filled-' + n : '') + '"></div>'
    ).join('');

    const routine = getRehabRoutine(inj.bodyPart);
    const sessionsWk = rehabSessionsThisWeek(inj.id);
    const daysSince = Math.floor((Date.now() - new Date(inj.date).getTime()) / 86400000);

    let actions = '';
    if (!compact) {
      if (inj.status === 'active') {
        actions = '<button class="injury-action-btn" data-rehab-action="recover" data-inj-id="' + inj.id + '">Mark Recovering</button>'
          + '<button class="injury-action-secondary" data-rehab-action="resolve" data-inj-id="' + inj.id + '">Resolved</button>'
          + '<button class="injury-action-secondary" data-rehab-action="delete" data-inj-id="' + inj.id + '">Delete</button>';
      } else if (inj.status === 'recovering') {
        actions = '<button class="injury-action-btn" data-rehab-action="resolve" data-inj-id="' + inj.id + '">Mark Resolved</button>'
          + '<button class="injury-action-secondary" data-rehab-action="reactivate" data-inj-id="' + inj.id + '">Back to Active</button>';
      }
    } else {
      actions = '<button class="injury-action-secondary" data-rehab-action="reactivate" data-inj-id="' + inj.id + '">Reactivate</button>'
        + '<button class="injury-action-secondary" data-rehab-action="delete" data-inj-id="' + inj.id + '">Delete</button>';
    }

    let routineHtml = '';
    if (!compact && (inj.status === 'active' || inj.status === 'recovering') && routine.length) {
      routineHtml = '<div class="rehab-routine-card">'
        + '<div class="rehab-routine-title">' + inj.bodyPart.charAt(0).toUpperCase() + inj.bodyPart.slice(1) + ' Rehab Protocol</div>'
        + '<div class="rehab-routine-meta">' + routine.length + ' exercises · ' + sessionsWk + ' sessions this week</div>'
        + '<div class="rehab-exercise-list">'
        + routine.map(ex => '<div class="rehab-exercise">'
          + '<span class="rehab-ex-name">' + ex.name + '</span>'
          + '<span class="rehab-ex-detail">' + (ex.hold || ex.sets + '×' + ex.reps) + '</span>'
          + '</div>').join('')
        + '</div>'
        + '<button class="rehab-log-btn" data-rehab-action="log-rehab" data-inj-id="' + inj.id + '">✅ Log Rehab Session</button>'
        + '</div>'
        + '<button class="rehab-ai-btn" data-rehab-action="ai-rehab" data-inj-id="' + inj.id + '">🧠 Get AI Rehab Plan</button>';
    }

    return '<div class="injury-item">'
      + '<div class="injury-header">'
      + '<span class="injury-title">' + inj.bodyPart.charAt(0).toUpperCase() + inj.bodyPart.slice(1) + ' — ' + inj.type + '</span>'
      + '<span class="injury-status ' + inj.status + '">' + inj.status + '</span>'
      + '</div>'
      + '<div class="injury-meta">' + daysSince + ' days ago · ' + inj.date + '</div>'
      + '<div class="injury-severity-bar">' + sevDots + '</div>'
      + (inj.notes ? '<div class="injury-notes">' + inj.notes + '</div>' : '')
      + routineHtml
      + '<div class="injury-actions">' + actions + '</div>'
      + '</div>';
  }

  // ── AI Rehab generation ─────────────────────────────────────

  async function generateAiRehab(injuryId, container) {
    const injuries = getInjuries();
    const inj = injuries.find(i => i.id === injuryId);
    if (!inj) return;

    const serverUrl = window.SERVER_URL || '';
    const archetype = (typeof getUserArchetype === 'function') ? getUserArchetype() : 'hybrid';

    // Show loading
    const btn = container.querySelector('[data-rehab-action="ai-rehab"][data-inj-id="' + injuryId + '"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }

    try {
      const resp = await fetch(serverUrl + '/api/ai/rehab-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bodyPart: inj.bodyPart,
          injuryType: inj.type,
          severity: inj.severity,
          daysSinceInjury: Math.floor((Date.now() - new Date(inj.date).getTime()) / 86400000),
          status: inj.status,
          archetype,
        }),
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const data = await resp.json();

      // Show AI result
      const aiCard = document.createElement('div');
      aiCard.className = 'rehab-ai-card';
      aiCard.innerHTML = '<div class="rehab-ai-header">🧠 AI Rehab Recommendation</div>'
        + '<div class="rehab-ai-body">' + (data.plan || 'No recommendation available.') + '</div>';
      btn?.parentElement?.insertBefore(aiCard, btn);
      if (btn) btn.style.display = 'none';
    } catch {
      if (btn) { btn.disabled = false; btn.textContent = '🧠 Get AI Rehab Plan'; }
      if (typeof nativeToast === 'function') nativeToast('Could not generate plan — check connection', 'error');
    }
  }

  // ── Exercise warning banner for Log tab ─────────────────────

  function renderInjuryWarning(exerciseName) {
    const warnings = getExerciseWarnings(exerciseName);
    const banner = document.getElementById('injuryWarnBanner');
    if (!warnings.length) {
      if (banner) banner.style.display = 'none';
      return;
    }
    const parts = [...new Set(warnings.map(w => w.bodyPart))];
    const msg = '⚠️ Active injury: <strong>' + parts.join(', ') + '</strong> — consider modifying or substituting this exercise.';
    if (banner) {
      banner.innerHTML = msg;
      banner.style.display = '';
    }
  }

  // ── Expose globally ─────────────────────────────────────────

  window.getActiveInjuries = () => getInjuries().filter(i => i.status === 'active' || i.status === 'recovering');
  window.getExerciseWarnings = getExerciseWarnings;
  window.renderInjuryWarning = renderInjuryWarning;
  window.renderRehabTab = renderRehabTab;
})();
