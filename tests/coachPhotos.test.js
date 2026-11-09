// Pure helpers in src/js/coach-photos.js (no DOM needed).
const { groupComments, unseenCoachComments, targetCheckIn, withSessionPicks } = require('../src/js/coach-photos.js');

describe('groupComments', () => {
  test('groups by check-in date, oldest first', () => {
    const g = groupComments([
      { checkInDate: '2026-10-14', author: 'client', createdAt: '2026-10-15T09:00:00Z', text: 'b' },
      { checkInDate: '2026-10-14', author: 'coach', createdAt: '2026-10-14T20:00:00Z', text: 'a' },
      { checkInDate: '2026-10-07', author: 'coach', createdAt: '2026-10-08T08:00:00Z', text: 'c' },
      null,
    ]);
    expect(Object.keys(g).sort()).toEqual(['2026-10-07', '2026-10-14']);
    expect(g['2026-10-14'].map(c => c.text)).toEqual(['a', 'b']);
  });
});

describe('unseenCoachComments', () => {
  test('counts only coach comments after the last look', () => {
    const list = [
      { author: 'coach', createdAt: '2026-10-14T20:00:00Z' },
      { author: 'client', createdAt: '2026-10-15T09:00:00Z' },
      { author: 'coach', createdAt: '2026-10-16T09:00:00Z' },
    ];
    expect(unseenCoachComments(list, 0)).toBe(2);
    expect(unseenCoachComments(list, Date.parse('2026-10-15T00:00:00Z'))).toBe(1);
  });
});

describe('targetCheckIn', () => {
  test('is the latest check-in', () => {
    expect(targetCheckIn([{ date: '2026-10-07' }, { date: '2026-10-14' }, { date: 'bad' }]).date).toBe('2026-10-14');
    expect(targetCheckIn([])).toBe(null);
  });
});

describe('withSessionPicks', () => {
  const all = ['p1', 'p2', 'p3'];
  test('picking some photos attaches the session with a pick list', () => {
    const c = withSessionPicks({ date: '2026-10-14', posingSessionIds: ['old'] }, 's1', ['p3', 'p1'], all);
    expect(c.posingSessionIds).toEqual(['s1', 'old']);
    expect(c.posingPhotoPicks).toEqual({ s1: ['p3', 'p1'] });
  });
  test('picking every photo sends the whole set (no pick list)', () => {
    const c = withSessionPicks({ date: '2026-10-14', posingSessionIds: ['s1'], posingPhotoPicks: { s1: ['p1'] } }, 's1', all, all);
    expect(c.posingSessionIds).toEqual(['s1']);
    expect(c.posingPhotoPicks).toEqual({});
  });
  test('picking none takes the session off', () => {
    const c = withSessionPicks({ date: '2026-10-14', posingSessionIds: ['s1', 'x'], posingPhotoPicks: { s1: ['p1'] } }, 's1', [], all);
    expect(c.posingSessionIds).toEqual(['x']);
    expect(c.posingPhotoPicks).toEqual({});
  });
  test('ignores ids that are not in the session and keeps the set cap', () => {
    const ids = Array.from({ length: 10 }, (_v, i) => 'o' + i);
    const c = withSessionPicks({ date: '2026-10-14', posingSessionIds: ids }, 's1', ['p2', 'nope'], all);
    expect(c.posingSessionIds).toHaveLength(10);
    expect(c.posingSessionIds[0]).toBe('s1');
    expect(c.posingPhotoPicks).toEqual({ s1: ['p2'] });
  });
});
