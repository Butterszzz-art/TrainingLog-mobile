global.window = global;
const { pendingCoachPrograms, programRevOf } = require('../src/js/client-coaching.js');

const program = { title: 'Upper/Lower', days: [{}, {}, {}, {}], frequency: ['Mon', 'Tue', 'Thu', 'Fri'], rev: { _seconds: 100 } };
const invites = [
  { coachUid: 'c1', coachUsername: 'sam', status: 'active' },
  { coachUid: 'c2', coachUsername: 'lee', status: 'pending' },
];

describe('pendingCoachPrograms', () => {
  test('lists an assigned program the client has not started', () => {
    const out = pendingCoachPrograms({ invites, assignments: [{ coachUid: 'c1', program }], started: {} });
    expect(out).toEqual([expect.objectContaining({ kind: 'program', coachUid: 'c1', coachUsername: 'sam', title: 'Upper/Lower', days: 4, rev: '100', updated: false })]);
  });

  test('drops it once started at that revision', () => {
    expect(pendingCoachPrograms({ invites, assignments: [{ coachUid: 'c1', program }], started: { c1: '100' } })).toEqual([]);
  });

  test('brings it back as updated when the coach sends a new version', () => {
    const out = pendingCoachPrograms({ invites, assignments: [{ coachUid: 'c1', program }], started: { c1: '50' } });
    expect(out[0].updated).toBe(true);
  });

  test('ignores pending coaches, assignments without a program body and plan coaches', () => {
    const assignments = [{ coachUid: 'c1', currentProgram: 'Gone' }, { coachUid: 'c2', program }];
    expect(pendingCoachPrograms({ invites, assignments, started: {} })).toEqual([]);
    expect(pendingCoachPrograms({ invites, assignments: [{ coachUid: 'c1', program }], started: {}, skipUids: new Set(['c1']) })).toEqual([]);
  });

  test('programRevOf matches the Your Coach Started marker', () => {
    expect(programRevOf(program)).toBe('100');
    expect(programRevOf({ title: 'X' })).toBe('X');
    expect(programRevOf(null)).toBe('');
  });
});
