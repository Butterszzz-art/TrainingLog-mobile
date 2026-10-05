const G = require('../src/js/guide-core');

const TODAY = '2026-10-05'; // Monday, ISO week 41

function ctx(extra = {}) {
  return {
    workoutDays: 0, hasProgram: false, hasMacroTargets: false, weighIns: 0, checkIns: 0,
    sleepNights: 0, cardioSessions: 0, daysActive: 0, visited: {},
    ...extra,
  };
}

describe('goal paths', () => {
  test('every goal has 5 steps pointing at real tabs', () => {
    expect(G.GOALS).toHaveLength(5);
    G.GOALS.forEach(g => {
      expect(g.steps).toHaveLength(5);
      g.steps.forEach(s => expect(s.tab).toMatch(/Tab$/));
    });
  });

  test('steps tick off from data and next is the first undone step', () => {
    const p = G.goalProgress('muscle', ctx({ workoutDays: 2, hasMacroTargets: true }));
    expect(p.doneCount).toBe(2);
    expect(p.next.id).toBe('program');
    expect(p.complete).toBe(false);
  });

  test('visit-based steps count once the tab is opened', () => {
    const before = G.goalProgress('prep', ctx({ hasMacroTargets: true, weighIns: 3, checkIns: 1, visited: { progressTab: true } }));
    expect(before.next.id).toBe('posing');
    const after = G.goalProgress('prep', ctx({ hasMacroTargets: true, weighIns: 3, checkIns: 1, visited: { progressTab: true, posingTab: true } }));
    expect(after.complete).toBe(true);
    expect(after.next).toBeNull();
  });

  test('unknown goal returns null', () => {
    expect(G.goalProgress('nope', ctx())).toBeNull();
  });
});

describe('search', () => {
  const names = q => G.searchFeatures(q).map(f => f.name);

  test('finds features by task words, not just names', () => {
    expect(names('weight')[0]).toBe('Weight');
    expect(names('photos')).toEqual(expect.arrayContaining(['Check-in', 'Posing']));
    expect(names('calories')[0]).toBe('Macros');
    expect(names('stretch')[0]).toBe('Flexibility');
  });

  test('prefix matching and case/accents are forgiving', () => {
    expect(names('Prog')).toEqual(expect.arrayContaining(['Programs']));
    expect(names('SLÉEP')[0]).toBe('Sleep');
  });

  test('multi-word queries need every word to match', () => {
    expect(names('bench deadlift')).toEqual(['Lifting tools']);
    expect(names('weight zzzz')).toEqual([]);
  });

  test('blank query returns nothing', () => {
    expect(G.searchFeatures('   ')).toEqual([]);
  });
});

describe('new dots (usage milestones)', () => {
  test('a feature is new only once ready and never opened', () => {
    expect(G.isNew('programTab', ctx({ workoutDays: 1 }))).toBe(false);
    expect(G.isNew('programTab', ctx({ workoutDays: 3 }))).toBe(true);
    expect(G.isNew('programTab', ctx({ workoutDays: 3, visited: { programTab: true } }))).toBe(false);
  });

  test('always-ready features are new until opened', () => {
    expect(G.isNew('librariesTab', ctx())).toBe(true);
  });
});

describe('discover card', () => {
  test('day one: no unlocks, a weekly tip for something ready', () => {
    const pick = G.pickDiscover(ctx(), {}, TODAY);
    expect(pick.kind).toBe('tip');
    expect(pick.week).toBe('2026-W41');
    expect(['weightTab', 'macroTab', 'cardioTab', 'librariesTab']).toContain(pick.tab);
  });

  test('a reached milestone shows as an unlock first', () => {
    const pick = G.pickDiscover(ctx({ workoutDays: 3 }), {}, TODAY);
    expect(pick).toMatchObject({ kind: 'unlock', tab: 'programTab' });
    expect(pick.text).toContain('3 sessions');
  });

  test('a seen unlock gives way to the next one', () => {
    const pick = G.pickDiscover(ctx({ workoutDays: 3 }), { seen: { programTab: true } }, TODAY);
    expect(pick).toMatchObject({ kind: 'unlock', tab: 'progressTab' });
  });

  test('the weekly tip sticks for the week, and stops once done', () => {
    const state = { weekly: { week: '2026-W41', tab: 'librariesTab' } };
    expect(G.pickDiscover(ctx(), state, '2026-10-08')).toMatchObject({ kind: 'tip', tab: 'librariesTab' });
    expect(G.pickDiscover(ctx(), { weekly: { ...state.weekly, done: true } }, '2026-10-08')).toBeNull();
    expect(G.pickDiscover(ctx(), state, '2026-10-12').week).toBe('2026-W42');
  });

  test('snoozed until a date', () => {
    expect(G.pickDiscover(ctx({ workoutDays: 3 }), { hiddenUntil: '2026-10-07' }, TODAY)).toBeNull();
  });
});

describe('isoWeek', () => {
  test('handles year boundaries', () => {
    expect(G.isoWeek('2026-01-01')).toBe('2026-W01');
    expect(G.isoWeek('2027-01-01')).toBe('2026-W53');
    expect(G.isoWeek('2026-10-04')).toBe('2026-W40');
  });
});

describe('suggestGoal (from onboarding answers)', () => {
  test('maps archetype and goal to a path', () => {
    expect(G.suggestGoal({ athleteArchetype: 'powerlifter', primaryGoal: 'cut' })).toBe('strength');
    expect(G.suggestGoal({ primaryGoal: 'cut' })).toBe('fatloss');
    expect(G.suggestGoal({ primaryGoal: 'bulk' })).toBe('muscle');
    expect(G.suggestGoal({ primaryGoal: 'maintain' })).toBe('habit');
    expect(G.suggestGoal({})).toBeNull();
    expect(G.suggestGoal(null)).toBeNull();
  });
});
