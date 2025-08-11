// drivercontext/DriverContext.tsx

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

type DriverContextType = {
  driverId: string | null;
  setDriverId: (id: string | null) => void;
  logout: () => void;
};

const DriverContext = createContext<DriverContextType>({
  driverId: null,
  setDriverId: () => {},
  logout: () => {},
});

// Named export:
export const useDriver = () => {
  return useContext(DriverContext);
};

export const DriverProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [driverId, setDriverIdState] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem('driverId');
      if (stored) setDriverIdState(stored);
    })();
  }, []);

  const setDriverId = useCallback((id: string | null) => {
    setDriverIdState(id);
    if (id) {
      AsyncStorage.setItem('driverId', id);
    } else {
      AsyncStorage.removeItem('driverId');
    }
  }, []);

  const logout = useCallback(() => {
    setDriverIdState(null);
    AsyncStorage.removeItem('driverId');
  }, []);

  return (
    <DriverContext.Provider value={{ driverId, setDriverId, logout }}>
      {children}
    </DriverContext.Provider>
  );
};
