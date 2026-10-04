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

  const EMPTY = `<div class="pp-empty">
      <p><strong>No plan yet.</strong></p>
      <p>When your coach publishes your plan, its phases, nutrition targets and weekly training volume show up here.</p>
    </div>`;

  async function showMyPlan(container, deps = {}) {
    if (!container) return;
    const preview = globalScope.PlanPreview;
    if (!preview) { container.innerHTML = '<div class="pp-empty">Plan preview not loaded.</div>'; return; }
    preview.ensureStyles();
    const user = currentUser();
    const cached = user ? readCache(user) : null;
    container.innerHTML = cached ? preview.render(cached) : '<div class="pp-empty">Loading your plan…</div>';
    try {
      const result = await fetchPlan(deps);
      if (!result.ok) {
        if (!cached) container.innerHTML = EMPTY;
        return;
      }
      if (user) writeCache(user, result.plan);
      container.innerHTML = result.plan ? preview.render(result.plan) : EMPTY;
    } catch {
      if (!cached) container.innerHTML = EMPTY; // offline and nothing cached
    }
  }

  const api = { showMyPlan, fetchPlan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  globalScope.MyPlan = api;
})(typeof window !== 'undefined' ? window : globalThis);
