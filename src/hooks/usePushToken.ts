// src/hooks/usePushToken.ts
// Saves the device's Expo push token to the user's Firestore doc after authentication.
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
        const { status } = await Notifications.getPermissionsAsync();
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
