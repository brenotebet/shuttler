// location/LocationContext.tsx
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, auth } from '../firebase/firebaseconfig';
import { useOrg } from '../src/org/OrgContext';
import { isRouteActive } from '../src/utils/scheduleUtils';
import { notifyStudentRequestCancelled } from '../src/utils/pushNotifications';

type LocationContextType = {
  isSharing: boolean;
  startSharing: (routeId?: string) => Promise<void>;
  stopSharing: () => Promise<void>;
  isOnBreak: boolean;
  breakEndsAt: Date | null;
  breaksTakenThisShift: number;
  startBreak: (minutes: number) => Promise<void>;
  endBreak: () => Promise<void>;
};

const LocationContext = createContext<LocationContextType>({
  isSharing: false,
  startSharing: async () => {},
  stopSharing: async () => {},
  isOnBreak: false,
  breakEndsAt: null,
  breaksTakenThisShift: 0,
  startBreak: async () => {},
  endBreak: async () => {},
});

const WRITE_MIN_INTERVAL_MS = 4000;
const WRITE_MIN_DISTANCE_M = 8;
const INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000; // auto-stop after 15 min of no GPS movement
const INACTIVITY_CHECK_MS = 60 * 1000;         // check once per minute

// Ignore GPS readings with accuracy worse than this (meters)
const GPS_ACCURACY_MAX_M = 80;
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

function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function requireUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated (uid missing)');
  return uid;
}

