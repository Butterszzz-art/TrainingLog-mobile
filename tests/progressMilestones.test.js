const { calculateStreak } = require('../progressMilestones');

test('calculateStreak counts consecutive days', () => {
  const today = new Date();
  const y1 = new Date(); y1.setDate(today.getDate()-1);
  const y2 = new Date(); y2.setDate(today.getDate()-2);
  const dates = [y2.toISOString().split('T')[0], y1.toISOString().split('T')[0], today.toISOString().split('T')[0]];
  expect(calculateStreak(dates)).toBe(3);
});
