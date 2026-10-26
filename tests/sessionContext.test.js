const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

describe('session-context alt gym / alt machine', () => {
  let ctx;
  let store;

  function localToday() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  beforeEach(() => {
    const dom = new JSDOM('<!DOCTYPE html><div id="sessionContextBar"></div>');
    store = {};
    ctx = {
      document: dom.window.document,
      CustomEvent: dom.window.CustomEvent,
      localStorage: {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; }
      },
      currentUser: 'u1',
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync('progressiveOverload.js', 'utf8'), ctx);
    vm.runInContext(fs.readFileSync('src/js/session-context.js', 'utf8'), ctx);
    ctx.renderSessionContextBar();
  });

  const stored = () => JSON.parse(ctx.localStorage.getItem('sessionContext_u1'));
  const bar = () => ctx.document.getElementById('sessionContextBar');
  const seedWorkouts = (key, list) => ctx.localStorage.setItem(`${key}_u1`, JSON.stringify(list));
  const gymEntry = (gymName, extra = {}) => ({ exercise: 'Bench', sessionCtx: { altMachine: false, altGym: true, gymName }, ...extra });

  test('the bar has no global Alt Machine chip any more', () => {
    expect(bar().textContent).toMatch(/Alt\sGym/);
    expect(bar().textContent).not.toMatch(/Alt\sMachine/);
  });

  test('tags an entry with the gym, and with Alt Machine only when asked', () => {
    ctx.toggleAltGym();
    ctx.setAltGymName("  Gold's ");
    expect(ctx.applySessionContext({}).sessionCtx).toEqual({ altMachine: false, altGym: true, gymName: "Gold's" });
    expect(ctx.applySessionContext({}, { altMachine: true }).sessionCtx).toEqual({ altMachine: true, altGym: true, gymName: "Gold's" });

    ctx.toggleAltGym();
    expect(ctx.applySessionContext({ sessionCtx: { altGym: true } }).sessionCtx).toBeUndefined();
    expect(ctx.applySessionContext({}, { altMachine: true }).sessionCtx).toEqual({ altMachine: true, altGym: false, gymName: '' });
  });

  test('getCurrentGymKey: usual gym, named gym, unnamed gym', () => {
    expect(ctx.getCurrentGymKey()).toBe('');
    ctx.toggleAltGym();
    expect(ctx.getCurrentGymKey()).toBeNull();
    ctx.setAltGymName('  PureGym   Soho ');
    expect(ctx.getCurrentGymKey()).toBe('puregym soho');
  });

  test('saved gyms come from past workouts, most recent first, with visit counts', () => {
    seedWorkouts('workoutHistory', [
      { date: '2026-09-01', log: [gymEntry('PureGym Soho')] },
      { date: '2026-09-08', log: [gymEntry('puregym soho'), gymEntry('PureGym Soho')] },
      { date: '2026-08-01', log: [gymEntry('Hotel gym')] },
    ]);
    seedWorkouts('workouts', [
      { date: '2026-10-20', log: [gymEntry('Marriott')] },
      { date: '2026-10-21', log: [{ exercise: 'Bench' }, gymEntry('')] },
      { date: '2026-07-01', _sessionCtx: { altGym: true, gymName: 'Legacy Gym' }, log: [{ exercise: 'Row' }] },
    ]);
    expect(ctx.getSavedGyms().map(g => [g.name, g.visits])).toEqual([
      ['Marriott', 1], ['PureGym Soho', 2], ['Hotel gym', 1], ['Legacy Gym', 1],
    ]);
  });

  test('saved gyms show as chips; picking one fills the name', () => {
    seedWorkouts('workouts', [{ date: '2026-10-20', log: [gymEntry('PureGym Soho')] }]);
    ctx.toggleAltGym();
    const chip = bar().querySelector('.scb-gym-chip');
    expect(chip.textContent).toContain('PureGym Soho');
    // (inline onclick runs in jsdom's own window, so call what it calls)
    expect(chip.getAttribute('onclick')).toContain('setAltGymName(this.dataset.gymName, true)');
    ctx.setAltGymName(chip.dataset.gymName, true);
    expect(stored().gymName).toBe('PureGym Soho');
    expect(bar().querySelector('#altGymNameInput').value).toBe('PureGym Soho');
    expect(chip.getAttribute('aria-checked')).toBe('true');
    expect(bar().querySelector('.scb-note').textContent).toContain('last visit to PureGym Soho');
  });

  test('a new gym name says it sets the baseline', () => {
    ctx.toggleAltGym();
    ctx.setAltGymName('Brand New Gym');
    expect(bar().querySelector('.scb-note').textContent).toContain('First time at Brand New Gym');
  });

  test('typing a gym name keeps the same input (no focus loss) and fires tl:gym-changed', () => {
    ctx.toggleAltGym();
    const events = [];
    ctx.document.addEventListener('tl:gym-changed', e => events.push(e.detail.gymName));
    const input = ctx.document.getElementById('altGymNameInput');
    ctx.setAltGymName('Planet');
    expect(ctx.document.getElementById('altGymNameInput')).toBe(input);
    expect(events).toEqual(['Planet']);
  });

  test('gym names with quotes or markup are escaped, in the input and in chips', () => {
    const evil = '"><img src=x onerror=alert(1)>';
    seedWorkouts('workouts', [{ date: '2026-10-20', log: [gymEntry(evil)] }]);
    ctx.toggleAltGym();
    ctx.setAltGymName(evil);
    ctx.renderSessionContextBar();
    expect(bar().querySelector('img')).toBeNull();
    expect(ctx.document.getElementById('altGymNameInput').value).toBe(evil);
    expect(bar().querySelector('.scb-gym-chip').dataset.gymName).toBe(evil);
  });

  test('Alt Gym left on from an earlier day is dropped', () => {
    ctx.localStorage.setItem('sessionContext_u1', JSON.stringify({ altGym: true, gymName: 'X', date: '2024-01-01' }));
    expect(ctx.getSessionContext().altGym).toBe(false);
    expect(ctx.applySessionContext({}).sessionCtx).toBeUndefined();
  });

  test('a flag set today persists with today\'s date', () => {
    ctx.toggleAltGym();
    expect(stored()).toMatchObject({ altGym: true, date: localToday() });
    expect(ctx.getSessionContext().altGym).toBe(true);
  });

  test('clearing after save resets everything', () => {
    ctx.toggleAltGym();
    ctx.setAltGymName('X');
    ctx.clearSessionContextAfterSave();
    expect(ctx.getSessionContext()).toMatchObject({ altGym: false, gymName: '' });
    expect(bar().querySelector('.scb-note')).toBeNull();
  });
});
