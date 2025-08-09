// firebaseConfig.js
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyCRSB9PR8WfOZImQMgkZRY_q467tVJp4DM",
  authDomain: "eagle-river-lawn-and-snow.firebaseapp.com",
  projectId: "eagle-river-lawn-and-snow",
  storageBucket: "eagle-river-lawn-and-snow.firebasestorage.app",
  messagingSenderId: "779248025312",
  appId: "1:779248025312:web:897383bf953d877c4d1a85"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

// Export the app instance if needed
export default app;