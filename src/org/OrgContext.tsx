// src/org/OrgContext.tsx
//
// Holds the currently selected organization's configuration.
// Must wrap AuthProvider in App.tsx — the org must be known before auth.
// On cold start, restored from AsyncStorage so users don't re-select every launch.

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, onSnapshot } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../../firebase/firebaseconfig';
import { SHUTTLER_API_URL } from '../../config';

export type Stop = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
};

export type Route = {
  id: string;
  name: string;
  stopIds: string[]; // ordered stop IDs referencing org.stops
};

export type AuthMethod = 'saml' | 'email' | 'google' | 'email+google';

export type OrgConfig = {
  orgId: string;
  name: string;
  slug: string;
  logoUrl?: string;
  primaryColor?: string;
  authMethod: AuthMethod;
  allowedEmailDomains?: string[];
  stops: Stop[];
  routes?: Route[];
  mapCenter: { latitude: number; longitude: number };
  mapBoundingBox?: {
    ne: { latitude: number; longitude: number };
    sw: { latitude: number; longitude: number };
  };
  subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid';
  subscriptionPlan?: string;
  approved?: boolean;
  reviewStatus?: 'pending' | 'approved' | 'rejected';
};

type OrgContextType = {
  org: OrgConfig | null;
  isLoadingOrg: boolean;
  selectOrg: (org: OrgConfig) => Promise<void>;
  clearOrg: () => Promise<void>;
  refreshOrg: () => Promise<void>;
};

const STORAGE_KEY = 'shuttler_selected_org_id';
const CACHE_KEY = 'shuttler_org_cache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const OrgContext = createContext<OrgContextType>({
  org: null,
  isLoadingOrg: true,
  selectOrg: async () => {},
  clearOrg: async () => {},
  refreshOrg: async () => {},
});

async function fetchOrgBySlug(slug: string): Promise<OrgConfig | null> {
  try {
    const res = await fetch(`${SHUTTLER_API_URL}/orgs/${slug}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchOrgById(orgId: string): Promise<OrgConfig | null> {
  try {
    const res = await fetch(`${SHUTTLER_API_URL}/orgs/by-id/${orgId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function readCachedOrg(): Promise<OrgConfig | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { org, cachedAt } = JSON.parse(raw);
    if (Date.now() - cachedAt > CACHE_TTL_MS) return null;
    return org as OrgConfig;
  } catch {
    return null;
  }
}

async function writeCachedOrg(org: OrgConfig): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ org, cachedAt: Date.now() }));
  } catch {}
}

export const OrgProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [org, setOrg] = useState<OrgConfig | null>(null);
  const [isLoadingOrg, setIsLoadingOrg] = useState(true);

  // On cold start: restore org from cache / refetch from API
  useEffect(() => {
    (async () => {
      try {
        const orgId = await AsyncStorage.getItem(STORAGE_KEY);
        if (!orgId) return;

        // Try cache first (works offline)
        const cached = await readCachedOrg();
        if (cached && cached.orgId === orgId) {
          setOrg(cached);
          // Refresh in background
          fetchOrgById(orgId).then((fresh) => {
            if (fresh) {
              setOrg(fresh);
              writeCachedOrg(fresh);
            }
          });
          return;
        }

        // Fetch fresh
        const fresh = await fetchOrgById(orgId);
        if (fresh) {
          setOrg(fresh);
          await writeCachedOrg(fresh);
        }
      } catch {
        // Leave org as null — user will see OrgSelectorScreen
      } finally {
        setIsLoadingOrg(false);
      }
    })();
  }, []);

  const selectOrg = useCallback(async (selected: OrgConfig) => {
    setOrg(selected);
    await AsyncStorage.setItem(STORAGE_KEY, selected.orgId);
    await writeCachedOrg(selected);
    // The list endpoint may omit stops/routes. Fetch the full config so that
    // org.stops is populated before the user finishes registering/signing in.
    fetchOrgById(selected.orgId).then((full) => {
      if (full) { setOrg(full); writeCachedOrg(full); }
    });
  }, []);

  const clearOrg = useCallback(async () => {
    setOrg(null);
    await AsyncStorage.removeItem(STORAGE_KEY);
    await AsyncStorage.removeItem(CACHE_KEY);
  }, []);

  const refreshOrg = useCallback(async () => {
    if (!org) return;
    const fresh = await fetchOrgById(org.orgId);
    if (fresh) {
      setOrg(fresh);
      await writeCachedOrg(fresh);
    }
  }, [org]);

  // Live Firestore listener — keeps stops, mapCenter, mapBoundingBox fresh
  // without waiting for the 24-hour cache to expire.
  // We gate the snapshot on auth state so it starts (or restarts) as soon as
  // the user signs in, rather than silently dying with a permission error when
  // the org is selected before authentication.
  useEffect(() => {
    if (!org?.orgId) return;
    let snapshotUnsub: (() => void) | null = null;
    const authUnsub = onAuthStateChanged(auth, (firebaseUser) => {
      snapshotUnsub?.();
      snapshotUnsub = null;
      if (!firebaseUser) return;
      snapshotUnsub = onSnapshot(
        doc(db, 'orgs', org.orgId),
        (snap) => {
          if (!snap.exists()) return;
          const data = snap.data() as any;
          setOrg((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              stops: Array.isArray(data.stops) ? data.stops : prev.stops,
              routes: Array.isArray(data.routes) ? data.routes : prev.routes,
              mapCenter: data.mapCenter ?? prev.mapCenter,
              mapBoundingBox: data.mapBoundingBox ?? prev.mapBoundingBox,
              subscriptionStatus: data.subscriptionStatus ?? prev.subscriptionStatus,
              subscriptionPlan: data.subscriptionPlan ?? prev.subscriptionPlan,
              approved: data.approved ?? prev.approved,
              reviewStatus: data.reviewStatus ?? prev.reviewStatus,
            };
          });
        },
      );
    });
    return () => {
      authUnsub();
      snapshotUnsub?.();
    };
  }, [org?.orgId]);

  return (
    <OrgContext.Provider value={{ org, isLoadingOrg, selectOrg, clearOrg, refreshOrg }}>
      {children}
    </OrgContext.Provider>
  );
};

export const useOrg = () => useContext(OrgContext);
