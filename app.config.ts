import { ConfigContext, ExpoConfig } from 'expo/config';
import { load } from '@expo/env';

load(process.cwd());

const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Shuttler',
  slug: 'shuttler',
  version: '1.0.0',
  scheme: 'shuttler',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  newArchEnabled: true,
  jsEngine: 'jsc',
  splash: {
    image: './assets/splash-icon.png',
    resizeMode: 'contain',
    backgroundColor: '#ffffff',
  },
  ios: {
    bundleIdentifier: 'com.shuttler.app',
    supportsTablet: true,
    config: {
      googleMapsApiKey,
    },
    infoPlist: {
      NSLocationWhenInUseUsageDescription: 'Allow Shuttler to access your location while using the app.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Allow Shuttler to access your location even when the app is in the background.',
      UIBackgroundModes: ['location'],
    },
  },
  android: {
    config: {
      googleMaps: { apiKey: googleMapsApiKey },
    },
    intentFilters: [
      {
        action: 'VIEW',
        category: ['BROWSABLE', 'DEFAULT'],
        data: [{ scheme: 'shuttler', host: 'sso' }],
      },
    ],
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#ffffff',
    },
    edgeToEdgeEnabled: true,
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'ACCESS_BACKGROUND_LOCATION',
    ],
    package: 'com.shuttler.app',
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    ['expo-notifications'],
    ['expo-location'],
    ["@stripe/stripe-react-native", { merchantIdentifier: "merchant.com.shuttler.app" }]
  ],
});
