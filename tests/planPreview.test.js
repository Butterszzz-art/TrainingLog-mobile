/**
 * @jest-environment node
 */
// Fixtures were produced by the backend's plan generator
// (traininglog-backend src/plan/generator.js): a coach draft and the
// trimmed client copy a publish writes.
const draft = require('./fixtures/plan-draft.json');
const published = require('./fixtures/plan-published.json');
const PlanPreview = require('../src/js/plan-preview');
const { showMyPlan } = require('../src/js/my-plan');

describe('PlanPreview.render', () => {
  test('shows every phase with its dates and targets', () => {
    const html = PlanPreview.render(published, { today: '2026-09-01' });
    expect(html).toContain('Physique Plan');
    expect((html.match(/class="pp-phase /g) || []).length).toBe(3);
    expect(html).toContain(`${published.phases[0].nutrition.restDay.kcal}`);
    expect(html).toContain('Upper / Lower');
  });

  test('highlights the current phase and its week', () => {
    const html = PlanPreview.render(published, { today: '2026-10-26' }); // week 3 of the build
    expect(html).toContain('pp-phase--current');
    expect(html).toContain('Now · week 3');
    expect(PlanPreview.currentPhase(published, '2027-02-10').type).toBe('maintain');
    expect(PlanPreview.currentPhase(published, '2030-01-01')).toBeNull();
  });

  test('explains how each phase ends', () => {
    const cut = published.phases.find(p => p.type === 'cut');
    expect(PlanPreview.endCriteriaText(cut)).toBe('Ends when you reach the bodyweight (7-day average) target your coach sets or after 8 weeks, whichever comes first.');
    const withTarget = { ...cut, endCriteria: { any: [{ ...cut.endCriteria.any[0], value: 78 }, cut.endCriteria.any[1]] } };
    expect(PlanPreview.endCriteriaText(withTarget)).toContain('≤ 78 kg');
  });

  test('client view hides rules and flags; coach view shows them', () => {
    const client = PlanPreview.render(published, { today: '2026-10-26' });
    expect(client).not.toContain('pp-rule');
    expect(client).not.toContain('not yet verified');
    const coach = PlanPreview.render(draft, { today: '2026-10-26', coachView: true });
    expect(coach).toContain('nutr.energy.factor');
    expect(coach).toContain('Draft — not visible to the client');
    expect(coach).toContain('not yet verified against Butters University');
  });

  test('coach view lists the rules that differ from Butters University', () => {
    const coach = PlanPreview.render(draft, { today: '2026-10-26', coachView: true });
    expect(coach).toContain('Differs from Butters University');
    for (const c of draft.butters.conflicts) expect(coach).toContain(c.ruleId);
    expect(PlanPreview.render(draft, { today: '2026-10-26' })).not.toContain('Differs from Butters University');
    const noConflicts = { ...draft, butters: { ...draft.butters, conflicts: [] } };
    expect(PlanPreview.render(noConflicts, { coachView: true })).not.toContain('Differs from Butters University');
  });

  test('escapes text from the plan', () => {
    const evil = { ...published, package: { ...published.package, name: '<img src=x onerror=alert(1)>' } };
    expect(PlanPreview.render(evil)).not.toContain('<img');
  });

  test('handles a missing plan', () => {
    expect(PlanPreview.render(null)).toContain('No plan to show');
  });
});

describe('MyPlan.showMyPlan', () => {
  const store = new Map();
  beforeEach(() => {
    store.clear();
    globalThis.localStorage = {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    };
    globalThis.currentUser = 'ana';
    globalThis.PlanPreview = PlanPreview;
  });
  afterAll(() => { delete globalThis.localStorage; delete globalThis.currentUser; delete globalThis.PlanPreview; });

  test('fetches the published plan, renders and caches it', async () => {
    const el = { innerHTML: '' };
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, plan: published }) });
    await showMyPlan(el, { fetchFn, serverUrl: 'https://api.test', token: 't' });
    expect(fetchFn).toHaveBeenCalledWith('https://api.test/api/client/plan', { headers: { Authorization: 'Bearer t' } });
    expect(el.innerHTML).toContain('Physique Plan');
    expect(JSON.parse(localStorage.getItem('coachPlan_ana')).planId).toBe(published.planId);
  });

  test('shows the empty state when no plan is published', async () => {
    const el = { innerHTML: '' };
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, plan: null }) });
    await showMyPlan(el, { fetchFn, serverUrl: 'https://api.test', token: 't' });
    expect(el.innerHTML).toContain('No plan yet');
  });

  test('offline: falls back to the cached plan', async () => {
    localStorage.setItem('coachPlan_ana', JSON.stringify(published));
    const el = { innerHTML: '' };
    const fetchFn = jest.fn().mockRejectedValue(new Error('offline'));
    await showMyPlan(el, { fetchFn, serverUrl: 'https://api.test', token: 't' });
    expect(el.innerHTML).toContain('Physique Plan');
  });
});
