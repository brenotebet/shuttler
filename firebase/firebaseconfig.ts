// firebase/firebaseconfig.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { initializeAuth, getAuth, getReactNativePersistence, Auth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyCFSRvElVpTPnFPShpbUwYzamLgtqw1EmQ",
  authDomain: "bogey-bus-tracker.firebaseapp.com",
  projectId: "bogey-bus-tracker",
  storageBucket: "bogey-bus-tracker.firebasestorage.app",
  messagingSenderId: "654162335695",
  appId: "1:654162335695:web:32110715f48005e4a0e4ba",
  measurementId: "G-9VMB81C9KE"
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
