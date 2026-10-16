// __tests__/backend.billingPolicy.test.ts
// Tests for how Stripe subscription state maps onto an org's billing fields
// (POST /stripe/webhook).

import { dataAddonAction, mainSubscriptionAction } from '../backend/billingPolicy';

describe('mainSubscriptionAction', () => {
  it("mirrors the org's current subscription", () => {
    expect(mainSubscriptionAction('sub_A', { id: 'sub_A', status: 'active' }, false)).toBe('apply');
    expect(mainSubscriptionAction('sub_A', { id: 'sub_A', status: 'past_due' }, false)).toBe('apply');
  });

  it('adopts a subscription when the org has none yet', () => {
    expect(mainSubscriptionAction(undefined, { id: 'sub_A', status: 'active' }, false)).toBe('apply');
    expect(mainSubscriptionAction(null, { id: 'sub_A', status: 'incomplete' }, false)).toBe('apply');
  });

  it('cancels the org when its current subscription ends', () => {
    expect(mainSubscriptionAction('sub_A', { id: 'sub_A', status: 'canceled' }, true)).toBe('cancel');
  });

  it('cancels when a late "updated" event arrives for a subscription that has since been canceled', () => {
    // The webhook re-fetches the subscription, so a stale event sees the
    // current (canceled) status instead of reactivating the org.
    expect(mainSubscriptionAction('sub_A', { id: 'sub_A', status: 'canceled' }, false)).toBe('cancel');
  });

  it('ignores an old subscription ending while the org pays for a newer one', () => {
    expect(mainSubscriptionAction('sub_B', { id: 'sub_A', status: 'canceled' }, true)).toBe('ignore');
    expect(mainSubscriptionAction('sub_B', { id: 'sub_A', status: 'canceled' }, false)).toBe('ignore');
  });

  it('ignores non-live updates from a subscription that is not current', () => {
    expect(mainSubscriptionAction('sub_B', { id: 'sub_A', status: 'past_due' }, false)).toBe('ignore');
    expect(mainSubscriptionAction('sub_B', { id: 'sub_A', status: 'incomplete' }, false)).toBe('ignore');
  });

  it('switches to a different subscription once it is live', () => {
    expect(mainSubscriptionAction('sub_A', { id: 'sub_B', status: 'active' }, false)).toBe('apply');
    expect(mainSubscriptionAction('sub_A', { id: 'sub_B', status: 'trialing' }, false)).toBe('apply');
  });
});

describe('dataAddonAction', () => {
  it('activates only once the add-on subscription is live', () => {
    expect(dataAddonAction(undefined, { id: 'sub_X', status: 'active' }, false)).toBe('activate');
    expect(dataAddonAction(undefined, { id: 'sub_X', status: 'incomplete' }, false)).toBe('ignore');
  });

  it('keeps the add-on as is while a payment is being retried', () => {
    expect(dataAddonAction('sub_X', { id: 'sub_X', status: 'past_due' }, false)).toBe('ignore');
  });

  it("deactivates when the org's add-on subscription ends", () => {
    expect(dataAddonAction('sub_X', { id: 'sub_X', status: 'canceled' }, true)).toBe('deactivate');
    expect(dataAddonAction('sub_X', { id: 'sub_X', status: 'unpaid' }, false)).toBe('deactivate');
    expect(dataAddonAction('sub_X', { id: 'sub_X', status: 'incomplete_expired' }, false)).toBe('deactivate');
  });

  it('deactivates an add-on with no recorded subscription (set up before ids were stored)', () => {
    expect(dataAddonAction(undefined, { id: 'sub_X', status: 'canceled' }, true)).toBe('deactivate');
  });

  it('ignores an old add-on subscription ending', () => {
    expect(dataAddonAction('sub_Y', { id: 'sub_X', status: 'canceled' }, true)).toBe('ignore');
  });
});
