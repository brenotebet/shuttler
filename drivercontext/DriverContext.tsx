// drivercontext/DriverContext.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from '../firebase/firebaseconfig';

type DriverContextType = {
  driverId: string | null;     // keep name to minimize refactors; this now equals auth.uid
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
  const [driverId, setDriverId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setDriverId(user?.uid ?? null); // ✅ ONLY source of truth
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const logout = async () => {
    await signOut(auth); // ✅ clears auth + token
    // state will reset via onAuthStateChanged
  };

  const value = useMemo(() => ({ driverId, loading, logout }), [driverId, loading]);

  return <DriverContext.Provider value={value}>{children}</DriverContext.Provider>;
};
