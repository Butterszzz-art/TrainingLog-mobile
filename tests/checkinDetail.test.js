// The detailed check-in (src/js/checkin-detail.js) as stored by
// checkinEngine.js and shared with a coach by client-coaching.js.
const detail = require('../src/js/checkin-detail.js');
const { saveCheckIn, loadCheckIns } = require('../checkinEngine');
const { buildShareSnapshot } = require('../src/js/client-coaching.js');

const answers = {
  training: {
    programWeek: 'Week 3, Day 1',
    recovery: { chest: 'justInTime', hams: 'stillSore', glutes: 'nope' },
    workload: [{ day: 'Day 1', rating: 'good' }, { day: 'Day 4', rating: 'easy' }],
    jointPain: '',
    pump: 4,
  },
  nutrition: { ratings: { appetite: 3, adherence: 5 }, offPlanMeals: 'Pizza Saturday', water: 'yes' },
  lifestyle: { trainingEnergy: 3, medications: 'Vyvanse 30mg', peds: 'yes', otherFeedback: '  ' },
};

describe('checkin-detail', () => {
  test('cleans answers and drops empty or unknown ones', () => {
    const d = detail.cleanDetail(answers);
    expect(d.training.recovery).toEqual({ chest: 'justInTime', hams: 'stillSore' });
    expect(d.training.jointPain).toBeUndefined();
    expect(d.nutrition.ratings).toEqual({ appetite: 3, adherence: 5 });
    expect(d.lifestyle.otherFeedback).toBeUndefined();
    expect(detail.cleanDetail({})).toBeNull();
  });

  test('workload days follow the program, else six', () => {
    expect(detail.workloadDays(4)).toEqual(['Day 1', 'Day 2', 'Day 3', 'Day 4']);
    expect(detail.workloadDays(null)).toHaveLength(6);
  });

  test('program week label counts weeks from the start date', () => {
    expect(detail.programWeekLabel('2026-11-01', '2026-11-01')).toBe('Week 1');
    expect(detail.programWeekLabel('2026-11-01', '2026-11-19')).toBe('Week 3');
    expect(detail.programWeekLabel('2026-11-20', '2026-11-19')).toBe('');
  });

  test('flags what a coach should look at', () => {
    const texts = detail.detailFlags(answers).map(f => f.text);
    expect(texts).toContain('Still sore next session: Hams');
    expect(texts).toContain('Too easy: Day 4');
    expect(texts).toContain('Low energy in training (3/10)');
  });

  test('is kept on a saved check-in', () => {
    saveCheckIn('detail_user', { date: '2026-11-19', energy: 6, detail: answers });
    saveCheckIn('detail_user', { date: '2026-11-12', energy: 6 });
    const [latest, older] = loadCheckIns('detail_user');
    expect(latest.detail.training.programWeek).toBe('Week 3, Day 1');
    expect(older.detail).toBeUndefined();
  });

  test('is sent to the coach in the share snapshot', () => {
    const map = new Map([['tl_checkins_v1_ana', JSON.stringify([{ date: '2026-11-19', sleep: 7, detail: answers }, { date: '2026-11-12', sleep: 6 }])]]);
    const store = { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
    const snap = buildShareSnapshot(store, 'ana', new Date(2026, 10, 19, 12));
    expect(snap.checkIns[0].detail.nutrition.offPlanMeals).toBe('Pizza Saturday');
    expect(snap.checkIns[1].detail).toBeUndefined();
  });
});

describe('AI coach data pack', () => {
  test('reads check-ins where checkinEngine keeps them, with the detail as text', () => {
    const CoachData = require('../src/js/coach-data');
    const map = new Map([['tl_checkins_v1_ana', JSON.stringify([{ date: '2026-11-19', sleep: 7, detail: answers }])]]);
    const store = { getItem: k => (map.has(k) ? map.get(k) : null), setItem: () => {} };
    const pack = CoachData.buildCoachDataPack(store, 'ana', { body: true }, new Date(2026, 10, 19, 12), null);
    expect(pack.checkIns).toHaveLength(1);
    expect(pack.checkIns[0].detail).toMatch(/Hams still sore/);
  });
});
