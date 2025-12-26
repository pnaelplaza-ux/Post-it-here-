import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, Auth } from 'firebase/auth';
import { getDatabase, Database } from 'firebase/database';
import { getAnalytics } from "firebase/analytics";

// Provided configuration
const firebaseConfig = {
  apiKey: "AIzaSyCQi1ZSAp7sao5Zu1lSpbU_T9iEobFBhKk",
  authDomain: "post-it-c8aff.firebaseapp.com",
  projectId: "post-it-c8aff",
  storageBucket: "post-it-c8aff.firebasestorage.app",
  messagingSenderId: "923007983674",
  appId: "1:923007983674:web:5e33f3bdd2f25e70349503"
};

// Mutable export to allow fallback
export let isDemoMode = firebaseConfig.apiKey === "YOUR_API_KEY";

let app;
export let auth: Auth | null = null;
export let db: Database | null = null;
let analytics;

if (!isDemoMode) {
  try {
    app = initializeApp(firebaseConfig);
    // Initialize Auth and Database first
    auth = getAuth(app);
    db = getDatabase(app);
    
    // Initialize Analytics safely
    try {
        analytics = getAnalytics(app);
    } catch (e) {
        console.warn("Analytics failed to load", e);
    }
    
    // Auto sign-in with robust fallback
    signInAnonymously(auth).catch((error) => {
      console.warn("Auth failed:", error.code, error.message);
      
      // If Auth is not configured in Console, fallback to Demo Mode automatically
      if (error.code === 'auth/configuration-not-found' || error.code === 'auth/operation-not-allowed') {
          console.log("Falling back to Demo Mode (Local Storage)...");
          isDemoMode = true;
          db = null;
          auth = null;
          // Notify the app to switch modes
          window.dispatchEvent(new Event('switch-to-demo-mode'));
      }
    });
  } catch (error) {
    console.error("Firebase initialization failed:", error);
    isDemoMode = true;
    db = null;
    auth = null;
  }
} else {
  console.log("Running in Demo Mode (Local Storage)");
}