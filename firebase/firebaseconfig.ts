// firebase/firebaseconfig.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { initializeAuth, getAuth, getReactNativePersistence, Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyBpKRq2XaDcz_pDftYIMGKMKk756HiOjC0",
  authDomain: "shuttler-8f030.firebaseapp.com",
  projectId: "shuttler-8f030",
  storageBucket: "shuttler-8f030.firebasestorage.app",
  messagingSenderId: "1080585468745",
  appId: "1:1080585468745:web:971766253b517cb432b898",
  measurementId: "G-763BLXDJQ5"
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
