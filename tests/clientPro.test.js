const { nextMessage } = require('../src/js/client-pro');
const { describePlanSource } = require('../src/js/plan-source');

const NOW = new Date('2026-10-29T12:00:00Z');
const daysAgo = n => new Date(NOW.getTime() - n * 86400000).toISOString();
const active = { active: true, coachUid: 'c1', coachName: 'coachcarl', grantedAt: daysAgo(1), regrantedAt: null };

describe('Client Pro messages', () => {
  test('double-pay notice for an own Stripe/Apple subscriber, once', () => {
    const m = nextMessage({ clientPro: active, planSource: 'stripe_sub', plan: 'pro', now: NOW });
    expect(m.type).toBe('double-pay');
    expect(nextMessage({ clientPro: active, planSource: 'apple_sub', plan: 'pro', now: NOW }).type).toBe('double-pay');
    expect(nextMessage({ clientPro: active, planSource: 'stripe_sub', plan: 'pro', now: NOW, seen: { [m.key]: 1 } })).toBeNull();
  });

  test('no notice for passes, lifetime, or plain Client Pro', () => {
    for (const src of ['prep_pass', 'meet_pass', 'founder_lifetime', 'coach_client']) {
      expect(nextMessage({ clientPro: active, planSource: src, plan: 'pro', now: NOW })).toBeNull();
    }
  });

  test('end sheet when Client Pro ends and nothing else gives Pro, once per revocation', () => {
    const ended = { active: false, coachUid: 'c1', revokedAt: daysAgo(1), revokedReason: 'unlinked' };
    const m = nextMessage({ clientPro: ended, plan: 'free', now: NOW });
    expect(m.type).toBe('ended');
    expect(nextMessage({ clientPro: ended, plan: 'free', now: NOW, seen: { [m.key]: 1 } })).toBeNull();
    // a later revocation is a new message
    expect(nextMessage({ clientPro: { ...ended, revokedAt: daysAgo(0) }, plan: 'free', now: NOW, seen: { [m.key]: 1 } }).type).toBe('ended');
  });

  test('no end sheet while another source still gives Pro', () => {
    const ended = { active: false, coachUid: 'c1', revokedAt: daysAgo(1), revokedReason: 'inactive' };
    expect(nextMessage({ clientPro: ended, plan: 'pro', planSource: 'prep_pass', now: NOW })).toBeNull();
  });

  test('coach plan lapse waits 7 days (billing retries)', () => {
    const lapsed = d => ({ active: false, coachUid: 'c1', revokedAt: daysAgo(d), revokedReason: 'coach_plan_lapsed' });
    expect(nextMessage({ clientPro: lapsed(6), plan: 'free', now: NOW })).toBeNull();
    expect(nextMessage({ clientPro: lapsed(7), plan: 'free', now: NOW }).type).toBe('ended');
    // inactivity / unlink don't wait
    expect(nextMessage({ clientPro: { ...lapsed(1), revokedReason: 'inactive' }, plan: 'free', now: NOW }).type).toBe('ended');
  });

  test('re-grant after a lapse counts as a new double-pay grant', () => {
    const a = nextMessage({ clientPro: active, planSource: 'stripe_sub', plan: 'pro', now: NOW });
    const b = nextMessage({ clientPro: { ...active, regrantedAt: daysAgo(0) }, planSource: 'stripe_sub', plan: 'pro', now: NOW });
    expect(b.key).not.toBe(a.key);
  });
});

describe('Subscription panel wording', () => {
  test('names the coach', () => {
    expect(describePlanSource({ plan: 'pro', source: 'coach_client', coachName: 'coachcarl' }).status)
      .toBe('Pro, included by your coach coachcarl');
  });
});
