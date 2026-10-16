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
const ENDED_STATUSES = ['canceled', 'unpaid', 'incomplete_expired'];

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
  const isCurrent = !currentAddonSubId || currentAddonSubId === sub.id;
  if (deleted || ENDED_STATUSES.includes(sub.status)) return isCurrent ? 'deactivate' : 'ignore';
  if (LIVE_STATUSES.includes(sub.status)) return 'activate';
  return 'ignore';
}
