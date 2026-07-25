// src/hooks/usePushToken.ts
// Requests notification permission and saves the device's Expo push token to
// the user's Firestore doc, once the user is signed into an org. Running this
// post-sign-in (rather than at cold app launch) means the permission prompt
// appears with real context — "you're about to use live tracking" — instead
// of blindly on first open, which App Review flags and users tend to decline.
// Must be used inside AuthProvider.
import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { doc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase/firebaseconfig';
import { useAuth } from '../auth/AuthProvider';

export function usePushToken() {
  const { user, orgId } = useAuth();

  useEffect(() => {
    if (!user || !orgId) return;

    const registerToken = async () => {
      try {
        let { status } = await Notifications.getPermissionsAsync();
        if (status === 'undetermined') {
          ({ status } = await Notifications.requestPermissionsAsync());
        }
        if (status !== 'granted') return;

        const projectId =
          Constants.expoConfig?.extra?.eas?.projectId ??
          (Constants as any).easConfig?.projectId;

        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

        await setDoc(
          doc(db, 'orgs', orgId, 'users', user.uid),
          { expoPushToken: token },
          { merge: true },
        );
      } catch {
        // Non-critical: push notifications degrade gracefully if token can't be saved.
      }
    };

    registerToken();
  }, [user?.uid, orgId]);
}
