/* "My Plan" in the Program tab: the master plan the athlete's coach has
   published (GET /api/client/plan), shown with PlanPreview.render().

   The last plan is cached per account (coachPlan_<user>) so the view works
   offline; drafts never reach this screen, the backend only returns a plan
   once the coach has approved and published it. */
(function (globalScope) {
  'use strict';

  const CACHE_PREFIX = 'coachPlan_';

  function currentUser() {
    return globalScope.currentUser || globalScope.localStorage?.getItem('fitnessAppUser') || '';
  }

  function readCache(user) {
    try { return JSON.parse(globalScope.localStorage.getItem(CACHE_PREFIX + user) || 'null'); } catch { return null; }
  }

  function writeCache(user, plan) {
    try {
      if (plan) globalScope.localStorage.setItem(CACHE_PREFIX + user, JSON.stringify(plan));
      else globalScope.localStorage.removeItem(CACHE_PREFIX + user);
    } catch { /* storage full or blocked — the view still renders */ }
  }

  async function fetchPlan({ fetchFn = globalScope.fetch, serverUrl = globalScope.SERVER_URL, token = globalScope.localStorage?.getItem('token') } = {}) {
    if (!serverUrl || !token) return { ok: false, reason: 'signed_out' };
    const res = await fetchFn(`${serverUrl}/api/client/plan`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.success === false) return { ok: false, reason: body?.error?.code || `http_${res.status}` };
    return { ok: true, plan: body.plan || null };
  }

  /** The coach's plan PDF attached to the published plan: { fileName, mime, data (base64) }. */
  async function fetchPlanFile(fileId, { fetchFn = globalScope.fetch, serverUrl = globalScope.SERVER_URL, token = globalScope.localStorage?.getItem('token') } = {}) {
    if (!serverUrl || !token) throw new Error('Sign in to open your plan document.');
    const res = await fetchFn(`${serverUrl}/api/client/plan/file/${encodeURIComponent(fileId)}`, { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.file) throw new Error(body?.error?.message || 'Could not open your plan document.');
    return body.file;
  }

  function isNative() {
    const cap = globalScope.Capacitor;
    return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  }

  // In the app: the share sheet (Quick Look preview, save to Files/Books).
  // In a browser: a new tab with the PDF.
  async function openPlanFile(fileId, deps = {}) {
    const toast = (m, t) => { if (typeof globalScope.showToast === 'function') globalScope.showToast(m, t || 'info'); };
    let win = null;
    if (!isNative() && globalScope.open) win = globalScope.open('', '_blank'); // before the await, or pop-up blockers object
    try {
      const f = await fetchPlanFile(fileId, deps);
      const bytes = Uint8Array.from(globalScope.atob(f.data), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: f.mime || 'application/pdf' });
      if (isNative() && globalScope.navigator?.share) {
        const file = new File([blob], f.fileName || 'plan.pdf', { type: blob.type });
        if (!globalScope.navigator.canShare || globalScope.navigator.canShare({ files: [file] })) {
          await globalScope.navigator.share({ files: [file], title: f.fileName || 'Your plan' }).catch((e) => { if (e.name !== 'AbortError') throw e; });
          return;
        }
      }
      const url = URL.createObjectURL(blob);
      if (win) win.location.href = url; else globalScope.location.href = url;
    } catch (err) {
      if (win) win.close();
      toast(err.message || 'Could not open your plan document.', 'warn');
    }
  }

  const EMPTY = `<div class="pp-empty">
      <p><strong>No plan yet.</strong></p>
      <p>When your coach publishes your plan, its phases, nutrition targets and weekly training volume show up here.</p>
    </div>`;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function localIso(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const PHASE = { cut: 'Cut', maintain: 'Maintain', build: 'Build', deload: 'Deload' };

  /** Today in the plan (src/js/plan-today.js): week, phase, day type, targets and the session. */
  function todayHtml(plan, isoDate = localIso()) {
    const T = globalScope.PlanToday;
    const r = T && plan ? T.resolve(plan, isoDate) : null;
    if (!r || !r.phase) return '';
    const t = r.targets;
    const day = r.day;
    const label = r.dayType === 'training' ? `Training day${day ? ` · ${day.name}` : ''}` : r.dayType === 'rest' ? 'Rest day' : '';
    const lifts = day ? `<ul class="pp-today-lifts">${(day.exercises || []).map((ex) =>
      `<li><span>${esc(ex.name)}</span><span>${esc(T.exerciseTarget(ex))}</span></li>`).join('')}</ul>` : '';
    return `<section class="pp-today">
      <div class="pp-sub">Today · week ${esc(r.planWeek)} of ${esc(r.totalWeeks)} · ${esc(PHASE[r.phase.type] || r.phase.type)}${r.programWeek ? ` · program week ${esc(r.programWeek)}${r.repeatsLastWeek ? ' (repeated)' : ''}` : ''}</div>
      ${label ? `<div class="pp-today-title">${esc(label)}</div>` : ''}
      ${t ? `<div class="pp-macros"><span>${esc(Math.round(t.kcal))} kcal</span> · <span>P ${esc(Math.round(t.protein))} g</span> · <span>C ${esc(Math.round(t.carbs))} g</span> · <span>F ${esc(Math.round(t.fat))} g</span></div>` : ''}
      ${lifts}
    </section>`;
  }

  const TODAY_CSS = `.pp-today{background:var(--card-bg,rgba(127,127,127,.06));border:1px solid var(--primary,#2f8a63);border-radius:var(--radius-md,16px);padding:var(--space-4,16px);display:flex;flex-direction:column;gap:8px;margin-bottom:var(--space-3,12px)}
.pp-today-title{font-family:var(--font-display,inherit);font-size:24px;line-height:1.1;text-transform:uppercase}
.pp-today-lifts{list-style:none;margin:4px 0 0;padding:0;display:flex;flex-direction:column;gap:6px;font-size:14px}
.pp-today-lifts li{display:flex;justify-content:space-between;gap:12px;border-top:1px solid var(--border-color,rgba(127,127,127,.2));padding-top:6px}
.pp-today-lifts li span:last-child{color:var(--secondary-text,inherit);text-align:right;white-space:nowrap}`;

  function ensureTodayStyles(doc = globalScope.document) {
    if (!doc || doc.getElementById('plan-today-style')) return;
    const style = doc.createElement('style');
    style.id = 'plan-today-style';
    style.textContent = TODAY_CSS;
    doc.head.appendChild(style);
  }

  async function showMyPlan(container, deps = {}) {
    if (!container) return;
    const preview = globalScope.PlanPreview;
    if (!preview) { container.innerHTML = '<div class="pp-empty">Plan preview not loaded.</div>'; return; }
    preview.ensureStyles();
    ensureTodayStyles();
    if (!container.__planFileHooked && typeof container.addEventListener === 'function') {
      container.__planFileHooked = true;
      container.addEventListener('click', (e) => {
        const btn = e.target.closest && e.target.closest('[data-plan-file]');
        if (btn) openPlanFile(btn.getAttribute('data-plan-file'), deps);
      });
    }
    const user = currentUser();
    const cached = user ? readCache(user) : null;
    const view = (plan) => todayHtml(plan, deps.today) + preview.render(plan, deps.today ? { today: deps.today } : {});
    container.innerHTML = cached ? view(cached) : '<div class="pp-empty">Loading your plan…</div>';
    try {
      const result = await fetchPlan(deps);
      if (!result.ok) {
        if (!cached) container.innerHTML = EMPTY;
        return;
      }
      if (user) writeCache(user, result.plan);
      container.innerHTML = result.plan ? view(result.plan) : EMPTY;
    } catch {
      if (!cached) container.innerHTML = EMPTY; // offline and nothing cached
    }
  }

  const api = { showMyPlan, fetchPlan, fetchPlanFile, openPlanFile, todayHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.MyPlan = api;
})(typeof window !== 'undefined' ? window : globalThis);
