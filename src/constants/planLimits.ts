export type PlanKey = 'trial' | 'starter' | 'campus' | 'enterprise';

export type PlanLimits = {
  maxVehicles: number;   // max simultaneous online buses
  maxRoutes: number;     // max routes (Infinity = unlimited)
  maxStops: number;      // max total stops (Infinity = unlimited)
  label: string;
  price: string;
};

// Per-org overrides for negotiated Enterprise deals. Stamped on the org doc by
// the Stripe webhook from subscription metadata (e.g. maxVehicles: "22").
export type PlanLimitOverrides = {
  maxVehicles?: number;
  maxRoutes?: number;
  maxStops?: number;
};

export const PLAN_LIMITS: Record<PlanKey, PlanLimits> = {
  trial:      { maxVehicles: 3,        maxRoutes: 1,        maxStops: 10,       label: 'Trial',      price: 'Free trial' },
  starter:    { maxVehicles: 3,        maxRoutes: 1,        maxStops: 10,       label: 'Starter',    price: '$149/mo' },
  campus:     { maxVehicles: 8,        maxRoutes: Infinity, maxStops: Infinity, label: 'Campus',     price: '$299/mo' },
  // Enterprise rate card: $499/mo includes 15 vehicles, +$30/vehicle/mo beyond.
  // The paid vehicle count for a deal arrives via limitOverrides; 15 is the base.
  enterprise: { maxVehicles: 15,       maxRoutes: Infinity, maxStops: Infinity, label: 'Enterprise', price: 'From $499/mo' },
};

function applyOverride(base: number, override: unknown): number {
  return typeof override === 'number' && Number.isFinite(override) && override > 0
    ? override
    : base;
}

/** Returns limits for the current org, falling back to trial when not yet subscribed. */
export function getPlanLimits(
  plan?: string | null,
  status?: string | null,
  overrides?: PlanLimitOverrides | null,
): PlanLimits {
  if (!plan || status === 'trialing' || status === 'canceled' || status === 'unpaid') {
    // Overrides are tied to an active subscription — never applied to the trial fallback.
    return PLAN_LIMITS.trial;
  }
  const base = PLAN_LIMITS[plan as PlanKey] ?? PLAN_LIMITS.starter;
  if (!overrides) return base;
  return {
    ...base,
    maxVehicles: applyOverride(base.maxVehicles, overrides.maxVehicles),
    maxRoutes: applyOverride(base.maxRoutes, overrides.maxRoutes),
    maxStops: applyOverride(base.maxStops, overrides.maxStops),
  };
}

/** Human-readable vehicle limit string. */
export function vehicleLimitText(limits: PlanLimits): string {
  return limits.maxVehicles === Infinity ? 'Unlimited vehicles' : `Up to ${limits.maxVehicles} vehicles`;
}

/** Human-readable route limit string. */
export function routeLimitText(limits: PlanLimits): string {
  return limits.maxRoutes === Infinity ? 'Unlimited routes' : `${limits.maxRoutes} route${limits.maxRoutes !== 1 ? 's' : ''}`;
}

/** Human-readable stop limit string. */
export function stopLimitText(limits: PlanLimits): string {
  return limits.maxStops === Infinity ? 'Unlimited stops' : `Up to ${limits.maxStops} stops`;
}
