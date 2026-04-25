// src/auth/AuthProvider.tsx
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../firebase/firebaseconfig';
import { useOrg } from '../org/OrgContext';

type Role = 'student' | 'driver' | 'admin' | 'parent';

function normalizeRole(value: unknown): Role {
  if (value === 'driver' || value === 'admin' || value === 'student' || value === 'parent') return value;
  return 'student';
}

type AuthContextType = {
  user: User | null;
  role: Role | null;
  orgId: string | null;
  displayName: string | null;
  initializing: boolean;
  emailVerified: boolean;
  isSuperAdmin: boolean;
  reloadUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  role: null,
  orgId: null,
  displayName: null,
  initializing: true,
  emailVerified: false,
  isSuperAdmin: false,
  reloadUser: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { org, isLoadingOrg } = useOrg();
  const [user, setUser] = useState<User | null>(null);
  const [claimedOrgId, setClaimedOrgId] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [emailVerified, setEmailVerified] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  // Effect 1: track Firebase auth state + token claims only.
  // Does NOT load role — that's the job of Effect 2's live listener.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setEmailVerified(firebaseUser?.emailVerified ?? false);

      if (!firebaseUser) {
        setRole(null);
        setDisplayName(null);
        setIsSuperAdmin(false);
        setClaimedOrgId(null);
        setInitializing(false);
        return;
      }

      const tokenResult = await firebaseUser.getIdTokenResult();
      setIsSuperAdmin(tokenResult.claims.superAdmin === true);
      // Store the orgId baked into the token as a fallback when OrgContext
      // hasn't finished restoring from AsyncStorage yet.
      setClaimedOrgId((tokenResult.claims.orgId as string | undefined) ?? null);
      // initializing stays true — Effect 2 will clear it once the snapshot fires.
    });

    return unsub;
  }, []);

  // Prefer the org selected by the user over whatever the token claim says.
  const resolvedOrgId = org?.orgId ?? claimedOrgId ?? null;

  // Effect 2: live Firestore listener on orgs/{orgId}/users/{uid}.
  // Fires immediately with the current role and again any time an admin
  // (or Firebase console) changes it — no sign-out/sign-in required.
  useEffect(() => {
    const uid = user?.uid ?? null;

    if (!uid) return; // logged out — initializing already cleared in Effect 1

    // OrgContext is still restoring the saved org from AsyncStorage; wait for it
    // so we don't briefly show "no org" and tear down the listener prematurely.
    if (isLoadingOrg) return;

    if (!resolvedOrgId) {
      // Signed in but no org selected yet — user will be sent to OrgSelector.
      setRole(null);
      setInitializing(false);
      return;
    }

    const unsub = onSnapshot(
      doc(db, 'orgs', resolvedOrgId, 'users', uid),
      (snap) => {
        setRole(normalizeRole(snap.data()?.role));
        const storedName: string | null = snap.data()?.displayName ?? null;
        setDisplayName(storedName ?? user?.displayName ?? null);
        setInitializing(false);
      },
      () => {
        // Permission error or network failure — degrade gracefully.
        setRole('student');
        setDisplayName(user?.displayName ?? null);
        setInitializing(false);
      },
    );

    return unsub;
  }, [user?.uid, resolvedOrgId, isLoadingOrg]);

  const reloadUser = useCallback(async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    setEmailVerified(auth.currentUser.emailVerified);
  }, []);

  const orgId = org?.orgId ?? null;

  return (
    <AuthContext.Provider value={{ user, role, orgId, displayName, initializing, emailVerified, isSuperAdmin, reloadUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
