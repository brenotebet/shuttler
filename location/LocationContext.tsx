import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppState, AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  setDoc,
  doc,
  deleteDoc,
  query,
  collection,
  where,
  getDocs,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase/firebaseconfig';

const LOCATION_TASK = 'driver-location-task';
let currentDriverIdGlobal: string | null = null;

if (!TaskManager.isTaskDefined(LOCATION_TASK)) {
  TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      console.error('Background location task error:', error);
      return;
    }
    const { locations } = data as any;
    const loc = locations?.[0];
    if (loc && currentDriverIdGlobal) {
      try {
        await setDoc(doc(db, 'buses', currentDriverIdGlobal), {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          timestamp: serverTimestamp(),
        });
      } catch (err) {
        console.error('Error updating location in background:', err);
      }
    }
  });
}

type LocationContextType = {
  isSharing: boolean;
  startSharing: (driverId: string) => void;
  stopSharing: () => void;
};

const LocationContext = createContext<LocationContextType>({
  isSharing: false,
  startSharing: () => {},
  stopSharing: () => {},
});

export const LocationProvider = ({ children }: { children: React.ReactNode }) => {
  const [isSharing, setIsSharing] = useState(false);
  const watchSub = useRef<Location.LocationSubscription | null>(null);
  const currentDriverId = useRef<string | null>(null);

  // Remind the driver if location is still being shared when the app
  // goes to the background or is closed.
  useEffect(() => {
    const notify = () => {
      Notifications.scheduleNotificationAsync({
        content: {
          title: 'Location Still On',
          body:
            'Location sharing is active. If you\'re done with your shift, please stop sharing before closing the app.',
        },
        trigger: null,
      });
    };

    const onChange = (state: AppStateStatus) => {
      if (state !== 'active' && isSharing) {
        notify();
      }
    };

    const sub = AppState.addEventListener('change', onChange);
    return () => {
      sub.remove();
      if (isSharing) {
        notify();
      }
    };
  }, [isSharing]);

  const startSharing = async (driverId: string) => {
    if (isSharing || watchSub.current) return;

    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') return;

    const bg = await Location.requestBackgroundPermissionsAsync();
    if (bg.status !== 'granted') return;

    currentDriverId.current = driverId;
    currentDriverIdGlobal = driverId;

    watchSub.current = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 0 },
      async (loc) => {
        try {
          if (currentDriverId.current) {
            await setDoc(doc(db, 'buses', currentDriverId.current), {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              timestamp: serverTimestamp(),
            });
          }
        } catch (err) {
          console.error('Error sharing location:', err);
        }
      }
    );

    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 3000,
      distanceInterval: 0,
      showsBackgroundLocationIndicator: false,
      foregroundService: {
        notificationTitle: 'BogeyBus',
        notificationBody: 'Sharing your location',
      },
    });

    setIsSharing(true);
  };

  const stopSharing = async () => {
    if (!watchSub.current || !currentDriverId.current) return;

    watchSub.current.remove();
    watchSub.current = null;

    await Location.stopLocationUpdatesAsync(LOCATION_TASK);

    setIsSharing(false);

    const driverDocId = currentDriverId.current;

  try {
    await deleteDoc(doc(db, 'buses', driverDocId));

    const threshold = Timestamp.fromDate(new Date(Date.now() - 15000));
    const busesSnap = await getDocs(
      query(collection(db, 'buses'), where('timestamp', '>=', threshold))
    );
    const onlineBuses = busesSnap.docs;

    if (onlineBuses.length === 0) {
      const pendingRidesSnap = await getDocs(
        query(collection(db, 'rideRequests'), where('status', '==', 'pending'))
      );

      const deletions = pendingRidesSnap.docs.map(docSnap => deleteDoc(doc(db, 'rideRequests', docSnap.id)));
      await Promise.all(deletions);
    }
  } catch (err) {
    console.error('Error during stopSharing cleanup:', err);
  }

  currentDriverId.current = null;
  currentDriverIdGlobal = null;
};


  return (
    <LocationContext.Provider value={{ isSharing, startSharing, stopSharing }}>
      {children}
    </LocationContext.Provider>
  );
};

export const useLocationSharing = () => useContext(LocationContext);
