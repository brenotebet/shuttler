// firebase/firebaseconfig.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';

// Your config is fine
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

const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

const db = getFirestore(app);

export { app, auth, db };
