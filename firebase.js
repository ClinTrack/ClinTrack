// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-storage.js";

// NEW ClinTrack config
export const firebaseConfig = {
  apiKey: "AIzaSyDnupvzK0RQtG4v0I14xU47eEC8iQd0NdA",
  authDomain: "clintrack-portal.firebaseapp.com",
  databaseURL: "https://clintrack-portal-default-rtdb.firebaseio.com",
  projectId: "clintrack-portal",
  storageBucket: "clintrack-portal.firebasestorage.app",
  messagingSenderId: "84426479412",
  appId: "1:84426479412:web:629045119c18e17163f761"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Optional global access
window.firebaseApp = app;
window.firebaseAuth = auth;
window.firebaseDb = db;
window.firebaseStorage = storage;
