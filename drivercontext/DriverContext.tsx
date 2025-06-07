// drivercontext/DriverContext.tsx

import React, { createContext, useContext, useState } from 'react';

type DriverContextType = {
  driverId: string | null;
  setDriverId: (id: string | null) => void;
};

const DriverContext = createContext<DriverContextType>({
  driverId: null,
  setDriverId: () => {},
});

// Named export:
export const useDriver = () => {
  return useContext(DriverContext);
};

export const DriverProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [driverId, setDriverId] = useState<string | null>(null);

  return (
    <DriverContext.Provider value={{ driverId, setDriverId }}>
      {children}
    </DriverContext.Provider>
  );
};
