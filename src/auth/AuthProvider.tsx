// src/auth/AuthProvider.tsx
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../../firebase/firebaseconfig';
import { useOrg } from '../org/OrgContext';

type Role = 'student' | 'driver' | 'admin';

function normalizeRole(value: unknown): Role {
  if (value === 'driver' || value === 'admin' || value === 'student') return value;
  return 'student';
}

type AuthContextType = {
  user: User | null;
  role: Role | null;
  orgId: string | null;
  initializing: boolean;
  emailVerified: boolean;
  isSuperAdmin: boolean;
  reloadUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  orgId: null,
  initializing: true,
  emailVerified: false,
  isSuperAdmin: false,
  reloadUser: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { org } = useOrg();
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [emailVerified, setEmailVerified] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setEmailVerified(firebaseUser?.emailVerified ?? false);

      if (!firebaseUser) {
        setRole(null);
        setIsSuperAdmin(false);
        setInitializing(false);
        return;
      }

      // Resolve orgId: prefer the selected org from OrgContext, fall back to
      // the custom claim set at registration/SAML-exchange time.
      const tokenResult = await firebaseUser.getIdTokenResult();
      const orgId =
        org?.orgId ??
        (tokenResult.claims.orgId as string | undefined) ??
        null;

      setIsSuperAdmin(tokenResult.claims.superAdmin === true);

      if (!orgId) {
        // No org context yet — user needs to select their org
        setRole(null);
        setInitializing(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, 'orgs', orgId, 'users', firebaseUser.uid));
        setRole(normalizeRole(snap.data()?.role));
      } catch {
        setRole('student');
      } finally {
        setInitializing(false);
      }
    });

    return unsub;
  }, [org?.orgId]);

  const reloadUser = useCallback(async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    setEmailVerified(auth.currentUser.emailVerified);
  }, []);

  const orgId = org?.orgId ?? null;

  return (
    <AuthContext.Provider value={{ user, role, orgId, initializing, emailVerified, isSuperAdmin, reloadUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
