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

  test('filters by search across name, goal and tags', () => {
    const groups = [
      { name: 'Strength Stars', goal: 'Build muscle', tags: ['hypertrophy'] },
      { name: 'Endurance Club', goal: 'Improve cardio', tags: ['running'] },
      { name: 'Powerlifters', goal: 'Powerlifting', tags: ['strength'] }
    ];
    const res = filterGroups(groups, { search: 'strength' });
    expect(res.length).toBe(2);
    const names = res.map(g => g.name);
    expect(names).toContain('Strength Stars');
    expect(names).toContain('Powerlifters');
  });
});
