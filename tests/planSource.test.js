const { describePlanSource } = require('../src/js/plan-source');

const NOW = '2026-10-29T12:00:00Z';
const d = (opts) => describePlanSource({ now: NOW, locale: 'en-GB', ...opts });

describe('describePlanSource', () => {
  test('free account', () => {
    expect(d({ plan: 'free' })).toEqual({ status: 'No active subscription', isSubscription: false });
  });

  test('subscriptions keep their old wording (and old servers with no source)', () => {
    expect(d({ plan: 'pro', source: 'stripe_sub', subStatus: 'active' }).status).toBe('Active subscription');
    expect(d({ plan: 'pro', source: 'apple_sub', subStatus: 'trialing' }).status).toBe('Free trial active');
    expect(d({ plan: 'coach', source: 'stripe_sub', subStatus: 'past_due' }).status).toBe('Payment issue');
    expect(d({ plan: 'pro', source: null, subStatus: 'active' })).toEqual({ status: 'Active subscription', isSubscription: true });
  });

  test('passes show the end date', () => {
    expect(d({ plan: 'pro', source: 'prep_pass', expiresAt: '2027-02-14T00:00:00Z' }))
      .toEqual({ status: 'Pro via Prep Pass, until 14 Feb', isSubscription: false });
    expect(d({ plan: 'pro', source: 'meet_pass', expiresAt: '2026-12-24T00:00:00Z' }).status).toBe('Pro via Meet Pass, until 24 Dec');
  });

  test('trials count days left', () => {
    expect(d({ plan: 'pro', source: 'reverse_trial', expiresAt: '2026-11-07T12:00:00Z' }).status).toBe('Pro trial, 9 days left');
    expect(d({ plan: 'pro', source: 'moment_trial', expiresAt: '2026-10-30T06:00:00Z' }).status).toBe('Pro trial, 1 day left');
  });

  test('lifetime, referral, coach client', () => {
    expect(d({ plan: 'pro', source: 'founder_lifetime' }).status).toBe('Founder Lifetime');
    expect(d({ plan: 'pro', source: 'referral', expiresAt: '2026-11-05T00:00:00Z' }).status).toBe('Pro from referrals, until 5 Nov');
    expect(d({ plan: 'pro', source: 'coach_client' }).status).toBe('Pro, included by your coach');
  });

  test('a bad date is ignored rather than shown as "Invalid Date"', () => {
    expect(d({ plan: 'pro', source: 'prep_pass', expiresAt: 'nope' }).status).toBe('Pro via Prep Pass');
  });
});
