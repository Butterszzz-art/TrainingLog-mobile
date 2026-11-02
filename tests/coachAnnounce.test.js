// "New from your coach" (src/js/coach-announce.js): what arrived, the coach's
// note, where today stands, where things live; pops up once per new plan
// version or program, else waits on Home; opened by the notification too.
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const plan = require('./fixtures/plan-v2-published.json'); // starts Mon 2026-11-09, coach c1
const CA = require('../src/js/coach-announce.js');
require('../src/js/plan-preview');
require('../src/js/plan-today');

const active = new Set(['c1']);
const published = (extra = {}) => ({ ...plan, announcement: { message: 'Start Monday. Weigh in daily.', at: '2026-11-02T10:00:00Z', version: 1, key: `plan:${plan.planId}` }, ...extra });
const assignments = [{ coachUid: 'c1', coachUsername: 'arman' }];

describe('latest', () => {
  test('the published plan, with its note, version and coach', () => {
    expect(CA.latest({ plan: published(), assignments, activeUids: active })).toMatchObject({ kind: 'plan', key: `plan:${plan.planId}`, version: 1, message: 'Start Monday. Weigh in daily.', coach: 'arman' });
  });

  test('a program sent later wins; a coach who is no longer active is ignored', () => {
    const asn = [{ coachUid: 'c1', coachUsername: 'arman', programAnnouncement: { title: 'X-frame', message: '', at: '2026-11-03T10:00:00Z', key: 'program:p1:x' } }];
    expect(CA.latest({ plan: published(), assignments: asn, activeUids: active })).toMatchObject({ kind: 'program', name: 'X-frame' });
    expect(CA.latest({ plan: published(), assignments: asn, activeUids: new Set() })).toBeNull();
    expect(CA.latest({ plan: { ...published(), status: 'superseded' }, assignments, activeUids: active })).toBeNull();
  });
});

describe('sheet', () => {
  test('plan: note, where today stands, Start program when not yet following, where to find things', () => {
    const a = CA.latest({ plan: published(), assignments, activeUids: active });
    const html = CA.sheetHtml(a, { plan: published(), today: '2026-11-24', hasProgram: true, following: false });
    expect(html).toContain('“Start Monday. Weigh in daily.”');
    expect(html).toContain('From arman');
    expect(html).toMatch(/Week 3 of 16 · Cut\. Today is a training day: <b>Upper A<\/b> · 2350 kcal, 165 g protein\./);
    expect(html).toContain('data-ca-act="start"');
    ['Home → Up today', 'Log', 'Macros', 'Program → My Plan'].forEach(k => expect(html).toContain(`<b>${k}</b>`));
    expect(html).toContain('RIR 2/1');
  });

  test('before the start; following already → Open My Plan; version 2 title; program kind', () => {
    const a = CA.latest({ plan: published(), assignments, activeUids: active });
    expect(CA.sheetHtml(a, { plan: published(), today: '2026-11-02', hasProgram: true, following: true })).toMatch(/Your plan starts .*9/);
    expect(CA.sheetHtml(a, { plan: published(), hasProgram: true, following: true })).toContain('data-ca-act="plan"');
    expect(CA.sheetHtml({ ...a, version: 2 }, {})).toContain('Your plan, version 2');
    const prog = CA.sheetHtml({ kind: 'program', name: 'X-frame', message: '', coach: 'arman', version: 1 }, {});
    expect(prog).toContain('Program → My Programs');
    expect(prog).not.toContain('<b>Macros</b>');
  });
});

