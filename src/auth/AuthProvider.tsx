// src/auth/AuthProvider.tsx
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../firebase/firebaseconfig';
import { useOrg } from '../org/OrgContext';
import { isSocialSignInPending } from './socialSignInPending';

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
  signingOut: boolean;
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
  signingOut: false,
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
  const [signingOut, setSigningOut] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  // Effect 1: track Firebase auth state + token claims only.
  // Does NOT load role — that's the job of Effect 2's live listener.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setEmailVerified(firebaseUser?.emailVerified ?? false);
      // Always wipe the role on any auth state change so stale in-memory role
      // from a previous session can never briefly render the wrong stack while
      // Effect 2's snapshot re-validates membership.
      setRole(null);
      setInitializing(true);

      if (!firebaseUser) {
        setDisplayName(null);
        setIsSuperAdmin(false);
        setClaimedOrgId(null);
        setInitializing(false);
        setSigningOut(false); // clear after user=null is confirmed — prevents brief screen flash
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
        // Firestore fires twice: first with local cache, then with server data.
        // Never grant access based on stale cache — only act on server-confirmed results.
        if (snap.metadata.fromCache) return;

        if (snap.exists()) {
          setRole(normalizeRole(snap.data()?.role));
          setDisplayName(snap.data()?.displayName ?? user?.displayName ?? null);
        } else {
          if (isSocialSignInPending()) {
            // A social sign-in is in progress — the user doc is being created
            // right now. Don't evict; the snapshot will re-fire once it's written.
            setInitializing(false);
            return;
          }
          // Server confirmed: no membership doc → not a member of this org.
          setSigningOut(true);
          setRole(null);
          signOut(auth).catch(() => {});
          // signingOut cleared by onAuthStateChanged(null) once sign-out confirms
        }
        setInitializing(false);
      },
      (error) => {
        console.warn('[AuthProvider] user doc snapshot error:', (error as any).code, (error as any).message);
        setSigningOut(true);
        setRole(null);
        setInitializing(false);
        signOut(auth).catch(() => {});
        // signingOut cleared by onAuthStateChanged(null) once sign-out confirms
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
    <AuthContext.Provider value={{ user, role, orgId, displayName, initializing, signingOut, emailVerified, isSuperAdmin, reloadUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
