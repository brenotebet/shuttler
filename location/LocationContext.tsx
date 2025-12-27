// location/LocationContext.tsx
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase/firebaseconfig'; // ✅ make sure auth is exported here

type LocationContextType = {
  isSharing: boolean;
  startSharing: () => Promise<void>;   // ✅ no param
  stopSharing: () => Promise<void>;
};

const LocationContext = createContext<LocationContextType>({
  isSharing: false,
  startSharing: async () => {},
  stopSharing: async () => {},
});

const WRITE_MIN_INTERVAL_MS = 4000;
const WRITE_MIN_DISTANCE_M = 8;

function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function requireUid(): string {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Not authenticated (uid missing)');
  return uid;
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
    // ✅ IMPORTANT: doc id must be uid to satisfy rules
    await setDoc(
      doc(db, 'buses', uid),
      {
        driverUid: uid, // ✅ use driverUid (matches your rules naming)
        latitude: coords.latitude,
        longitude: coords.longitude,
        online: true,
        lastSeen: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  };

  const startSharing = async () => {
    if (isSharing || watchSub.current) return;

    const uid = requireUid(); // ✅ always auth.uid
    currentUid.current = uid;

    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') return;

    try {
      const loc = await Location.getCurrentPositionAsync({});
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      await writeBusDoc(uid, coords);
      lastWrittenAt.current = Date.now();
      lastWrittenCoords.current = coords;
    } catch (err) {
      console.error('Error obtaining initial location:', err);
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
          console.error('Error sharing location:', err);
        }
      }
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

      // ✅ allowed: update same bus doc; delete is forbidden by rules
      await setDoc(
        doc(db, 'buses', uid),
        {
          online: false,
          lastSeen: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      console.error('Error during stopSharing:', err);
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
