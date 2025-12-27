// firebase/firebaseconfig.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp, getApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';

// Your config is fine
const firebaseConfig = {
  apiKey: "AIzaSyAlFY4PQBbgRAVx0H-USoz-cPQShWsd-Ow",
  authDomain: "mck-transport.firebaseapp.com",
  projectId: "mck-transport",
  storageBucket: "mck-transport.appspot.com",
  messagingSenderId: "493336542072",
  appId: "1:493336542072:web:b2b1bf60318c695a96e68d",
  measurementId: "G-VMRX369RMD",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

const db = getFirestore(app);

export { app, auth, db };
