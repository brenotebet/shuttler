import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';


const firebaseConfig = {
  apiKey: "AIzaSyAlFY4PQBbgRAVx0H-USoz-cPQShWsd-Ow",
  authDomain: "mck-transport.firebaseapp.com",
  projectId: "mck-transport",
  storageBucket: "mck-transport.appspot.com",
  messagingSenderId: "493336542072",
  appId: "1:493336542072:web:b2b1bf60318c695a96e68d",
  measurementId: "G-VMRX369RMD"
};

const app = initializeApp(firebaseConfig); 
const auth = getAuth(app);
const db = getFirestore(app);

export { auth, db };
