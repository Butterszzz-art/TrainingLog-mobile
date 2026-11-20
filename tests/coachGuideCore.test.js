const G = require('../src/js/coach-guide-core');

describe('coach guide core', () => {
  test('six steps in a fixed order', () => {
    expect(G.STEP_IDS).toEqual(['code', 'client', 'program', 'macros', 'checkin', 'desktop']);
  });

  test('a new coach has nothing done', () => {
    const p = G.progress(null, []);
    expect(p.doneCount).toBe(0);
    expect(p.complete).toBe(false);
    expect(p.newlyProven).toEqual([]);
  });

  test('server marks count as done', () => {
    const p = G.progress({ steps: { code: '2026-11-18T10:00:00Z', desktop: '2026-11-18T10:00:00Z' } }, []);
    expect(p.steps.filter(s => s.done).map(s => s.id)).toEqual(['code', 'desktop']);
    expect(p.doneCount).toBe(2);
  });

  test('the client list proves steps and reports the ones to save', () => {
    const clients = [
      { id: 'a', status: 'pending' },
      { id: 'b', currentProgramId: 'p1', macroTargets: { calories: 2400, protein: 180 } },
      { id: 'c', coachCommentDates: ['2026-11-10'] },
    ];
    const p = G.progress({ steps: { code: '2026-11-18T10:00:00Z' } }, clients);
    expect(p.steps.filter(s => s.done).map(s => s.id)).toEqual(['code', 'client', 'program', 'macros', 'checkin']);
    expect(p.newlyProven).toEqual(['client', 'program', 'macros', 'checkin']);
  });

  test('empty macro targets and nameless programs do not count', () => {
    const done = G.stepsFromClients([{ macroTargets: { calories: 0 } }, { currentProgram: '' }, null]);
    expect(done.has('macros')).toBe(false);
    expect(done.has('program')).toBe(false);
    expect(done.has('client')).toBe(true);
  });

  test('reviewed check-in counts as a reply', () => {
    expect(G.stepsFromClients([{ reviewedCheckInDate: '2026-11-01' }]).has('checkin')).toBe(true);
  });

  test('nextStep prefers steps for this device', () => {
    const p = G.progress({ steps: { code: 'x', client: 'x' } }, []);
    expect(G.nextStep(p, 'phone').id).toBe('checkin');
    expect(G.nextStep(p, 'desktop').id).toBe('program');
  });

  test('checklist hides when complete or dismissed', () => {
    const all = Object.fromEntries(G.STEP_IDS.map(id => [id, 'x']));
    expect(G.showChecklist({ steps: all }, G.progress({ steps: all }, []))).toBe(false);
    expect(G.showChecklist({ dismissed: 'x' }, G.progress({}, []))).toBe(false);
    expect(G.showChecklist({}, G.progress({}, []))).toBe(true);
  });

  test('welcome shows once, only for coaches', () => {
    expect(G.shouldWelcome({}, true)).toBe(true);
    expect(G.shouldWelcome({ welcomeSeen: 'x' }, true)).toBe(false);
    expect(G.shouldWelcome({}, false)).toBe(false);
  });

  test('computer tour starts on first visit only', () => {
    expect(G.shouldAutoTour({}, 'desktop')).toBe(true);
    expect(G.shouldAutoTour({ tours: { desktop: 'x' } }, 'desktop')).toBe(false);
    expect(G.shouldAutoTour({}, 'phone')).toBe(false);
  });
});
