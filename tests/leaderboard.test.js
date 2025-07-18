const { calculateLeaderboard } = require('../community');

describe('calculateLeaderboard', () => {
  test('returns top 3 consistent and improving members', () => {
    const members = [
      { name: 'A', consistencyScore: 5, improvementScore: 1 },
      { name: 'B', consistencyScore: 10, improvementScore: 2 },
      { name: 'C', consistencyScore: 7, improvementScore: 8 },
      { name: 'D', consistencyScore: 1, improvementScore: 3 }
    ];
    const lb = calculateLeaderboard(members);
    expect(lb.consistent[0]).toBe('B');
    expect(lb.consistent).toContain('C');
    expect(lb.improving[0]).toBe('C');
    expect(lb.improving).toContain('D');
  });
});
