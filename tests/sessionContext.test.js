const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');

describe('session-context alt machine / alt gym', () => {
  let ctx;
  let dom;

  function localToday() {
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  beforeEach(() => {
    dom = new JSDOM('<!DOCTYPE html><div id="sessionContextBar"></div>');
    const store = {};
    ctx = {
      document: dom.window.document,
      localStorage: {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; }
      },
      currentUser: 'u1',
      JSON, Date, String, Object, Math,
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync('src/js/session-context.js', 'utf8'), ctx);
    ctx.renderSessionContextBar();
  });

  const stored = () => JSON.parse(ctx.localStorage.getItem('sessionContext_u1'));

  test('tags an entry while a flag is on and removes the tag when off', () => {
    ctx.toggleAltGym();
    ctx.setAltGymName('  Gold\'s ');
    const entry = ctx.applySessionContext({ exercise: 'Bench' });
    expect(entry.sessionCtx).toEqual({ altMachine: false, altGym: true, gymName: 'Gold\'s' });

    ctx.toggleAltGym();
    ctx.applySessionContext(entry);
    expect(entry.sessionCtx).toBeUndefined();
  });

  test('typing a gym name keeps the same input (no focus loss) and updates the note', () => {
    ctx.toggleAltGym();
    const input = ctx.document.getElementById('altGymNameInput');
    ctx.setAltGymName('Planet');
    expect(ctx.document.getElementById('altGymNameInput')).toBe(input);
    expect(ctx.document.querySelector('.scb-note').textContent).toContain('alt gym (Planet)');
  });

  test('gym name with quotes or markup is escaped', () => {
    ctx.toggleAltGym();
    ctx.setAltGymName('"><img src=x onerror=alert(1)>');
    ctx.renderSessionContextBar();
    const bar = ctx.document.getElementById('sessionContextBar');
    expect(bar.querySelector('img')).toBeNull();
    expect(ctx.document.getElementById('altGymNameInput').value).toBe('"><img src=x onerror=alert(1)>');
  });

  test('flags left on from an earlier day are dropped', () => {
    ctx.localStorage.setItem('sessionContext_u1', JSON.stringify({ altMachine: true, altGym: false, gymName: '', date: '2024-01-01' }));
    expect(ctx.getSessionContext().altMachine).toBe(false);
    expect(ctx.applySessionContext({}).sessionCtx).toBeUndefined();
  });

  test('flags set today persist and carry today\'s date', () => {
    ctx.toggleAltMachine();
    expect(stored()).toMatchObject({ altMachine: true, date: localToday() });
    expect(ctx.getSessionContext().altMachine).toBe(true);
  });

  test('clearing after save resets everything', () => {
    ctx.toggleAltMachine();
    ctx.toggleAltGym();
    ctx.clearSessionContextAfterSave();
    expect(ctx.getSessionContext()).toMatchObject({ altMachine: false, altGym: false, gymName: '' });
    expect(ctx.document.querySelector('.scb-note')).toBeNull();
  });
});
