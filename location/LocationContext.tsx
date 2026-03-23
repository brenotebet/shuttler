// location/LocationContext.tsx
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, auth } from '../firebase/firebaseconfig';
import { useOrg } from '../src/org/OrgContext';

type LocationContextType = {
  isSharing: boolean;
  startSharing: () => Promise<void>;
  stopSharing: () => Promise<void>;
};

const LocationContext = createContext<LocationContextType>({
  isSharing: false,
  startSharing: async () => {},
  stopSharing: async () => {},
});

const WRITE_MIN_INTERVAL_MS = 2000;
const WRITE_MIN_DISTANCE_M = 8;
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // auto-stop after 15 min of no GPS movement
const INACTIVITY_CHECK_MS = 60 * 1000;         // check once per minute

// Ignore GPS readings with accuracy worse than this (meters)
const GPS_ACCURACY_MAX_M = 50;
// EMA smoothing factor (0 = max smooth/lag, 1 = no smoothing)
const EMA_ALPHA = 0.4;

// If the driver app restarts and the bus doc says "online:true" but it hasn't updated in a while,
// we treat that as stale and force offline.
const STARTUP_STALE_OFFLINE_MS = 2 * 60 * 1000; // 2 minutes

const ONLINE_BUS_STALE_MS = 90 * 1000;

function getTimestampMs(data: any): number | null {
  const updatedAtMs = typeof data?.updatedAt?.toMillis === 'function' ? data.updatedAt.toMillis() : null;
  if (updatedAtMs !== null && !Number.isNaN(updatedAtMs)) return updatedAtMs;

  const lastSeenMs = typeof data?.lastSeen?.toMillis === 'function' ? data.lastSeen.toMillis() : null;
  if (lastSeenMs !== null && !Number.isNaN(lastSeenMs)) return lastSeenMs;

  const updatedAtDateMs = typeof data?.updatedAt === 'string' ? new Date(data.updatedAt).getTime() : null;
  if (updatedAtDateMs !== null && !Number.isNaN(updatedAtDateMs)) return updatedAtDateMs;

  const lastSeenDateMs = typeof data?.lastSeen === 'string' ? new Date(data.lastSeen).getTime() : null;
  if (lastSeenDateMs !== null && !Number.isNaN(lastSeenDateMs)) return lastSeenDateMs;

  return null;
}

function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function requireUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated (uid missing)');
  return uid;
}

async function assertDriverRole(uid: string, orgId: string) {
  try {
    const path = orgId
      ? doc(db, 'orgs', orgId, 'users', uid)
      : doc(db, 'users', uid);
    const snap = await getDoc(path);

    if (!snap.exists()) {
      throw new Error(`Missing user doc for uid ${uid} in org ${orgId || '(none)'}.`);
    }

    const role = (snap.data() as any)?.role ?? null;
    if (role !== 'driver' && role !== 'admin') {
      throw new Error(
        `Not allowed: user ${uid} role is "${role}". Expected "driver" or "admin".`,
      );
    }
  } catch (e: any) {
    throw new Error(`Cannot verify driver role for uid ${uid}. ${e?.message ?? e}`);
  }
}

async function cancelActiveStopRequestsForDriver(uid: string, orgId: string) {
  const reqCol = orgId ? collection(db, 'orgs', orgId, 'stopRequests') : collection(db, 'stopRequests');
  const byDriverUid = await getDocs(query(reqCol, where('driverUid', '==', uid)));
  const byDriverId = await getDocs(query(reqCol, where('driverId', '==', uid)));

  const merged = [...byDriverUid.docs, ...byDriverId.docs];
  const seen = new Set<string>();

  const active = merged.filter((snap) => {
    if (seen.has(snap.id)) return false;
    seen.add(snap.id);
    const status = (snap.data() as any)?.status;
    return status === 'pending' || status === 'accepted';
  });

  if (active.length === 0) return;

  const batch = writeBatch(db);
  active.forEach((snap) => {
    batch.set(snap.ref, { status: 'cancelled', cancelledAt: serverTimestamp(), cancelledReason: 'driver_offline' }, { merge: true });
  });

  await batch.commit();
}


