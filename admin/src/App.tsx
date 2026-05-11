import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from './firebase';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';

type AuthState = 'loading' | 'unauthenticated' | 'unauthorized' | 'authorized';

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setAuthState('unauthenticated');
        return;
      }
      const tokenResult = await firebaseUser.getIdTokenResult();
      if (tokenResult.claims.superAdmin === true) {
        setUser(firebaseUser);
        setAuthState('authorized');
      } else {
        setUser(firebaseUser);
        setAuthState('unauthorized');
      }
    });
  }, []);

  if (authState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (authState === 'unauthenticated') {
    return <LoginPage onLogin={() => {}} />;
  }

  if (authState === 'unauthorized') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-semibold text-gray-700">Access denied</p>
          <p className="text-sm text-gray-500 mt-1">
            Your account ({user?.email}) does not have super-admin access.
          </p>
          <button
            onClick={() => auth.signOut()}
            className="mt-4 text-sm text-indigo-600 hover:underline"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return <DashboardPage user={user!} />;
}
