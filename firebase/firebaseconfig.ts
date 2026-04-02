// firebase/firebaseconfig.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { initializeAuth, getAuth, getReactNativePersistence, Auth } from 'firebase/auth';

// Values are read from EXPO_PUBLIC_FIREBASE_* env vars at Metro bundle time.
// Hardcoded fallbacks keep local dev working before .env is populated —
// rotate the fallbacks once you've added the vars to EAS secrets and your .env.
const firebaseConfig = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY            ?? 'AIzaSyBpKRq2XaDcz_pDftYIMGKMKk756HiOjC0',
  authDomain:        process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN        ?? 'shuttler-8f030.firebaseapp.com',
  projectId:         process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID         ?? 'shuttler-8f030',
  storageBucket:     process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET     ?? 'shuttler-8f030.firebasestorage.app',
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '1080585468745',
  appId:             process.env.EXPO_PUBLIC_FIREBASE_APP_ID             ?? '1:1080585468745:web:971766253b517cb432b898',
  measurementId:     process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID     ?? 'G-763BLXDJQ5',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// initializeAuth throws if called on an already-initialized app (e.g. on hot reload).
// Try to initialize with AsyncStorage persistence; fall back to the existing auth instance.
let auth: Auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  auth = getAuth(app);
}

const db = getFirestore(app);

export { app, auth, db };