describe('in the app', () => {
  function app({ busy = false } = {}) {
    const dom = new JSDOM(`<!doctype html><body>${busy ? '<div class="tour-root"></div>' : ''}<div><div id="todayProgramCard"></div></div></body>`, { runScripts: 'outside-only', url: 'https://app.test/', pretendToBeVisual: true });
    const w = dom.window;
    w.localStorage.setItem('fitnessAppUser', 'alice');
    w.showTab = jest.fn();
    w.showProgramView = jest.fn();
    w.startGuideTour = jest.fn();
    ['src/js/plan-preview.js', 'src/js/plan-today.js', 'src/js/coach-announce.js'].forEach(f => w.eval(read(f)));
    return w;
  }
  const state = () => ({ plan: published(), assignments, activeUids: active });
  const click = (w, sel) => w.document.querySelector(sel).dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  test('pops up once; closing marks it seen; the next refresh stays quiet', () => {
    const w = app();
    w.CoachAnnounce.sync(state(), { composed: {}, following: false, startPlanProgram: () => true });
    expect(w.document.getElementById('coachAnnounceSheet')).not.toBeNull();
    click(w, '.ca-link[data-ca-act="close"]');
    expect(w.document.getElementById('coachAnnounceSheet')).toBeNull();
    w.CoachAnnounce.sync(state(), {});
    expect(w.document.getElementById('coachAnnounceSheet')).toBeNull();
    expect(w.document.getElementById('coachAnnounceCard').innerHTML).toBe('');
  });

  test('a new version pops up again', () => {
    const w = app();
    w.CoachAnnounce.sync(state(), {});
    click(w, '.ca-link');
    w.CoachAnnounce.sync({ ...state(), plan: published({ planId: 'pln_v2', version: 2, announcement: { message: '', at: '2026-12-01T00:00:00Z', version: 2, key: 'plan:pln_v2' } }) }, {});
    expect(w.document.getElementById('caTitle').textContent).toBe('Your plan, version 2');
  });

  test('when a tour is on screen it waits as a Home card; tapping the card opens it', () => {
    const w = app({ busy: true });
    w.CoachAnnounce.sync(state(), {});
    expect(w.document.getElementById('coachAnnounceSheet')).toBeNull();
    expect(w.document.querySelector('#coachAnnounceCard .ca-card').textContent).toMatch(/New from your coach/);
    click(w, '.ca-card');
    expect(w.document.getElementById('coachAnnounceSheet')).not.toBeNull();
  });

  test('buttons: Start program, Open My Plan, Show me around', () => {
    const w = app();
    const start = jest.fn(() => true);
    w.CoachAnnounce.sync(state(), { composed: {}, following: false, startPlanProgram: start });
    click(w, '[data-ca-act="start"]');
    expect(start).toHaveBeenCalled();
    expect(w.showTab).toHaveBeenCalledWith('homeTab');
    w.CoachAnnounce.open();
    click(w, '[data-ca-act="tour"]');
    expect(w.startGuideTour).toHaveBeenCalledWith('coach');
    w.CoachAnnounce.sync(state(), { composed: {}, following: true, startPlanProgram: start });
    w.CoachAnnounce.open();
    click(w, '[data-ca-act="plan"]');
    expect(w.showTab).toHaveBeenCalledWith('programTab');
    expect(w.showProgramView).toHaveBeenCalledWith('plan');
  });

  test('the notification opens it, even before the app has refreshed', () => {
    const w = app();
    expect(w.CoachAnnounce.open({ kind: 'program', name: 'X-frame', message: 'Lower days first.', coach: 'arman', key: 'program:p1:x' })).toBe(true);
    expect(w.document.querySelector('.ca-note').textContent).toBe('“Lower days first.”');
  });
});

test('the coaching tour is only listed for someone with a coach plan', () => {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only', url: 'https://app.test/' });
  const w = dom.window;
  w.eval(read('src/js/guide-tours.js'));
  expect(w.GuideTours.coach.available()).toBe(false);
  w.localStorage.setItem('fitnessAppUser', 'alice');
  w.localStorage.setItem('coachPlan_alice', JSON.stringify(plan));
  expect(w.GuideTours.coach.available()).toBe(true);
  expect(w.GuideTours.coach.steps.length).toBe(8);
});
