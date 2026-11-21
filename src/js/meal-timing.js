/* =============================================================
   MEAL TIMING — meal times, spacing and the fasting timer
   The logic is meal-timing-core.js (pure, tested). This file:
   - stamps new food log entries with when they were eaten
     (food-database.js addEntry, food-log-tools.js applyChanges,
     coach-meals.js "Ate this");
   - draws the time chip on each meal card (tap: set the time);
   - draws the "Meal timing" card above the meals: the fasting timer or
     eating window, and the day's spacing;
   - the timing sheet: fasting goal on/off and hours, planned meal times
     and reminders, last 7 days;
   - scheduled meals: planned times per meal (set in "Your meals",
     food-database.js) show on the meal cards and as "Next: …" on the
     card; with reminders on, the phone gets a local notification at each
     planned time for the next 7 days (Capacitor LocalNotifications),
     re-planned whenever the food log is drawn so a meal already logged
     today isn't reminded.
   fastingPlan_<user> (synced, cloud-sync.js): { on, hours, startedAt? }
   mealSetup_<user> (synced): { …, times: { breakfast: '08:00' }, remind }
   ============================================================= */

(function () {
  'use strict';

  const MT = () => window.MealTimingCore;
  const Core = () => window.FoodCore;
  const FL = () => window.FoodLog || {};
  const Sheet = () => window.FoodSheet;
  const PLAN_KEY = u => `fastingPlan_${u}`;

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = name => (typeof ICONS !== 'undefined' && ICONS[name]) || ''; // eslint-disable-line no-undef
  const user = () => (window.getActiveUsername && window.getActiveUsername()) || window.currentUser || localStorage.getItem('fitnessAppUser') || '';

  function loadPlan() {
    try { return MT().normalizePlan(JSON.parse(localStorage.getItem(PLAN_KEY(user())))); } catch { return MT().normalizePlan(null); }
  }
  function savePlan(plan) {
    if (!user()) return;
    try { localStorage.setItem(PLAN_KEY(user()), JSON.stringify(MT().normalizePlan(plan))); } catch { /* storage full */ }
  }

  const log = () => (FL().load ? FL().load() : []);
  const today = () => (FL().today ? FL().today() : (globalThis.AppTime?.today() || new Date().toISOString().slice(0, 10)));
  const shownDay = () => (FL().day ? FL().day() : today());
  const mealSetup = () => (FL().mealSetup ? FL().mealSetup() : {});
  const labelOf = m => (Core() && Core().MEAL_LABELS[m]) || m;

  /* ── Stamping new entries ─────────────────────────────────── */

  // `dayEntries`: what's already logged (defaults to the stored log).
  function stamp(entry, dayEntries) {
    if (!MT() || !entry) return entry;
    const list = dayEntries || log().filter(e => e && e.date === entry.date);
    return MT().stampEntry(entry, list, { today: today(), now: Date.now() });
  }

  /* ── Meal card time chip ──────────────────────────────────── */

  function chipHtml(meal, list) {
    if (!MT() || !list || !list.length) return '';
    const day = list[0].date;
    const t = MT().mealTime(list, day, meal);
    const label = (Core() && Core().MEAL_LABELS[meal]) || meal;
    const planned = (mealSetup().times || {})[meal];
    if (t !== null) return `<button type="button" class="mt-chip" data-mt-meal-time="${esc(meal)}" aria-label="${esc(label)} eaten at ${MT().hhmm(t)}: change the time">${MT().hhmm(t)}</button>`;
    return `<button type="button" class="mt-chip is-unset" data-mt-meal-time="${esc(meal)}" aria-label="Set when you ate ${esc(label.toLowerCase())}${planned ? ` (planned ${planned})` : ''}"><span class="ui-icon">${icon('clock')}</span>${planned ? esc(planned) : 'time'}</button>`;
  }

  // An empty meal with a planned time: the time, marked due or late today.
  function plannedHtml(meal, day) {
    if (!MT()) return '';
    const times = mealSetup().times || {};
    if (!times[meal]) return '';
    let cls = '';
    if (day === today()) {
      const s = MT().daySchedule(log(), times, [meal], day, Date.now())[0];
      if (s && s.status === 'due') cls = ' is-due';
      else if (s && s.status === 'late') cls = ' is-late';
    }
    return `<span class="mt-chip is-planned${cls}" aria-label="${esc(labelOf(meal))} planned at ${esc(times[meal])}"><span class="ui-icon">${icon('clock')}</span>${esc(times[meal])}</span>`;
  }

  // "Next: Lunch at 12:30 · in 1h 20m", for today's card.
  function scheduleHtml() {
    const M = MT();
    const times = mealSetup().times;
    if (!times || !Core()) return '';
    const now = Date.now();
    const sched = M.daySchedule(log(), times, Core().MEALS, today(), now);
    if (!sched.length) return '';
    const next = M.nextMeal(sched);
    const late = sched.filter(x => x.status === 'late');
    let main;
    if (next && next.status === 'due') main = `<b>${esc(labelOf(next.meal))} now</b><small>planned ${M.hhmm(next.at)}</small>`;
    else if (next) main = `<b>Next: ${esc(labelOf(next.meal))} at ${M.hhmm(next.at)}</b><small>in ${M.duration(next.at - now)}</small>`;
    else if (!late.length) main = '<b>All planned meals logged</b> ✓';
    else main = '';
    const lateNote = late.length ? `<small class="mt-late">${late.map(x => `${esc(labelOf(x.meal))} (${M.hhmm(x.at)})`).join(', ')} not logged yet</small>` : '';
    if (!main && !lateNote) return '';
    return `<div class="mt-status mt-next"><div class="mt-status-main">${main}${lateNote}</div>${mealSetup().remind ? `<span class="mt-bell" title="Reminders on" aria-label="Reminders on">🔔</span>` : ''}</div>`;
  }

  function openMealTime(meal) {
    if (!Sheet() || !MT()) return;
    const day = shownDay();
    const all = log();
    const list = all.filter(e => e && e.date === day && e.meal === meal);
    if (!list.length) return;
    if (FL().locked && FL().locked()) return;
    const label = (Core() && Core().MEAL_LABELS[meal]) || meal;
    const cur = MT().mealTime(list, day, meal);
    const isToday = day === today();
    const value = cur !== null ? MT().hhmm(cur) : (isToday ? MT().hhmm(Date.now()) : '12:00');
    Sheet().open(`
      <form class="food-form mt-time-form" data-mt-time-form>
        <div class="food-sheet-hdr"><h3>When did you eat ${esc(label.toLowerCase())}?</h3><button type="button" class="food-sheet-x" aria-label="Close" data-close>✕</button></div>
        <p class="food-sheet-sub">Sets the time for every food in ${esc(label)}${isToday ? '' : ` on ${esc(Core().dayLabel(day, today()))}`}. Meal spacing and the fasting timer use it.</p>
        <label class="food-field"><span>Time</span><input type="time" name="time" value="${value}" required></label>
        <div class="food-share-actions mt-time-actions">
          <button type="submit" class="food-add-btn">Save</button>
          ${isToday ? '<button type="button" class="food-share-no" data-mt-now>Now</button>' : ''}
          ${cur !== null ? '<button type="button" class="food-share-no" data-mt-clear>Clear time</button>' : ''}
        </div>
      </form>`, { label: `When did you eat ${label.toLowerCase()}` });
    const form = document.querySelector('[data-mt-time-form]');
    if (!form) return;
    const apply = (at) => {
      const ids = new Set(list.map(e => e.id));
      const next = log().map(e => {
        if (!e || !ids.has(e.id)) return e;
        if (at === null) { const { eatenAt: _x, ...rest } = e; return rest; }
        return { ...e, eatenAt: at };
      });
      FL().save(next);
      Sheet().close();
      window.renderFoodLog?.();
    };
    form.querySelector('[data-close]').onclick = () => Sheet().close();
    form.querySelector('[data-mt-now]')?.addEventListener('click', () => apply(Date.now()));
    form.querySelector('[data-mt-clear]')?.addEventListener('click', () => apply(null));
    form.onsubmit = (e) => {
      e.preventDefault();
      const at = MT().timeOnDay(day, form.time.value);
      if (at === null) return;
      if (isToday && at > Date.now() + 5 * 60000) { FL().toast?.('That time hasn’t happened yet'); return; }
      apply(at);
    };
  }

  /* ── The card above the meals ─────────────────────────────── */

  function planLabel(p) { return `${p.hours}:${24 - p.hours}`; }

  function statusHtml(st, plan) {
    const M = MT();
    const startBtn = '<button type="button" class="mt-btn" data-mt-start>Start fast</button>';
    if (st.state === 'eating') {
      const pct = Math.round(Math.min(1, (Date.now() - st.windowStart) / (st.windowEnd - st.windowStart)) * 100);
      return `
        <div class="mt-status is-eating">
          <div class="mt-status-main"><b>Eating window</b> · closes ${M.hhmm(st.windowEnd)}<small>${M.duration(st.left)} left · opened ${M.hhmm(st.windowStart)}</small></div>
          ${startBtn}
        </div>
        <div class="mt-bar" role="progressbar" aria-label="Eating window" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`;
    }
    if (st.state === 'fasting' && plan.on) {
      const pct = Math.round(st.progress * 100);
      const main = st.done
        ? `<b>${plan.hours}h fast done</b> ✓<small>${M.duration(st.elapsed)} so far · since ${M.hhmm(st.start)}</small>`
        : `<b>Fasting ${M.duration(st.elapsed)}</b> of ${plan.hours}h<small>done at ${M.hhmm(st.goalAt)} · since ${st.manual ? 'you started at' : 'last meal,'} ${M.hhmm(st.start)}</small>`;
      return `
        <div class="mt-status is-fasting${st.done ? ' is-done' : ''}">
          <div class="mt-status-main">${main}</div>
          ${st.manual ? '<button type="button" class="mt-btn is-quiet" data-mt-stop>Undo</button>' : ''}
        </div>
        <div class="mt-bar" role="progressbar" aria-label="Fast" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>`;
    }
    if (st.state === 'fasting') {
      return `<div class="mt-status"><div class="mt-status-main"><b>Last meal ${M.duration(st.elapsed)} ago</b><small>at ${M.hhmm(st.start)}</small></div></div>`;
    }
    if (plan.on) {
      return `<div class="mt-status"><div class="mt-status-main"><b>Fasting ${planLabel(plan)}</b><small>The timer runs from your last meal.</small></div>${startBtn}</div>`;
    }
    return '';
  }

  function summaryHtml(sum) {
    if (!sum) return '';
    const M = MT();
    const parts = [`${sum.meals} meal${sum.meals === 1 ? '' : 's'}`];
    if (sum.meals > 1) {
      parts.push(`${M.hhmm(sum.first)}–${M.hhmm(sum.last)} (${M.duration(sum.window)})`);
      parts.push(`${M.duration(sum.avgGap)} apart on average`);
    } else {
      parts.push(`at ${M.hhmm(sum.first)}`);
    }
    return `<p class="mt-summary">${parts.map(esc).join(' · ')}</p>`;
  }

  function cardInner(day) {
    const M = MT();
    const all = log();
    const now = Date.now();
    const plan = loadPlan();
    const isToday = day === today();
    const items = all.filter(e => e && e.date === day);
    const sum = M.daySummary(items, now);
    const status = isToday ? statusHtml(M.fastStatus(all, plan, now), plan) : '';
    const schedule = isToday ? scheduleHtml() : '';
    if (!isToday && !sum) return '';
    const untimed = !sum && items.some(e => !M.isPlannedOnly(e));
    return `
      <div class="mt-hdr">
        <span class="mt-title"><span class="ui-icon">${icon('clock')}</span>Meal timing${plan.on ? ` <span class="mt-plan">${planLabel(plan)}</span>` : ''}</span>
        <button type="button" class="mx-link mt-open" data-mt-open>${plan.on || mealSetup().times ? 'Plan & stats' : 'Fasting & schedule'}</button>
      </div>
      ${schedule}
      ${status}
      ${summaryHtml(sum)}
      ${untimed ? '<p class="mt-summary">Tap “time” on a meal to say when you ate it.</p>' : ''}`;
  }

  function cardHtml(day) {
    if (!MT()) return '';
    syncReminders(); // the log or the meal setup may have changed
    const inner = cardInner(day || shownDay());
    return inner ? `<div class="mt-card" id="mtCard">${inner}</div>` : '';
  }

  /* ── Meal reminders (phone notifications) ─────────────────── */

  function notifier() {
    const c = window.Capacitor;
    if (!c || typeof c.isNativePlatform !== 'function' || !c.isNativePlatform()) return null;
    if (typeof c.isPluginAvailable === 'function' && !c.isPluginAvailable('LocalNotifications')) return null;
    return (c.Plugins && c.Plugins.LocalNotifications) || (typeof c.registerPlugin === 'function' ? c.registerPlugin('LocalNotifications') : null);
  }

  let lastSig = null;
  let syncTimer = null;
  function syncReminders() {
    if (!notifier()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(scheduleReminders, 800);
  }

  // Replaces every meal reminder with the current plan (stable ids).
  async function scheduleReminders() {
    const ln = notifier();
    if (!ln || !MT() || !Core() || !user()) return;
    const s = mealSetup();
    const plan = s.remind && s.times ? MT().reminderPlan({
      times: s.times, meals: Core().MEALS, labels: Core().MEAL_LABELS, entries: log(), today: today(), now: Date.now(),
    }) : [];
    const sig = JSON.stringify(plan.map(p => [p.id, p.at, p.title]));
    if (sig === lastSig) return;
    try {
      if (plan.length) {
        const perm = await ln.checkPermissions();
        if (!perm || perm.display !== 'granted') return;
      }
      await ln.cancel({ notifications: MT().allReminderIds().map(id => ({ id })) });
      if (plan.length) {
        await ln.schedule({
          notifications: plan.map(p => ({
            id: p.id, title: p.title, body: p.body,
            schedule: { at: new Date(p.at), allowWhileIdle: true },
            extra: { kind: 'meal-reminder', meal: p.meal },
          })),
        });
      }
      lastSig = sig;
    } catch (err) {
      console.warn('[MealTiming] could not schedule reminders', err);
    }
  }

  // → true when reminders can be sent (asks for permission if needed).
  async function allowReminders() {
    const ln = notifier();
    if (!ln) return false;
    try {
      let perm = await ln.checkPermissions();
      if (perm.display !== 'granted') perm = await ln.requestPermissions();
      return perm.display === 'granted';
    } catch { return false; }
  }

  // Tapping a reminder opens the food log at that meal.
  (function listenForTaps() {
    const ln = notifier();
    if (!ln || typeof ln.addListener !== 'function') return;
    ln.addListener('localNotificationActionPerformed', (ev) => {
      const extra = ev && ev.notification && ev.notification.extra;
      if (!extra || extra.kind !== 'meal-reminder') return;
      setTimeout(() => {
        if (typeof window.showTab === 'function') window.showTab('macroTab');
        window.openFoodSearch?.({ meal: extra.meal });
      }, 600);
    });
    // Keeps the next 7 days planned even if the food log isn't opened.
    setTimeout(scheduleReminders, 4000);
  })();

  // Keeps the timer current while the card is on screen.
  setInterval(() => {
    const el = document.getElementById('mtCard');
    if (!el || document.hidden) return;
    const inner = cardInner(shownDay());
    if (inner) el.innerHTML = inner;
  }, 30000);

  function startFast() {
    savePlan({ ...loadPlan(), startedAt: Date.now() });
    window.renderFoodLog?.();
  }
  function undoStart() {
    const { startedAt: _s, ...rest } = loadPlan();
    savePlan(rest);
    window.renderFoodLog?.();
  }

  /* ── Timing sheet: fasting goal + last 7 days ─────────────── */

  function openSheet() {
    if (!Sheet() || !MT()) return;
    const M = MT();
    const draw = () => {
      const plan = loadPlan();
      const w = M.weekStats(log(), plan, Date.now());
      const row = (k, v) => (v === null || v === undefined || v === '' ? '' : `<div class="mt-stat"><span>${esc(k)}</span><b>${esc(v)}</b></div>`);
      const stats = w.days ? `
        <h4 class="mt-h4">Last 7 days</h4>
        <div class="mt-stats">
          ${row('Days with meal times', String(w.days))}
          ${row('Meals a day', w.avgMeals !== null ? String(w.avgMeals) : null)}
          ${row('First meal', M.clockLabel(w.avgFirst))}
          ${row('Last meal', M.clockLabel(w.avgLast))}
          ${row('Eating window', M.duration(w.avgWindow))}
          ${row('Time between meals', M.duration(w.avgGap))}
          ${row('Average fast', w.fasts ? M.duration(w.avgFast) : null)}
          ${row('Longest fast', w.fasts ? M.duration(w.longestFast) : null)}
          ${plan.on && w.fasts ? row(`Fasts of ${plan.hours}h+`, `${w.goalHit} of ${w.fasts}`) : ''}
        </div>`
        : '<p class="food-sheet-sub">No meal times in the last 7 days yet. Food you log for today gets the time you log it; tap a meal’s time to change it.</p>';
      const setup = mealSetup();
      const times = setup.times || {};
      const planned = (Core() ? Core().MEALS : []).filter(m => times[m]).sort((a, b) => times[a].localeCompare(times[b]));
      const canNotify = !!notifier();
      const schedule = `
          <h4 class="mt-h4">Planned meals</h4>
          ${planned.length ? `
          <div class="mt-stats">${planned.map(m => row(labelOf(m), times[m])).join('')}</div>` : '<p class="food-sheet-sub">Give your meals a time to plan your day and get reminders.</p>'}
          <button type="button" class="mx-link mt-set-times" data-mt-set-times>${planned.length ? 'Change meal times' : 'Set meal times'}</button>
          <label class="mt-toggle${planned.length && canNotify ? '' : ' is-off'}"><input type="checkbox" data-mt-remind${setup.remind ? ' checked' : ''}${planned.length && canNotify ? '' : ' disabled'}><span>Remind me at meal times</span></label>
          <p class="food-sheet-sub">${canNotify
            ? 'A notification at each planned time, skipped once you’ve logged that meal.'
            : 'Reminders come as notifications on your phone, in the Pocket Coach app.'}</p>`;
      Sheet().open(`
        <div class="mt-sheet">
          <div class="food-sheet-hdr"><h3>Meal timing</h3><button type="button" class="food-sheet-x" aria-label="Close" data-close>✕</button></div>
          <label class="mt-toggle"><input type="checkbox" data-mt-on${plan.on ? ' checked' : ''}><span>Fasting timer</span></label>
          <p class="food-sheet-sub">Counts from your last meal and shows when your eating window closes.</p>
          <div class="mt-presets${plan.on ? '' : ' is-off'}" role="radiogroup" aria-label="Fasting hours">
            ${M.FAST_PRESETS.map(h => `<button type="button" role="radio" aria-checked="${plan.hours === h}" class="mt-preset${plan.hours === h ? ' is-on' : ''}" data-mt-hours="${h}"${plan.on ? '' : ' disabled'}>${h}:${24 - h}</button>`).join('')}
          </div>
          ${schedule}
          ${stats}
        </div>`, { label: 'Meal timing' });
      const box = document.querySelector('#foodSheet .mt-sheet');
      if (!box) return;
      box.querySelector('[data-mt-set-times]').onclick = () => { Sheet().close(); window.openMealSetup?.(); };
      box.querySelector('[data-mt-remind]').onchange = async (e) => {
        const on = e.target.checked;
        if (on && !(await allowReminders())) {
          FL().toast?.('Allow notifications for Pocket Coach in your phone’s settings to get meal reminders.');
          draw();
          return;
        }
        FL().saveMealSetup?.({ ...mealSetup(), remind: on });
        lastSig = null;
        window.renderFoodLog?.();
        draw();
      };
      box.querySelector('[data-close]').onclick = () => { Sheet().close(); window.renderFoodLog?.(); };
      box.querySelector('[data-mt-on]').onchange = (e) => { savePlan({ ...loadPlan(), on: e.target.checked }); window.renderFoodLog?.(); draw(); };
      box.querySelectorAll('[data-mt-hours]').forEach(b => b.addEventListener('click', () => { savePlan({ ...loadPlan(), hours: Number(b.dataset.mtHours) }); window.renderFoodLog?.(); draw(); }));
    };
    draw();
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-mt-meal-time],[data-mt-open],[data-mt-start],[data-mt-stop]');
    if (!t) return;
    if (t.dataset.mtMealTime) openMealTime(t.dataset.mtMealTime);
    else if (t.hasAttribute('data-mt-open')) openSheet();
    else if (t.hasAttribute('data-mt-start')) startFast();
    else if (t.hasAttribute('data-mt-stop')) undoStart();
  });

  window.MealTiming = { stamp, chipHtml, plannedHtml, cardHtml, openSheet, openMealTime, loadPlan, scheduleReminders };
})();
