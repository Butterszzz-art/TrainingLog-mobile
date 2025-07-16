const { filterGroups } = require('../community');

describe('filterGroups', () => {
  test('filters by goal and tag', () => {
    const groups = [
      { name: 'A', goal: 'Powerlifting', tags: ['strength', 'beginner'] },
      { name: 'B', goal: 'Bodybuilding', tags: ['hypertrophy'] },
      { name: 'C', goal: 'Powerlifting', tags: ['strength', 'advanced'] }
    ];
    const res = filterGroups(groups, { goal: 'powerlifting', tag: 'strength' });
    expect(res.length).toBe(2);
    const names = res.map(g => g.name);
    expect(names).toContain('A');
    expect(names).toContain('C');
  });
});
