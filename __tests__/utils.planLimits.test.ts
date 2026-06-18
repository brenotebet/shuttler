// __tests__/utils.planLimits.test.ts
// Tests for plan limit resolution, including per-org Enterprise overrides
// stamped on the org doc by the Stripe webhook (limitOverrides).

import { getPlanLimits, PLAN_LIMITS } from '../src/constants/planLimits';

describe('getPlanLimits', () => {
  it('returns tier defaults for active plans', () => {
    expect(getPlanLimits('starter', 'active')).toEqual(PLAN_LIMITS.starter);
    expect(getPlanLimits('campus', 'active')).toEqual(PLAN_LIMITS.campus);
    expect(getPlanLimits('enterprise', 'active')).toEqual(PLAN_LIMITS.enterprise);
  });

  it('enterprise base includes 15 vehicles with unlimited routes and stops', () => {
    const limits = getPlanLimits('enterprise', 'active');
    expect(limits.maxVehicles).toBe(15);
    expect(limits.maxRoutes).toBe(Infinity);
    expect(limits.maxStops).toBe(Infinity);
  });

  it('falls back to trial when not subscribed or subscription lapsed', () => {
    expect(getPlanLimits(undefined, undefined)).toEqual(PLAN_LIMITS.trial);
    expect(getPlanLimits('campus', 'trialing')).toEqual(PLAN_LIMITS.trial);
    expect(getPlanLimits('enterprise', 'canceled')).toEqual(PLAN_LIMITS.trial);
    expect(getPlanLimits('enterprise', 'unpaid')).toEqual(PLAN_LIMITS.trial);
  });

  it('falls back to starter limits for unknown plan keys', () => {
    expect(getPlanLimits('nonsense', 'active')).toEqual(PLAN_LIMITS.starter);
  });

  it('applies a negotiated vehicle override on an active plan', () => {
    const limits = getPlanLimits('enterprise', 'active', { maxVehicles: 22 });
    expect(limits.maxVehicles).toBe(22);
    expect(limits.maxRoutes).toBe(Infinity);
    expect(limits.label).toBe('Enterprise');
  });

  it('keeps past_due subscriptions on their negotiated limits', () => {
    expect(getPlanLimits('enterprise', 'past_due', { maxVehicles: 22 }).maxVehicles).toBe(22);
  });

  it('ignores overrides when the subscription has lapsed', () => {
    expect(getPlanLimits('enterprise', 'canceled', { maxVehicles: 22 })).toEqual(PLAN_LIMITS.trial);
  });

  it('ignores invalid override values', () => {
    expect(getPlanLimits('enterprise', 'active', { maxVehicles: 0 }).maxVehicles).toBe(15);
    expect(getPlanLimits('enterprise', 'active', { maxVehicles: -5 }).maxVehicles).toBe(15);
    expect(getPlanLimits('enterprise', 'active', { maxVehicles: NaN }).maxVehicles).toBe(15);
    expect(getPlanLimits('enterprise', 'active', { maxVehicles: '22' as unknown as number }).maxVehicles).toBe(15);
  });

  it('treats missing overrides object as tier defaults', () => {
    expect(getPlanLimits('enterprise', 'active', null)).toEqual(PLAN_LIMITS.enterprise);
    expect(getPlanLimits('enterprise', 'active', {})).toEqual(PLAN_LIMITS.enterprise);
  });
});
