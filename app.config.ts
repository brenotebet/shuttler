import { ConfigContext, ExpoConfig } from 'expo/config';
import { load } from '@expo/env';

load(process.cwd());

const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'bogey-bus',
  slug: 'bogey-bus',
  version: '1.0.0',
  scheme: 'bogeybus',
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
    bundleIdentifier: 'edu.mckendree.shuttle',
    supportsTablet: true,
    config: {
      googleMapsApiKey,
    },
    infoPlist: {
      NSLocationWhenInUseUsageDescription: 'Allow BogeyBus to access your location while using the app.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'Allow BogeyBus to access your location even when the app is in the background.',
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
        data: [{ scheme: 'bogeybus', host: 'sso' }],
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
    package: 'com.anonymous.bogeybus',
  },
  web: {
    favicon: './assets/favicon.png',
  },
});
