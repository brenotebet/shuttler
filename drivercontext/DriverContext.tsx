// drivercontext/DriverContext.tsx
import React, { createContext, useContext, useMemo } from 'react';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase/firebaseconfig';
import { useAuth } from '../src/auth/AuthProvider';

type DriverContextType = {
  driverId: string | null;
  loading: boolean;
  logout: () => Promise<void>;
};

const DriverContext = createContext<DriverContextType>({
  driverId: null,
  loading: true,
  logout: async () => {},
});

export const useDriver = () => useContext(DriverContext);

export const DriverProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, initializing } = useAuth();

  const logout = async () => {
    await signOut(auth);
  };

  const value = useMemo(
    () => ({ driverId: user?.uid ?? null, loading: initializing, logout }),
    [user, initializing],
  );

  return <DriverContext.Provider value={value}>{children}</DriverContext.Provider>;
};
