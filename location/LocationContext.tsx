// location/LocationContext.tsx
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
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

const WRITE_MIN_INTERVAL_MS = 4000;
const WRITE_MIN_DISTANCE_M = 8;

// If the driver app restarts and the bus doc says "online:true" but it hasn't updated in a while,
// we treat that as stale and force offline.
const STARTUP_STALE_OFFLINE_MS = 2 * 60 * 1000; // 2 minutes

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

async function assertDriverRole(uid: string) {
  try {
    const snap = await getDoc(doc(db, 'users', uid));

    if (!snap.exists()) {
      throw new Error(
        `Missing user doc: /users/${uid}. Create it with { role: "driver" } (or "admin").`,
      );
    }

    const role = (snap.data() as any)?.role ?? null;
    if (role !== 'driver' && role !== 'admin') {
      throw new Error(
        `Not allowed: /users/${uid}.role is "${role}". Expected "driver" or "admin".`,
      );
    }
  } catch (e: any) {
    throw new Error(`Cannot verify driver role for /users/${uid}. ${e?.message ?? e}`);
  }
}

async function cancelActiveStopRequestsForDriver(uid: string) {
  const byDriverUid = await getDocs(query(collection(db, 'stopRequests'), where('driverUid', '==', uid)));
  const byDriverId = await getDocs(query(collection(db, 'stopRequests'), where('driverId', '==', uid)));

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
    batch.set(
      doc(db, 'stopRequests', snap.id),
      {
        status: 'cancelled',
        cancelledAt: serverTimestamp(),
        cancelledReason: 'driver_offline',
      },
      { merge: true },
    );
  });

  await batch.commit();
}

export const LocationProvider = ({ children }: { children: React.ReactNode }) => {
  const [isSharing, setIsSharing] = useState(false);

  const watchSub = useRef<Location.LocationSubscription | null>(null);
  const currentUid = useRef<string | null>(null);

  const lastWrittenAt = useRef<number>(0);
  const lastWrittenCoords = useRef<{ latitude: number; longitude: number } | null>(null);

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
    await setDoc(
      doc(db, 'buses', uid),
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
    await setDoc(
      doc(db, 'buses', uid),
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

        const snap = await getDoc(doc(db, 'buses', uid));
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

  // ✅ AppState cleanup: if app goes inactive/background, stop watcher + mark offline + reset UI state
  useEffect(() => {
    const onChange = async (state: AppStateStatus) => {
      if (state === 'active') return;

      if (!isSharing) return;

      // Keep your existing warning UX
      notifyStillOn();

      const uid = currentUid.current;
      try {
        if (uid) {
          await markOffline(uid);
          await cancelActiveStopRequestsForDriver(uid);
        }
      } catch (err) {
        console.error('markOffline on background failed:', err);
      }

      try {
        if (watchSub.current) {
          watchSub.current.remove();
          watchSub.current = null;
        }
      } catch {}

      currentUid.current = null;
      lastWrittenAt.current = 0;
      lastWrittenCoords.current = null;
      setIsSharing(false);
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
    await assertDriverRole(uid);

    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') return;

    // ✅ Single initial write attempt (no duplicates)
    try {
      const loc = await Location.getCurrentPositionAsync({});
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
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
      return; // don’t start watch if we can’t write
    }

    watchSub.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 1000,
        distanceInterval: 2,
      },
      async (loc) => {
        try {
          const id = currentUid.current;
          if (!id) return;

          const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
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
      await cancelActiveStopRequestsForDriver(uid);
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
      setIsSharing(false);
    }
  };

  return (
    <LocationContext.Provider value={{ isSharing, startSharing, stopSharing }}>
      {children}
    </LocationContext.Provider>
  );
};

export const useLocationSharing = () => useContext(LocationContext);
