// src/auth/AuthProvider.tsx
import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../firebase/firebaseconfig';

type Role = 'student' | 'driver' | 'admin';

type AuthContextType = {
  user: User | null;
  role: Role | null;
  initializing: boolean;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  initializing: true,
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (!firebaseUser) {
        setRole(null);
        setInitializing(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, 'users', firebaseUser.uid));
        setRole((snap.data()?.role as Role) ?? 'student');
      } catch {
        setRole('student');
      } finally {
        setInitializing(false);
      }
    });

    return unsub;
  }, []);

  return (
    <AuthContext.Provider value={{ user, role, initializing }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
