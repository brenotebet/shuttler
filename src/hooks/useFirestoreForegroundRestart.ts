// src/hooks/useFirestoreForegroundRestart.ts
// Restarts the Firestore connection when the app comes back to the foreground
// after a while in the background, so a connection that hung silently while
// the app was away doesn't leave every live listener frozen. See
// src/utils/firestoreReconnect.ts.

import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { firestoreReconnector } from '../../firebase/firebaseconfig';
import { shouldRestartAfterBackground } from '../utils/firestoreReconnect';

export function useFirestoreForegroundRestart() {
  const backgroundedAtRef = useRef<number | null>(null);

  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === 'background') {
        backgroundedAtRef.current = Date.now();
        return;
      }
      if (state === 'active') {
        const since = backgroundedAtRef.current;
        backgroundedAtRef.current = null;
        if (shouldRestartAfterBackground(since === null ? null : Date.now() - since)) {
          firestoreReconnector.restart('app returned to foreground').catch(() => {});
        }
      }
    };
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);
}
