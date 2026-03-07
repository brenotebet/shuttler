import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import StackNavigator from './navigation/StackNavigator';
import { LocationProvider } from './location/LocationContext';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { DriverProvider } from './drivercontext/DriverContext';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/auth/AuthProvider';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true, 
    shouldShowList: true,  
  }),
});

export default function App() {
  useEffect(() => {
    registerForPushNotificationsAsync();
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <DriverProvider>
          <LocationProvider>
            <NavigationContainer>
              <StackNavigator />
            </NavigationContainer>
          </LocationProvider>
        </DriverProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

async function registerForPushNotificationsAsync() {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    if (__DEV__) {
      console.log('Push token:', token);
    }
  } catch {
    // Push token registration is non-critical; ignore failures silently.
  }
}