import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import * as Location from 'expo-location';
import { AppState, AppStateStatus } from 'react-native';
import * as Notifications from 'expo-notifications';
import { setDoc, doc, deleteDoc, query, collection, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase/firebaseconfig';

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
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const currentDriverId = useRef<string | null>(null);

  // Stop location sharing if the app goes into the background
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state !== 'active' && isSharing) {
        stopSharing();
        Notifications.scheduleNotificationAsync({
          content: {
            title: 'Location sharing stopped',
            body: 'Sharing was turned off because the app was closed.',
          },
          trigger: null,
        });
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, [isSharing]);

  const startSharing = async (driverId: string) => {
    // Prevent duplicate intervals
    if (isSharing || intervalRef.current) return;

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;

    currentDriverId.current = driverId;

    intervalRef.current = setInterval(async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({});
        if (currentDriverId.current) {
          await setDoc(doc(db, 'buses', currentDriverId.current), {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            timestamp: new Date().toISOString(),
          });
        }
      } catch (err) {
        console.error('Error sharing location:', err);
      }
    }, 3000);

    setIsSharing(true);
  };

  const stopSharing = async () => {
  if (!intervalRef.current || !currentDriverId.current) return;

  clearInterval(intervalRef.current);
  intervalRef.current = null;
  setIsSharing(false);

  const driverDocId = currentDriverId.current;

  try {
    await deleteDoc(doc(db, 'buses', driverDocId));

    const busesSnap = await getDocs(collection(db, 'buses'));
    const onlineBuses = busesSnap.docs.filter(docSnap => {
      const data = docSnap.data();
      const timestamp = new Date(data.timestamp);
      const secondsAgo = (new Date().getTime() - timestamp.getTime()) / 1000;
      return secondsAgo < 15;
    });

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
};


  return (
    <LocationContext.Provider value={{ isSharing, startSharing, stopSharing }}>
      {children}
    </LocationContext.Provider>
  );
};

export const useLocationSharing = () => useContext(LocationContext);
