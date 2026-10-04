const { pickNextStep, recordShown, recordTapped, recordDismissed } = require('../src/js/next-step-chips');

const TODAY = '2026-10-04';

function ctx(extra = {}) {
  return {
    exercise: 'Bench Press', workoutDays: 4, exerciseDays: 1, hasProgram: true,
    hasMacroTargets: true, weighIns: 2, checkInThisWeek: true, coachAvailable: false,
    ...extra,
  };
}

describe('pickNextStep rules', () => {
  test('first ever workout points at Progress', () => {
    expect(pickNextStep('workout', ctx({ workoutDays: 1 }), {}, TODAY).id).toBe('first-workout');
  });

  test('a lift with 3+ sessions offers its trend, naming the exercise', () => {
    const chip = pickNextStep('workout', ctx({ exerciseDays: 3 }), {}, TODAY);
    expect(chip.id).toBe('lift-trend');
    expect(chip.text).toContain('3 Bench Press sessions');
    expect(chip.action).toEqual({ tab: 'progressTab' });
  });

  test('no program after a few sessions suggests Program', () => {
    expect(pickNextStep('workout', ctx({ hasProgram: false }), {}, TODAY).id).toBe('try-program');
  });

  test('coach chips only appear when the coach is available', () => {
    expect(pickNextStep('workout', ctx({ workoutDays: 6 }), {}, TODAY)).toBeNull();
    const chip = pickNextStep('workout', ctx({ workoutDays: 6, coachAvailable: true }), {}, TODAY);
    expect(chip.id).toBe('coach-session');
    expect(typeof chip.action.coach).toBe('string');
  });

  test('weigh-in prefers missing macros, then check-in, then coach', () => {
    expect(pickNextStep('weighin', ctx({ hasMacroTargets: false, checkInThisWeek: false }), {}, TODAY)).toMatchObject({ id: 'weighin-macros', action: { tab: 'macroTab' } });
    expect(pickNextStep('weighin', ctx({ checkInThisWeek: false }), {}, TODAY).id).toBe('weighin-checkin');
    expect(pickNextStep('weighin', ctx({ weighIns: 6, coachAvailable: true }), {}, TODAY).id).toBe('weighin-coach');
    expect(pickNextStep('weighin', ctx(), {}, TODAY)).toBeNull();
  });

  test('check-in points at Progress first', () => {
    expect(pickNextStep('checkin', ctx(), {}, TODAY).id).toBe('checkin-progress');
  });
});

describe('pacing', () => {
  test('one chip per trigger per day, resets the next day', () => {
    const c = ctx({ workoutDays: 1 });
    const chip = pickNextStep('workout', c, {}, TODAY);
    const s = recordShown({}, chip, TODAY);
    expect(pickNextStep('workout', c, s, TODAY)).toBeNull();
    expect(pickNextStep('workout', c, s, '2026-10-05').id).toBe('first-workout');
  });

  test('at most two chips per day across triggers', () => {
    let s = recordShown({}, { id: 'a', trigger: 'workout' }, TODAY);
    s = recordShown(s, { id: 'b', trigger: 'weighin' }, TODAY);
    expect(pickNextStep('checkin', ctx(), s, TODAY)).toBeNull();
  });

  test('tapping retires the chip so the next rule takes over', () => {
    const chip = pickNextStep('checkin', ctx({ coachAvailable: true }), {}, TODAY);
    const s = recordTapped({}, chip);
    expect(pickNextStep('checkin', ctx({ coachAvailable: true }), s, TODAY).id).toBe('checkin-coach');
  });

  test('a chip is retired after two dismissals or three shows', () => {
    const chip = { id: 'checkin-progress', trigger: 'checkin' };
    let s = recordDismissed(recordDismissed({}, chip), chip);
    expect(pickNextStep('checkin', ctx(), s, TODAY)).toBeNull();

    s = {};
    for (const day of ['2026-10-01', '2026-10-02', '2026-10-03']) s = recordShown(s, chip, day);
    expect(pickNextStep('checkin', ctx(), s, TODAY)).toBeNull();
  });

  test('repeated dismissals with no taps turn chips off', () => {
    let s = {};
    ['a', 'b', 'c', 'd'].forEach(id => { s = recordDismissed(s, { id, trigger: 'workout' }); });
    expect(s.off).toBe(true);
    expect(pickNextStep('workout', ctx({ workoutDays: 1 }), s, TODAY)).toBeNull();
  });

  test('a user who taps sometimes is never switched off', () => {
    let s = recordTapped({}, { id: 'x', trigger: 'workout' });
    ['a', 'b', 'c', 'd', 'e'].forEach(id => { s = recordDismissed(s, { id, trigger: 'workout' }); });
    expect(s.off).toBe(false);
  });
});
