// location/LocationContext.tsx
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
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

export const LocationProvider = ({ children }: { children: React.ReactNode }) => {
  const [isSharing, setIsSharing] = useState(false);

  const watchSub = useRef<Location.LocationSubscription | null>(null);
  const currentUid = useRef<string | null>(null);

  const lastWrittenAt = useRef<number>(0);
  const lastWrittenCoords = useRef<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    const notify = () => {
      Notifications.scheduleNotificationAsync({
        content: {
          title: 'Location Still On',
          body: "Location sharing is active. If you're done with your shift, please stop sharing before closing the app.",
        },
        trigger: null,
      });
    };

    const onChange = (state: AppStateStatus) => {
      if (state !== 'active' && isSharing) notify();
    };

    const sub = AppState.addEventListener('change', onChange);
    return () => {
      sub.remove();
      if (isSharing) notify();
    };
  }, [isSharing]);

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

      // delete is forbidden by rules; set online=false instead
    await setDoc(
      doc(db, 'buses', uid),
      { online: false },
      { merge: true },
    );
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
