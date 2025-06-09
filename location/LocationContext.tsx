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

  // Remind the driver to stop sharing if the app moves to the background
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state !== 'active' && isSharing) {
        Notifications.scheduleNotificationAsync({
          content: {
            title: 'Sharing still active',
            body: 'Remember to stop sharing your location when finished driving.',
          },
          trigger: null,
        });
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
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
      { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 1 },
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
      distanceInterval: 1,
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