async function assertDriverRole(uid: string, orgId: string) {
  if (!orgId) throw new Error(`Cannot verify driver role for uid ${uid}: orgId is empty.`);
  try {
    const path = doc(db, 'orgs', orgId, 'users', uid);
    const snap = await getDoc(path);

    if (!snap.exists()) {
      throw new Error(`Missing user doc for uid ${uid} in org ${orgId}.`);
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
  if (!orgId) return;
  const reqCol = collection(db, 'orgs', orgId, 'stopRequests');
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

  // Fire-and-forget: notify each affected student
  active.forEach((snap) => {
    const studentUid = (snap.data() as any)?.studentUid as string | undefined;
    if (studentUid) {
      void notifyStudentRequestCancelled(orgId, studentUid, 'driver_offline');
    }
  });
}


async function cancelPendingStopRequestsIfNoBusesOnline(excludedUid: string, orgId: string) {
  if (!orgId) return;
  const busCol = collection(db, 'orgs', orgId, 'buses');
  const reqCol = collection(db, 'orgs', orgId, 'stopRequests');

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

  const pendingSnap = await getDocs(query(reqCol, where('status', 'in', ['pending', 'accepted'])));
  if (pendingSnap.empty) return;

  const batch = writeBatch(db);
  pendingSnap.docs.forEach((snap) => {
    batch.set(snap.ref, { driverUid: excludedUid, status: 'cancelled', cancelledAt: serverTimestamp(), cancelledReason: 'no_buses_online' }, { merge: true });
  });

  await batch.commit();

  // Fire-and-forget: notify each affected student
  pendingSnap.docs.forEach((snap) => {
    const studentUid = (snap.data() as any)?.studentUid as string | undefined;
    if (studentUid) {
      void notifyStudentRequestCancelled(orgId, studentUid, 'no_buses_online');
    }
  });
}

export const LocationProvider = ({ children }: { children: React.ReactNode }) => {
  const { org } = useOrg();
  const orgId = org?.orgId ?? '';
  const [isSharing, setIsSharing] = useState(false);

  const watchSub = useRef<Location.LocationSubscription | null>(null);
  const currentUid = useRef<string | null>(null);
  const currentRouteIdRef = useRef<string | null>(null);
  const sessionDocId = useRef<string | null>(null);
  const sessionStartMs = useRef<number>(0);
  const sessionOrgId = useRef<string>('');

  const lastWrittenAt = useRef<number>(0);
  const lastWrittenCoords = useRef<{ latitude: number; longitude: number } | null>(null);
  const smoothedCoords = useRef<{ latitude: number; longitude: number } | null>(null);
  const lastActivityAt = useRef<number>(Date.now());

  const [isOnBreak, setIsOnBreak] = useState(false);
  const [breakEndsAt, setBreakEndsAt] = useState<Date | null>(null);
  const [breaksTakenThisShift, setBreaksTakenThisShift] = useState(0);
  const breakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPausedRef = useRef(false);
  // Keep a stable ref to org.routes so the inactivity-check effect doesn't restart
  // its interval on every org snapshot (org?.routes is a new array reference each time).
  const orgRoutesRef = useRef(org?.routes ?? []);
  orgRoutesRef.current = org?.routes ?? [];

  const notifyStillOn = () => {
    Notifications.scheduleNotificationAsync({
      content: {
        title: 'Location Still On',
        body: "Location sharing is active. If you're done with your shift, please stop sharing before closing the app.",
      },
      trigger: null,
    });
  };

  const writeBusDoc = async (
    uid: string,
    coords: { latitude: number; longitude: number },
    isSessionStart = false,
  ) => {
    if (!orgId) return;
    if (isPausedRef.current) return;
    const busRef = doc(db, 'orgs', orgId, 'buses', uid);
    await setDoc(
      busRef,
      {
        driverUid: uid,
        latitude: coords.latitude,
        longitude: coords.longitude,
        online: true,
        onBreak: false,
        lastSeen: serverTimestamp(),
        updatedAt: serverTimestamp(),
        ...(isSessionStart && { sessionStartAt: serverTimestamp() }),
      },
      { merge: true },
    );
  };

  const markOffline = async (uid: string) => {
    if (!orgId) return;
    // delete is forbidden by rules; set online=false instead
    const busRef = doc(db, 'orgs', orgId, 'buses', uid);
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

        if (!orgId) return;
        const busRef = doc(db, 'orgs', orgId, 'buses', uid);
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

  const startSharing = async (routeId?: string) => {
    if (isSharing || watchSub.current) return;

    const uid = requireUid();
    currentUid.current = uid;
    currentRouteIdRef.current = routeId ?? null;

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
      await writeBusDoc(uid, coords, true);
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

    // Restore persisted break count for today (survives stop/start within the same day)
    try {
      const busSnap = await getDoc(doc(db, 'orgs', orgId, 'buses', uid));
      if (busSnap.exists()) {
        const d = busSnap.data() as any;
        const today = todayDateString();
        if (d?.breakShiftDate === today) {
          setBreaksTakenThisShift(d?.breaksTakenThisShift ?? 0);
        } else {
          setBreaksTakenThisShift(0);
          // Reset stale count in Firestore so it's clean for today
          await setDoc(doc(db, 'orgs', orgId, 'buses', uid), { breaksTakenThisShift: 0, breakShiftDate: today }, { merge: true });
        }
      }
    } catch {
      // non-critical
    }

    // Record session start
    try {
      sessionStartMs.current = Date.now();
      sessionOrgId.current = orgId;
      const ref = await addDoc(collection(db, 'orgs', orgId, 'driverSessions'), {
        driverUid: uid,
        routeId: routeId ?? null,
        startedAt: serverTimestamp(),
        endedAt: null,
        durationMs: null,
      });
      sessionDocId.current = ref.id;
    } catch {
      // non-critical — session tracking is best-effort
    }

    lastActivityAt.current = Date.now();

    watchSub.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
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

    // Close session doc before anything else so the timestamp is accurate
    if (sessionDocId.current && sessionOrgId.current) {
      try {
        await updateDoc(
          doc(db, 'orgs', sessionOrgId.current, 'driverSessions', sessionDocId.current),
          {
            endedAt: serverTimestamp(),
            durationMs: Date.now() - sessionStartMs.current,
          },
        );
      } catch {
        // non-critical
      }
    }

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
      sessionDocId.current = null;
      sessionStartMs.current = 0;
      sessionOrgId.current = '';
      lastWrittenAt.current = 0;
      lastWrittenCoords.current = null;
      smoothedCoords.current = null;
      // Clear any active break (keep breaksTakenThisShift — reloaded from Firestore on next startSharing)
      if (breakTimerRef.current) { clearTimeout(breakTimerRef.current); breakTimerRef.current = null; }
      isPausedRef.current = false;
      setIsOnBreak(false);
      setBreakEndsAt(null);
      setIsSharing(false);
    }
  };

  const startBreak = async (minutes: number) => {
    const uid = currentUid.current;
    if (!uid || !orgId || !isSharing) return;

    isPausedRef.current = true;
    const endsAt = new Date(Date.now() + minutes * 60 * 1000);
    setBreakEndsAt(endsAt);
    setIsOnBreak(true);
    setBreaksTakenThisShift((prev) => prev + 1);

    // Mark bus doc as on-break and persist the incremented count keyed to today
    try {
      const busRef = doc(db, 'orgs', orgId, 'buses', uid);
      await setDoc(busRef, {
        onBreak: true,
        breakEndsAt: endsAt,
        updatedAt: serverTimestamp(),
        breaksTakenThisShift: increment(1),
        breakShiftDate: todayDateString(),
      }, { merge: true });
    } catch (err) {
      console.error('startBreak: failed to update bus doc', err);
    }

    // Cancel pending requests with driver_on_break reason
    try {
      const reqCol = collection(db, 'orgs', orgId, 'stopRequests');
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
      if (active.length > 0) {
        const batch = writeBatch(db);
        active.forEach((snap) => {
          batch.set(snap.ref, { status: 'cancelled', cancelledAt: serverTimestamp(), cancelledReason: 'driver_on_break' }, { merge: true });
        });
        await batch.commit();
      }
    } catch (err) {
      console.error('startBreak: failed to cancel requests', err);
    }

    // Auto-end after the timer
    if (breakTimerRef.current) clearTimeout(breakTimerRef.current);
    breakTimerRef.current = setTimeout(() => {
      endBreak();
    }, minutes * 60 * 1000);
  };

  const endBreak = async () => {
    const uid = currentUid.current;
    if (breakTimerRef.current) { clearTimeout(breakTimerRef.current); breakTimerRef.current = null; }
    isPausedRef.current = false;
    setIsOnBreak(false);
    setBreakEndsAt(null);

    if (!uid || !orgId) return;
    try {
      const busRef = doc(db, 'orgs', orgId, 'buses', uid);
      await setDoc(busRef, { onBreak: false, breakEndsAt: null, updatedAt: serverTimestamp() }, { merge: true });
    } catch (err) {
      console.error('endBreak: failed to update bus doc', err);
    }
  };

  // Auto-stop: inactivity timeout + schedule enforcement
  useEffect(() => {
    if (!isSharing) return;

    const interval = setInterval(async () => {
      // Inactivity check
      if (Date.now() - lastActivityAt.current >= INACTIVITY_TIMEOUT_MS) {
        Notifications.scheduleNotificationAsync({
          content: {
            title: 'Location Sharing Stopped',
            body: 'No movement detected for 15 minutes. Location sharing has been turned off.',
          },
          trigger: null,
        });
        try { await stopSharing(); } catch (err) { console.error('Inactivity auto-stop failed:', err); }
        return;
      }

      // Schedule enforcement — only applies when a route is assigned
      const routeId = currentRouteIdRef.current;
      if (routeId) {
        const route = orgRoutesRef.current.find((r) => r.id === routeId) ?? null;
        if (route?.schedule && !isRouteActive(route, new Date(), org?.timezone)) {
          Notifications.scheduleNotificationAsync({
            content: {
              title: 'Location Sharing Stopped',
              body: 'Service hours have ended for this route. Location sharing has been turned off.',
            },
            trigger: null,
          });
          try { await stopSharing(); } catch (err) { console.error('Schedule auto-stop failed:', err); }
        }
      }
    }, INACTIVITY_CHECK_MS);

    return () => clearInterval(interval);
  }, [isSharing]);

  return (
    <LocationContext.Provider value={{ isSharing, startSharing, stopSharing, isOnBreak, breakEndsAt, breaksTakenThisShift, startBreak, endBreak }}>
      {children}
    </LocationContext.Provider>
  );
};

export const useLocationSharing = () => useContext(LocationContext);
