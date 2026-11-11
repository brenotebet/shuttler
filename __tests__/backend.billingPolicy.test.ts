// __tests__/backend.billingPolicy.test.ts
// Tests for how Stripe subscription state maps onto an org's billing fields
// (POST /stripe/webhook).

import {
  BUS_STALE_MS,
  dataAddonAction,
  holdsVehicleSlot,
  isLiveSubscription,
  mainSubscriptionAction,
  planForSubscription,
  VEHICLE_CLAIM_MS,
  vehicleCap,
} from '../backend/billingPolicy';
import { getPlanLimits } from '../src/constants/planLimits';

describe('mainSubscriptionAction', () => {
  it("mirrors the org's current subscription", () => {
    expect(mainSubscriptionAction('sub_A', { id: 'sub_A', status: 'active' }, false)).toBe('apply');
    expect(mainSubscriptionAction('sub_A', { id: 'sub_A', status: 'past_due' }, false)).toBe('apply');
  });

  it('adopts a live subscription when the org has none yet', () => {
    expect(mainSubscriptionAction(undefined, { id: 'sub_A', status: 'active' }, false)).toBe('apply');
    expect(mainSubscriptionAction(null, { id: 'sub_A', status: 'trialing' }, false)).toBe('apply');
  });

  it("leaves a trial org alone while its first payment hasn't completed", () => {
    // Applying 'incomplete' / 'incomplete_expired' would lock the org out of
    // its trial over a payment that's still processing or was abandoned.
    expect(mainSubscriptionAction(null, { id: 'sub_A', status: 'incomplete' }, false)).toBe('ignore');
    expect(mainSubscriptionAction(null, { id: 'sub_A', status: 'incomplete_expired' }, false)).toBe('ignore');
    expect(mainSubscriptionAction(null, { id: 'sub_A', status: 'incomplete_expired' }, true)).toBe('ignore');
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
  });

  it('deactivates an add-on with no recorded subscription (set up before ids were stored)', () => {
    expect(dataAddonAction(undefined, { id: 'sub_X', status: 'canceled' }, true)).toBe('deactivate');
  });

  it("doesn't let an abandoned add-on checkout switch off an add-on paid for before ids were stored", () => {
    expect(dataAddonAction(undefined, { id: 'sub_new', status: 'incomplete_expired' }, false)).toBe('ignore');
    expect(dataAddonAction(undefined, { id: 'sub_new', status: 'incomplete_expired' }, true)).toBe('ignore');
  });

  it('ignores an old add-on subscription ending', () => {
    expect(dataAddonAction('sub_Y', { id: 'sub_X', status: 'canceled' }, true)).toBe('ignore');
  });
});

describe('isLiveSubscription', () => {
  it('treats active, trialing and past-due subscriptions as live', () => {
    expect(isLiveSubscription('active')).toBe(true);
    expect(isLiveSubscription('trialing')).toBe(true);
    expect(isLiveSubscription('past_due')).toBe(true);
  });

  it('lets ended or never-started subscriptions go through a new checkout', () => {
    for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired']) {
      expect(isLiveSubscription(status)).toBe(false);
    }
  });
});

describe('planForSubscription', () => {
  const PRICES = { starter: 'price_starter', campus: 'price_campus', enterprise: '' };

  it('reads the plan from the price, not stale metadata, after a portal plan switch', () => {
    expect(planForSubscription(['price_campus'], PRICES, 'starter')).toBe('campus');
  });

  it('falls back to metadata for a custom (e.g. Enterprise) price', () => {
    expect(planForSubscription(['price_custom_deal'], PRICES, 'enterprise')).toBe('enterprise');
  });

  it('defaults to starter with no match and no metadata', () => {
    expect(planForSubscription(['price_custom_deal'], PRICES, undefined)).toBe('starter');
  });

  it('never matches an unconfigured (empty) price id', () => {
    expect(planForSubscription([''], PRICES, 'campus')).toBe('campus');
  });
});

describe('vehicleCap', () => {
  it('matches the app\'s getPlanLimits for every plan and status', () => {
    const plans = [null, 'starter', 'campus', 'enterprise', 'unknown'];
    const statuses = ['trialing', 'active', 'past_due', 'canceled', 'unpaid'];
    const overrides = [null, { maxVehicles: 22 }];
    for (const plan of plans) for (const status of statuses) for (const o of overrides) {
      expect(vehicleCap(plan, status, o)).toBe(getPlanLimits(plan, status, o).maxVehicles);
    }
  });

  it('ignores an invalid override', () => {
    expect(vehicleCap('enterprise', 'active', { maxVehicles: 0 })).toBe(15);
    expect(vehicleCap('enterprise', 'active', { maxVehicles: '22' })).toBe(15);
  });
});

describe('holdsVehicleSlot', () => {
  const NOW = 1_800_000_000_000;

  it('counts a bus that is online and recently written', () => {
    expect(holdsVehicleSlot({ online: true, updatedAtMs: NOW - 10_000 }, NOW)).toBe(true);
  });

  it('frees the slot of a bus gone quiet or offline', () => {
    expect(holdsVehicleSlot({ online: true, updatedAtMs: NOW - BUS_STALE_MS }, NOW)).toBe(false);
    expect(holdsVehicleSlot({ online: false, updatedAtMs: NOW - 10_000 }, NOW)).toBe(false);
    expect(holdsVehicleSlot({ online: true, updatedAtMs: null }, NOW)).toBe(false);
  });

  it('keeps the slot of a bus on a break that has not run out', () => {
    const quiet = NOW - 10 * 60_000;
    expect(holdsVehicleSlot({ online: true, updatedAtMs: quiet, onBreak: true, breakEndsAtMs: NOW + 60_000 }, NOW)).toBe(true);
    expect(holdsVehicleSlot({ online: true, updatedAtMs: quiet, onBreak: true, breakEndsAtMs: NOW - 1 }, NOW)).toBe(false);
    expect(holdsVehicleSlot({ online: false, onBreak: true, breakEndsAtMs: NOW + 60_000 }, NOW)).toBe(false);
  });

  it('holds a fresh claim until it expires', () => {
    expect(holdsVehicleSlot({ capClaimAtMs: NOW - 1_000 }, NOW)).toBe(true);
    expect(holdsVehicleSlot({ capClaimAtMs: NOW - VEHICLE_CLAIM_MS }, NOW)).toBe(false);
  });
});
