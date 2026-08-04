// ============================================================
// firebaseConfig.js
// -----------------
// Inisialisasi Firebase App & Firestore (modular SDK v10+).
//
// NOTE:
// Ganti nilai placeholder di bawah dengan kredensial proyek
// Firebase Anda (dari Firebase Console > Project Settings).
// Cara terbaik: gunakan environment variables di build proses.
// ============================================================
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  // ==== GANTI DENGAN KREDENSIAL PROJECT FIREBASE ANDA ====
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
  // Optional: measurementId: "G-XXXXXXX"
  // ========================================================
};

// Deteksi apakah config masih placeholder (belum dikonfigurasi)
export const isFirebaseConfigured = () => {
  return (
    firebaseConfig.apiKey &&
    firebaseConfig.apiKey !== "YOUR_API_KEY" &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId !== "YOUR_PROJECT_ID"
  );
};

let app = null;
let db = null;

// Inisialisasi hanya jika kredensial valid & belum diinisialisasi.
// Memanggil initializeApp berulang kali akan melempar error
// "Firebase: Firebase App named '[DEFAULT]' already exists",
// jadi kita guard dengan flag.
let firebaseInitialized = false;

export function initFirebase() {
  if (firebaseInitialized) return app;

  if (!isFirebaseConfigured()) {
    console.warn(
      "[Firebase] Kredensial belum dikonfigurasi. " +
      "Gunakan fallback data (server/localStorage). " +
      "Buka src/models/firebaseConfig.js untuk memasukkan credential."
    );
    return null;
  }

  try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    firebaseInitialized = true;
    console.log("[Firebase] Firestore berhasil diinisialisasi.");
    return app;
  } catch (error) {
    console.error("[Firebase] Gagal inisialisasi:", error);
    return null;
  }
}

// Getter Firestore instance (null jika belum dikonfigurasi)
export function getDb() {
  if (!firebaseInitialized) initFirebase();
  return db;
}

// Getter app instance (null jika belum dikonfigurasi)
export function getApp() {
  if (!firebaseInitialized) initFirebase();
  return app;
}

export default firebaseConfig;