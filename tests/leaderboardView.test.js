/**
 * @jest-environment node
 */

function makeEl() {
  return { innerHTML: '', style: {}, value: '', classList: { toggle() {} }, querySelectorAll: () => [] };
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
    const html = els.leaderboardContainer.innerHTML;
    expect(html.indexOf('alice')).toBeLessThan(html.indexOf('bob'));
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(els.lbYourRank.innerHTML).toContain('#1');

    lb.renderLeaderboard('totalVolume');
    const byVolume = els.leaderboardContainer.innerHTML;
    expect(byVolume.indexOf('bob')).toBeLessThan(byVolume.indexOf('alice'));
    expect(byVolume).toContain('9.0k kg');
  });

  test('shows the empty state when the request fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ success: false }) });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await lb.fetchLeaderboard();
    expect(els.leaderboardEmpty.style.display).toBe('block');
    console.warn.mockRestore();
  });
});
