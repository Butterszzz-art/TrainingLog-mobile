const { sortGroups } = require('../community');

describe('sortGroups', () => {
  const groups = [
    { name: 'B', members: [1,2], posts: [{ date: '2022-01-01' }] },
    { name: 'A', members: [1], posts: [{ date: '2022-01-02' }] },
    { name: 'C', members: [1,2,3], posts: [] }
  ];

  test('sorts alphabetically', () => {
    const res = sortGroups(groups, 'alpha');
    expect(res.map(g => g.name)).toEqual(['A','B','C']);
  });

  test('sorts by most members', () => {
    const res = sortGroups(groups, 'members');
    expect(res[0].name).toBe('C');
  });

  test('sorts by recent activity', () => {
    const res = sortGroups(groups, 'active');
    expect(res[0].name).toBe('A');
  });
});
