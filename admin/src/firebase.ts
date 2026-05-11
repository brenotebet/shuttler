import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            ?? 'AIzaSyBpKRq2XaDcz_pDftYIMGKMKk756HiOjC0',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        ?? 'shuttler-8f030.firebaseapp.com',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         ?? 'shuttler-8f030',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     ?? 'shuttler-8f030.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '1080585468745',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID             ?? '1:1080585468745:web:971766253b517cb432b898',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