async function cancelPendingStopRequestsIfNoBusesOnline(excludedUid: string, orgId: string) {
  const busCol = orgId ? collection(db, 'orgs', orgId, 'buses') : collection(db, 'buses');
  const reqCol = orgId ? collection(db, 'orgs', orgId, 'stopRequests') : collection(db, 'stopRequests');

  const busesSnap = await getDocs(busCol);

  const hasAnotherOnlineBus = busesSnap.docs.some((snap) => {
    if (snap.id === excludedUid) return false;
    const data: any = snap.data();
    if (data?.online !== true) return false;
    const tsMs = getTimestampMs(data);
    if (tsMs === null) return false;
    return Date.now() - tsMs <= ONLINE_BUS_STALE_MS;
  });

  if (hasAnotherOnlineBus) return;

  const pendingSnap = await getDocs(query(reqCol, where('status', '==', 'pending')));
  if (pendingSnap.empty) return;

  const batch = writeBatch(db);
  pendingSnap.docs.forEach((snap) => {
    batch.set(snap.ref, { driverUid: excludedUid, status: 'cancelled', cancelledAt: serverTimestamp(), cancelledReason: 'no_buses_online' }, { merge: true });
  });

  await batch.commit();
}

export const LocationProvider = ({ children }: { children: React.ReactNode }) => {
  const { org } = useOrg();
  const orgId = org?.orgId ?? '';
  const [isSharing, setIsSharing] = useState(false);

  const watchSub = useRef<Location.LocationSubscription | null>(null);
  const currentUid = useRef<string | null>(null);

  const lastWrittenAt = useRef<number>(0);
  const lastWrittenCoords = useRef<{ latitude: number; longitude: number } | null>(null);
  const smoothedCoords = useRef<{ latitude: number; longitude: number } | null>(null);
  const lastActivityAt = useRef<number>(Date.now());

  const notifyStillOn = () => {
    Notifications.scheduleNotificationAsync({
      content: {
        title: 'Location Still On',
        body: "Location sharing is active. If you're done with your shift, please stop sharing before closing the app.",
      },
      trigger: null,
    });
  };

  const writeBusDoc = async (uid: string, coords: { latitude: number; longitude: number }) => {
    const busRef = orgId ? doc(db, 'orgs', orgId, 'buses', uid) : doc(db, 'buses', uid);
    await setDoc(
      busRef,
      {
        driverUid: uid,
        latitude: coords.latitude,
        longitude: coords.longitude,
        online: true,
        lastSeen: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  };

  const markOffline = async (uid: string) => {
    // delete is forbidden by rules; set online=false instead
    const busRef = orgId ? doc(db, 'orgs', orgId, 'buses', uid) : doc(db, 'buses', uid);
    await setDoc(
      busRef,
      {
        online: false,
        lastSeen: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  };

  // ✅ Startup reconciliation:
  // If Firestore still says online=true but lastSeen/updatedAt is stale, force online=false.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const uid = auth.currentUser?.uid;
        if (!uid) return;

        const busRef = orgId ? doc(db, 'orgs', orgId, 'buses', uid) : doc(db, 'buses', uid);
        const snap = await getDoc(busRef);
        if (!snap.exists()) return;

        const data: any = snap.data() || {};
        if (data?.online !== true) return;

        const ts =
          data?.updatedAt?.toDate?.() ||
          data?.lastSeen?.toDate?.() ||
          (typeof data?.updatedAt === 'string' ? new Date(data.updatedAt) : null) ||
          (typeof data?.lastSeen === 'string' ? new Date(data.lastSeen) : null) ||
          null;

        if (!ts || isNaN(ts.getTime())) return;

        const ageMs = Date.now() - ts.getTime();
        if (ageMs > STARTUP_STALE_OFFLINE_MS) {
          if (cancelled) return;
          await markOffline(uid);
        }
      } catch (err) {
        // best-effort only
        console.warn('LocationProvider startup reconcile skipped:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
    // run once per mount
  }, []);

  // ✅ AppState reminder only: do NOT force driver offline when app backgrounds.
  // Drivers should only go offline when they explicitly stop sharing, or after stale startup reconciliation.
  useEffect(() => {
    const onChange = (state: string) => {
      if (state === 'active' || state === 'inactive') return;
      if (!isSharing) return;

      // Keep warning UX, but preserve sharing state.
      notifyStillOn();
    };

    const sub = AppState.addEventListener('change', onChange);

    return () => {
      sub.remove();

      // Provider unmount cleanup (best-effort)
      const uid = currentUid.current;
      if (uid && isSharing) {
        notifyStillOn();
        markOffline(uid).catch(() => {});
      }
    };
  }, [isSharing]);

  const startSharing = async () => {
    if (isSharing || watchSub.current) return;

    const uid = requireUid();
    currentUid.current = uid;

    // 🔒 Make missing/incorrect role obvious (instead of silent permission-denied)
    await assertDriverRole(uid, orgId);

    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') return;

    // Request background permission so watchPositionAsync keeps running when app is backgrounded.
    // This is best-effort - sharing still works foreground-only if denied.
    await Location.requestBackgroundPermissionsAsync().catch(() => {});

    // ✅ Single initial write attempt (no duplicates)
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      smoothedCoords.current = coords;
      await writeBusDoc(uid, coords);
      lastWrittenAt.current = Date.now();
      lastWrittenCoords.current = coords;
    } catch (err) {
      console.error('Error obtaining initial location:', {
        code: (err as any)?.code,
        message: (err as any)?.message,
        err,
        uid,
      });
      currentUid.current = null;
      return; // don't start watch if we can't write
    }

    lastActivityAt.current = Date.now();

    watchSub.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        timeInterval: 1000,
        distanceInterval: 2,
      },
      async (loc) => {
        try {
          const id = currentUid.current;
          if (!id) return;

          // Any GPS reading counts as activity (even low-accuracy ones)
          lastActivityAt.current = Date.now();

          // Skip readings with poor GPS accuracy to reduce off-road drift
          const gpsAccuracy = loc.coords.accuracy;
          if (gpsAccuracy !== null && gpsAccuracy > GPS_ACCURACY_MAX_M) return;

          const raw = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };

          // Apply EMA smoothing to reduce jitter / off-road spikes
          const prev = smoothedCoords.current;
          const coords = prev
            ? {
                latitude: EMA_ALPHA * raw.latitude + (1 - EMA_ALPHA) * prev.latitude,
                longitude: EMA_ALPHA * raw.longitude + (1 - EMA_ALPHA) * prev.longitude,
              }
            : raw;
          smoothedCoords.current = coords;

          const now = Date.now();

          const tooSoon = now - lastWrittenAt.current < WRITE_MIN_INTERVAL_MS;
          const last = lastWrittenCoords.current;
          const movedEnough = !last || distanceMeters(last, coords) >= WRITE_MIN_DISTANCE_M;

          if (tooSoon && !movedEnough) return;

          await writeBusDoc(id, coords);
          lastWrittenAt.current = now;
          lastWrittenCoords.current = coords;
        } catch (err) {
          console.error('Error sharing location:', {
            code: (err as any)?.code,
            message: (err as any)?.message,
            err,
          });
        }
      },
    );

    setIsSharing(true);
  };

  const stopSharing = async () => {
    const uid = currentUid.current;
    if (!uid) return;

    try {
      if (watchSub.current) {
        watchSub.current.remove();
        watchSub.current = null;
      }

      await markOffline(uid);
      await cancelActiveStopRequestsForDriver(uid, orgId);
      await cancelPendingStopRequestsIfNoBusesOnline(uid, orgId);
    } catch (err) {
      console.error('Error during stopSharing:', {
        code: (err as any)?.code,
        message: (err as any)?.message,
        err,
      });
    } finally {
      currentUid.current = null;
      lastWrittenAt.current = 0;
      lastWrittenCoords.current = null;
      smoothedCoords.current = null;
      setIsSharing(false);
    }
  };

  // Auto-stop sharing after 15 minutes of no GPS activity
  useEffect(() => {
    if (!isSharing) return;

    const interval = setInterval(async () => {
      if (Date.now() - lastActivityAt.current < INACTIVITY_TIMEOUT_MS) return;

      Notifications.scheduleNotificationAsync({
        content: {
          title: 'Location Sharing Stopped',
          body: 'No movement detected for 15 minutes. Location sharing has been turned off.',
        },
        trigger: null,
      });

      try {
        await stopSharing();
      } catch (err) {
        console.error('Inactivity auto-stop failed:', err);
      }
    }, INACTIVITY_CHECK_MS);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSharing]);

  return (
    <LocationContext.Provider value={{ isSharing, startSharing, stopSharing }}>
      {children}
    </LocationContext.Provider>
  );
};

export const useLocationSharing = () => useContext(LocationContext);
