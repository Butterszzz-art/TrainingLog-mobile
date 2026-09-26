/**
 * @jest-environment node
 */

function makeEl() {
  return {
    innerHTML: '', style: { setProperty() {} }, value: '', textContent: '', dataset: {},
    classList: { toggle() {}, add() {}, remove() {} },
    querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
  };
}

function setupDom() {
  const els = {};
  global.document = {
    getElementById: id => (els[id] = els[id] || makeEl()),
    querySelectorAll: () => [],
  };
  global.localStorage = {
    store: { token: 't', fitnessAppUser: 'alice' },
    getItem(k) { return this.store[k] ?? null; },
    setItem(k, v) { this.store[k] = String(v); },
  };
  global.window = { SERVER_URL: 'https://api.test' };
  return els;
}

describe('leaderboard view', () => {
  let lb;
  let els;

  beforeEach(() => {
    jest.resetModules();
    els = setupDom();
    lb = require('../leaderboard');
  });

  afterEach(() => {
    delete global.fetch;
    delete global.document;
    delete global.localStorage;
    delete global.window;
  });

  test('normalizes the backend { items } response', () => {
    const rows = lb.normalizeLeaderboardResponse({
      success: true,
      items: [
        { username: 'alice', totalVolume: 1234.6, workoutCount: 3 },
        { username: '', totalVolume: 5, workoutCount: 1 },
      ],
    });
    expect(rows).toEqual([{ name: 'alice', workoutsLogged: 3, totalVolume: 1235 }]);
  });

  test('returns [] for unexpected payloads', () => {
    expect(lb.normalizeLeaderboardResponse(null)).toEqual([]);
    expect(lb.normalizeLeaderboardResponse({ success: false, error: 'x' })).toEqual([]);
  });

  test('fetches, renders ranked cards and escapes usernames', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        items: [
          { username: 'bob', totalVolume: 9000, workoutCount: 2 },
          { username: '<img src=x onerror=alert(1)>', totalVolume: 100, workoutCount: 1 },
          { username: 'alice', totalVolume: 500, workoutCount: 5 },
        ],
      }),
    });

    await lb.fetchLeaderboard();
    expect(global.fetch).toHaveBeenCalledWith('https://api.test/leaderboard', expect.any(Object));
    expect(els.leaderboardEmpty.style.display).toBe('none');

    lb.renderLeaderboard('workoutsLogged');
    const podium = els.lbPodium.innerHTML;
    // Podium order is 2 · 1 · 3: bob (2 workouts), alice (5), then the <img> user (1)
    expect(podium.indexOf('bob')).toBeLessThan(podium.indexOf('alice'));
    expect(podium).toContain('sx-pd r1');
    expect(podium).not.toContain('<img');
    expect(podium).toContain('&lt;img');
    expect(els.leaderboardContainer.innerHTML).toBe('');
    expect(els.lbYourRank.innerHTML).toContain('#1');
    expect(els.lbYourRank.innerHTML).toContain('top of the board');

    lb.renderLeaderboard('totalVolume');
    expect(els.lbYourRank.innerHTML).toContain('#2');
    expect(els.lbYourRank.innerHTML).toContain('8.5k kg');
    expect(els.lbPodium.innerHTML).toContain('9.0');
  });

  test('shows the empty state when the request fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ success: false }) });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await lb.fetchLeaderboard();
    expect(els.leaderboardEmpty.style.display).toBe('block');
    console.warn.mockRestore();
  });

  test('rank deltas compare against the first board seen this week', () => {
    const board = names => names.map(n => ({ name: n }));
    const first = lb.computeRankDeltas(board(['a', 'b', 'c']), 'workoutsLogged', null, '2026-09-21');
    expect(first.deltas).toEqual({ a: 0, b: 0, c: 0 });

    const later = lb.computeRankDeltas(board(['c', 'a', 'b']), 'workoutsLogged', first.baseline, '2026-09-21');
    expect(later.deltas).toEqual({ c: 2, a: -1, b: -1 });

    // A new week resets the baseline
    const nextWeek = lb.computeRankDeltas(board(['c', 'a', 'b']), 'workoutsLogged', later.baseline, '2026-09-28');
    expect(nextWeek.deltas).toEqual({ c: 0, a: 0, b: 0 });
  });

  test('around-you window stays five wide near the ends', () => {
    expect(lb.aroundYouWindow(20, 9)).toEqual([7, 8, 9, 10, 11]);
    expect(lb.aroundYouWindow(20, 19)).toEqual([15, 16, 17, 18, 19]);
    expect(lb.aroundYouWindow(20, 0)).toEqual([0, 1, 2, 3, 4]);
    expect(lb.aroundYouWindow(3, 1)).toEqual([0, 1, 2]);
    expect(lb.aroundYouWindow(10, -1)).toEqual([]);
  });

  test('weekly series buckets workouts into Monday-start weeks', () => {
    const today = new Date(2026, 8, 26); // Sat 26 Sep 2026
    const workouts = [
      { date: '2026-09-21' },                         // this week (Mon)
      { date: '2026-09-26' },                         // this week (today)
      { date: '2026-09-20' },                         // last week (Sun)
      { date: '2026-09-14', log: [{ weightsArray: [100], repsArray: [5] }] }, // last week (Mon)
      { date: '2026-07-01' },                         // too old
    ];
    expect(lb.weeklySeries(workouts, 'workoutsLogged', 4, today)).toEqual([0, 0, 2, 2]);
    expect(lb.weeklySeries(workouts, 'totalVolume', 4, today)).toEqual([0, 0, 500, 0]);
  });
});
