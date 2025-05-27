import React, { createContext, useContext, useState, useRef } from 'react';
import * as Location from 'expo-location';
import { setDoc, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase/firebaseconfig';

type LocationContextType = {
  isSharing: boolean;
  startSharing: () => void;
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

  const startSharing = async () => {
    if (isSharing || intervalRef.current) return;

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;

    const id = setInterval(async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({});
        await setDoc(doc(db, 'buses', 'busA'), {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error('Error sharing location:', err);
      }
    }, 3000);

    intervalRef.current = id;
    setIsSharing(true);
  };

  const stopSharing = async () => {
    if (intervalRef.current) {
    clearInterval(intervalRef.current);
    intervalRef.current = null;
    setIsSharing(false);

    try {
      await deleteDoc(doc(db, 'buses', 'busA'));
    } catch (err) {
      console.error('Failed to clear bus location:', err);
    }
  }
  };

  return (
    <LocationContext.Provider value={{ isSharing, startSharing, stopSharing }}>
      {children}
    </LocationContext.Provider>
  );
};

export const useLocationSharing = () => useContext(LocationContext);
