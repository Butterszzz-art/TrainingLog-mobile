const { offerFor, ctaLabel } = require('../src/js/plan-offer');

describe('plan-offer', () => {
  const stripePro = { store: 'stripe', plan: 'pro', billing: 'annual' };

  test('no subscription: new, trial only when eligible', () => {
    expect(offerFor({ plan: 'pro', billing: 'annual', store: 'stripe', subscription: null, trialEligible: true }))
      .toEqual({ state: 'new', trial: true });
    expect(offerFor({ plan: 'pro', billing: 'annual', store: 'stripe', subscription: null, trialEligible: false }))
      .toEqual({ state: 'new', trial: false });
    expect(offerFor({ plan: 'pro', billing: 'annual', store: 'apple' }).trial).toBe(false);
  });

  test('same plan and cycle is current', () => {
    expect(offerFor({ plan: 'pro', billing: 'annual', store: 'stripe', subscription: stripePro, trialEligible: true }))
      .toEqual({ state: 'current', trial: false });
  });

  test('another plan or cycle in the same store is a switch, never a trial', () => {
    expect(offerFor({ plan: 'coach', billing: 'annual', store: 'stripe', subscription: stripePro, trialEligible: true }))
      .toEqual({ state: 'switch', trial: false });
    expect(offerFor({ plan: 'pro', billing: 'monthly', store: 'stripe', subscription: stripePro }).state).toBe('switch');
  });

  test('subscription in the other store is changed there', () => {
    expect(offerFor({ plan: 'coach', billing: 'annual', store: 'apple', subscription: stripePro }).state).toBe('other-store');
    expect(offerFor({ plan: 'pro', billing: 'annual', store: 'stripe', subscription: { store: 'apple', plan: 'pro', billing: 'annual' } }).state)
      .toBe('other-store');
  });

  test('button labels', () => {
    expect(ctaLabel({ state: 'new', trial: true }, 'Pro')).toBe('Start Free Trial');
    expect(ctaLabel({ state: 'new', trial: false }, 'Pro')).toBe('Subscribe');
    expect(ctaLabel({ state: 'current' }, 'Pro')).toBe('Current plan');
    expect(ctaLabel({ state: 'switch' }, 'Coach')).toBe('Switch to Coach');
  });
});
