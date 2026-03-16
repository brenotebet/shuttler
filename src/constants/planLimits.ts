export type PlanKey = 'trial' | 'starter' | 'campus' | 'enterprise';

export type PlanLimits = {
  maxVehicles: number;   // max simultaneous online buses
  maxRoutes: number;     // max routes (Infinity = unlimited)
  label: string;
  price: string;
};

export const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  trial:      { maxVehicles: 3,        maxRoutes: 1,        label: 'Trial',      price: 'Free trial' },
  starter:    { maxVehicles: 3,        maxRoutes: 1,        label: 'Starter',    price: '$149/mo' },
  campus:     { maxVehicles: 8,        maxRoutes: Infinity, label: 'Campus',     price: '$299/mo' },
  enterprise: { maxVehicles: Infinity, maxRoutes: Infinity, label: 'Enterprise', price: 'Custom' },
};

/** Returns limits for the current org, falling back to trial when not yet subscribed. */
export function getPlanLimits(plan?: string | null, status?: string | null): PlanLimits {
  if (!plan || status === 'trialing' || status === 'canceled' || status === 'unpaid') {
    return PLAN_LIMITS.trial;
  }
  return PLAN_LIMITS[plan as PlanKey] ?? PLAN_LIMITS.starter;
}

/** Human-readable vehicle limit string. */
export function vehicleLimitText(limits: PlanLimits): string {
  return limits.maxVehicles === Infinity ? 'Unlimited vehicles' : `Up to ${limits.maxVehicles} vehicles`;
}

/** Human-readable route limit string. */
export function routeLimitText(limits: PlanLimits): string {
  return limits.maxRoutes === Infinity ? 'Unlimited routes' : `${limits.maxRoutes} route${limits.maxRoutes !== 1 ? 's' : ''}`;
}
