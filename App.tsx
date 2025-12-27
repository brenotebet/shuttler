import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import StackNavigator from './navigation/StackNavigator';
import { LocationProvider } from './location/LocationContext';
import * as Notifications from 'expo-notifications';
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

  const token = (await Notifications.getExpoPushTokenAsync()).data;
  if (__DEV__) {
    console.log('Push token:', token);
  }
}