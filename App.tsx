import React, { useEffect, useRef } from 'react';
import { View, Platform, ScrollView } from 'react-native'
import { Text } from './components/Text';
import * as SplashScreen from 'expo-splash-screen';

SplashScreen.preventAutoHideAsync().catch(() => {});
import { NavigationContainer, NavigationContainerRef } from '@react-navigation/native';
import StackNavigator, { RootStackParamList } from './navigation/StackNavigator';
import { LocationProvider } from './location/LocationContext';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { DriverProvider } from './drivercontext/DriverContext';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/auth/AuthProvider';
import { OrgProvider } from './src/org/OrgContext';
import { AccessibilityProvider } from './src/contexts/AccessibilityContext';
import { usePushToken } from './src/hooks/usePushToken';
import { StripeProvider } from '@stripe/stripe-react-native';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase/firebaseconfig';
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
  enabled: !__DEV__,
  tracesSampleRate: 0.2,
});

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    Sentry.captureException(error, { extra: { componentStack: info.componentStack } });
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
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

function PushTokenRegistrar() {
  usePushToken();
  return null;
}

function NotificationDeepLinker({ navigationRef }: { navigationRef: React.RefObject<NavigationContainerRef<RootStackParamList> | null> }) {
  const lastResponse = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (!lastResponse) return;
    const data = lastResponse.notification.request.content.data as
      | Record<string, string>
      | undefined;
    if (!data?.type) return;

    const nav = navigationRef.current;
    if (!nav?.isReady()) return;

    switch (data.type) {
      case 'new_request':
        nav.navigate('DriverHome');
        break;
      case 'bus_arriving':
        nav.navigate('StudentHome', data.stopId
          ? { screen: 'Map', params: { focusStopId: data.stopId, focusStopName: data.stopName } }
          : undefined);
        break;
      case 'request_cancelled':
        nav.navigate('StudentHome');
        break;
      case 'request_completed':
        nav.navigate('StudentHistory');
        break;
    }
  }, [lastResponse]);

  return null;
}

export default function App() {
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);

  useEffect(() => {
    registerForPushNotificationsAsync();
  }, []);

  return (
    <ErrorBoundary>
      <StripeProvider publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''}>
        <SafeAreaProvider>
          <AccessibilityProvider>
          <OrgProvider>
            <AuthProvider>
              <PushTokenRegistrar />
              <DriverProvider>
                <LocationProvider>
                  <NavigationContainer ref={navigationRef}>
                    <StackNavigator />
                    <NotificationDeepLinker navigationRef={navigationRef} />
                  </NavigationContainer>
                </LocationProvider>
              </DriverProvider>
            </AuthProvider>
          </OrgProvider>
          </AccessibilityProvider>
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
