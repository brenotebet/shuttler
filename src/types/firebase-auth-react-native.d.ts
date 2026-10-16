// metro.config.js resolves 'firebase/auth/react-native' to @firebase/auth's
// React Native build at bundle time, but Firebase 11 ships no type
// declarations for that subpath. This declares the one export the app uses,
// with the same signature as @firebase/auth/dist/rn/index.rn.d.ts.
declare module 'firebase/auth/react-native' {
  import type { Persistence, ReactNativeAsyncStorage } from 'firebase/auth';
  export function getReactNativePersistence(storage: ReactNativeAsyncStorage): Persistence;
}
