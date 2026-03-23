import React, { useEffect } from 'react';
import { View, Text, Platform, ScrollView } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import StackNavigator from './navigation/StackNavigator';
import { LocationProvider } from './location/LocationContext';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { DriverProvider } from './drivercontext/DriverContext';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/auth/AuthProvider';
import { OrgProvider } from './src/org/OrgContext';
import { StripeProvider } from '@stripe/stripe-react-native';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase/firebaseconfig';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    addDoc(collection(db, 'crashes'), {
      message: error.message,
      stack: (error.stack ?? '').slice(0, 2000),
      componentStack: (info.componentStack ?? '').slice(0, 2000),
      platform: Platform.OS,
      appVersion: Constants.expoConfig?.version ?? null,
      timestamp: serverTimestamp(),
    }).catch(() => {
      console.error('[crash]', error.message, error.stack);
    });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: '#fff', padding: 32, justifyContent: 'center' }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#DC2626', marginBottom: 8 }}>
          Something went wrong
        </Text>
        <Text style={{ fontSize: 14, color: '#555', marginBottom: 16 }}>
          The app ran into an unexpected error. Please restart.
        </Text>
        <ScrollView style={{ maxHeight: 300, backgroundColor: '#f3f4f6', borderRadius: 8, padding: 12 }}>
          <Text selectable style={{ fontFamily: 'Menlo', fontSize: 11, color: '#111' }}>
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </Text>
        </ScrollView>
      </View>
    );
  }
}

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
    <ErrorBoundary>
      <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''}>
        <SafeAreaProvider>
          <OrgProvider>
            <AuthProvider>
              <DriverProvider>
                <LocationProvider>
                  <NavigationContainer>
                    <StackNavigator />
                  </NavigationContainer>
                </LocationProvider>
              </DriverProvider>
            </AuthProvider>
          </OrgProvider>
        </SafeAreaProvider>
      </StripeProvider>
    </ErrorBoundary>
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