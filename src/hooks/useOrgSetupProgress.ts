// src/hooks/useOrgSetupProgress.ts
//
// Single source of truth for "how done is this org's setup" — consumed by
// the Admin Hub's Getting Started card and by the Org Setup screen's own
// tab bar, so the two surfaces can't disagree with each other.

import { useEffect, useState } from 'react';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db } from '../../firebase/firebaseconfig';
import { useOrg } from '../org/OrgContext';
import { SHUTTLER_API_URL } from '../../config';

export type OrgSetupTabKey = 'profile' | 'auth' | 'stops' | 'users' | 'ops' | 'billing';

export type OrgSetupStep = {
  key: string;
  label: string;
  tab: OrgSetupTabKey;
  done: boolean;
};

export type TabStatus = 'done' | 'attention' | 'neutral';

export function useOrgSetupProgress() {
  const { org } = useOrg();
  const [hasDriver, setHasDriver] = useState<boolean | null>(null);
  // A SAML draft the admin saved but never activated — invisible to org.authMethod
  // (that only flips to 'saml' on activation), so it needs its own check.
  const [hasDanglingSamlDraft, setHasDanglingSamlDraft] = useState(false);

  useEffect(() => {
    if (!org?.orgId) return;
    const unsub = onSnapshot(
      query(collection(db, 'orgs', org.orgId, 'users'), where('role', '==', 'driver'), limit(1)),
      (snap) => setHasDriver(!snap.empty),
      () => setHasDriver(false),
    );
    return unsub;
  }, [org?.orgId]);

  useEffect(() => {
    if (!org?.orgId || org.authMethod === 'saml') {
      setHasDanglingSamlDraft(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch(`${SHUTTLER_API_URL}/admin/orgs/${org.orgId}/auth-config`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled) setHasDanglingSamlDraft(Boolean(data.samlDraft));
      } catch {
        // Best-effort — worst case the tab just doesn't show the hint.
      }
    })();
    return () => { cancelled = true; };
  }, [org?.orgId, org?.authMethod]);

  const hasStops = (org?.stops?.length ?? 0) > 0;
  const hasRoutes = (org?.routes?.length ?? 0) > 0;
  const billingStatus = org?.subscriptionStatus;
  const billingDone = billingStatus === 'trialing' || billingStatus === 'active';
  const billingNeedsAttention = billingStatus === 'past_due' || billingStatus === 'unpaid' || billingStatus === 'canceled';

  // The three things every org actually has to do at least once. Stops and
  // routes are merged into one step — both live on the same "Stops" tab, so
  // two separate rows used to point at the identical destination.
  const steps: OrgSetupStep[] = [
    { key: 'stops', label: 'Add stops and create a route', tab: 'stops', done: hasStops && hasRoutes },
    { key: 'users', label: 'Invite a driver', tab: 'users', done: hasDriver === true },
    { key: 'billing', label: 'Set up billing', tab: 'billing', done: billingDone },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const total = steps.length;
  const pct = Math.round((doneCount / total) * 100);
  const allDone = doneCount === total && !hasDanglingSamlDraft;

  const tabStatus: Record<OrgSetupTabKey, TabStatus> = {
    profile: 'neutral',
    ops: 'neutral',
    auth: hasDanglingSamlDraft ? 'attention' : 'neutral',
    stops: steps[0].done ? 'done' : 'neutral',
    users: steps[1].done ? 'done' : 'neutral',
    billing: billingNeedsAttention ? 'attention' : billingDone ? 'done' : 'neutral',
  };

  return {
    steps,
    doneCount,
    total,
    pct,
    allDone,
    hasDanglingSamlDraft,
    isReady: hasDriver !== null,
    tabStatus,
  };
}
