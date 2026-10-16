// backend/billingPolicy.ts
// How a Stripe subscription's state maps onto an org's billing fields. Kept
// free of Stripe/Firebase imports so it can be unit-tested directly.
//
// `sub` is always the subscription's *current* state fetched from Stripe —
// never the event payload, which can be stale when events arrive late or out
// of order.

export type SubscriptionState = { id: string; status: string };

// A subscription that should drive the org's plan or add-on.
const LIVE_STATUSES = ['active', 'trialing'];
// A subscription that has ended for good.
const ENDED_STATUSES = ['canceled', 'unpaid'];
// A subscription whose first payment never completed (e.g. a bank debit still
// processing, or abandoned and expired). It never took effect, so it can
// neither take over the org (locking a trial org out with a non-live status)
// nor end anything (e.g. an add-on paid for before ids were recorded).
const NEVER_PAID_STATUSES = ['incomplete', 'incomplete_expired'];

/**
 * What a main-plan subscription change should do to an org whose current
 * subscription is `currentSubId` (org.stripeSubscriptionId):
 *  - 'apply'  → mirror the subscription's status and plan onto the org,
 *               making it the org's current subscription
 *  - 'cancel' → mark the org canceled
 *  - 'ignore' → an old or duplicate subscription; leave the org alone, so
 *               ending it can't cancel an org that's paying for a newer one
 */
export function mainSubscriptionAction(
  currentSubId: string | null | undefined,
  sub: SubscriptionState,
  deleted: boolean,
): 'apply' | 'cancel' | 'ignore' {
  if (NEVER_PAID_STATUSES.includes(sub.status)) return 'ignore';
  const isCurrent = !currentSubId || currentSubId === sub.id;
  if (deleted || sub.status === 'canceled') return isCurrent ? 'cancel' : 'ignore';
  if (isCurrent) return 'apply';
  // A different live subscription replaces the current one (e.g. an
  // Enterprise deal set up in the Stripe dashboard).
  return LIVE_STATUSES.includes(sub.status) ? 'apply' : 'ignore';
}

/**
 * What a data add-on subscription change should do to an org whose current
 * add-on subscription is `currentAddonSubId` (org.dataAddonSubscriptionId):
 *  - 'activate'   → the add-on is paid for and live
 *  - 'deactivate' → the org's add-on subscription has ended
 *  - 'ignore'     → still pending (e.g. incomplete checkout, past due), or an
 *                   old/duplicate add-on subscription ending
 */
export function dataAddonAction(
  currentAddonSubId: string | null | undefined,
  sub: SubscriptionState,
  deleted: boolean,
): 'activate' | 'deactivate' | 'ignore' {
  if (NEVER_PAID_STATUSES.includes(sub.status)) return 'ignore';
  const isCurrent = !currentAddonSubId || currentAddonSubId === sub.id;
  if (deleted || ENDED_STATUSES.includes(sub.status)) return isCurrent ? 'deactivate' : 'ignore';
  if (LIVE_STATUSES.includes(sub.status)) return 'activate';
  return 'ignore';
}

/** Whether an org with a subscription in this state should change plan on it
 *  rather than start a new checkout (which would create a second, separately
 *  billed subscription). */
export function isLiveSubscription(status: string): boolean {
  return [...LIVE_STATUSES, 'past_due'].includes(status);
}

/**
 * The plan a subscription is on, from its prices. A plan switched in the
 * Stripe customer portal keeps its old metadata.plan, so metadata is only the
 * fallback — for a price that isn't one of `planPriceIds` (e.g. a custom
 * Enterprise deal set up in the Stripe dashboard).
 */
export function planForSubscription(
  itemPriceIds: string[],
  planPriceIds: Record<string, string>,
  metadataPlan: string | undefined,
): string {
  for (const [plan, priceId] of Object.entries(planPriceIds)) {
    if (priceId && itemPriceIds.includes(priceId)) return plan;
  }
  return metadataPlan ?? 'starter';
}
