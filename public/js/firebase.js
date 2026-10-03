// ============================================================
// firebase.js - Koneksi Sistem Presensi Digital MUPA -> Firebase Firestore
// ------------------------------------------------------------
// TAHAP INI: HANYA menghubungkan Firebase Firestore (koneksi saja).
//
//   - Supabase TETAP menjadi sumber Authentication/Login (tidak diubah).
//   - Firebase Authentication : TIDAK dipakai (script firebase-auth-compat
//     sengaja TIDAK dimuat).
//   - Firebase Storage        : TIDAK dipakai.
//   - TIDAK ada write, TIDAK membuat collection, TIDAK ada migrasi data.
//   - Tidak mengubah localStorage, UI/dashboard, routing, login/logout,
//     maupun fitur QR / GPS / parking / PDF.
//
// SDK dimuat via CDN dengan build COMPAT (classic script), mengikuti pola
// library lain di project ini (tailwind, supabase-js, socket.io, axios,
// jspdf). Urutan tag <script> di halaman:
//   <script src="https://www.gstatic.com/firebasejs/12.17.0/firebase-app-compat.js"></script>
//   <script src="https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore-compat.js"></script>
//   <script src="js/firebase.js"></script>
// Versi CDN 12.17.0 disamakan dengan paket `firebase` di node_modules.
//
// Hanya memakai konfigurasi Web (apiKey publik + Project ID).
// TIDAK ada service account / service_role key di frontend.
// ============================================================

const FIREBASE_CONFIG = {
    apiKey: "AIzaSyACFIy6GFG6fYxJschOwG8pBFervupoB-M",
    authDomain: "dataabsen-aa6db.firebaseapp.com",
    projectId: "dataabsen-aa6db",
    storageBucket: "dataabsen-aa6db.firebasestorage.app",
    messagingSenderId: "436789507853",
    appId: "1:436789507853:web:e94d5842b2fb233c6ce244"
};

let firebaseApp = null;
let firestoreDb = null;
let firebaseReady = false;

// ------------------------------------------------------------
// Inisialisasi Firebase + instance Firestore (sekali saat halaman dimuat).
// Gagal memuat SDK TIDAK boleh menghentikan aplikasi: hanya console.warn,
// aplikasi tetap berjalan seperti sebelumnya (localStorage + Supabase Auth).
// ------------------------------------------------------------
(function initFirebaseFirestore() {
    try {
        if (!window.firebase || typeof window.firebase.initializeApp !== "function") {
            throw new Error("Library Firebase (window.firebase) belum termuat. Pastikan script CDN firebase-app-compat.js dimuat sebelum js/firebase.js.");
        }
        if (typeof window.firebase.firestore !== "function") {
            throw new Error("Modul Firestore belum termuat. Pastikan script CDN firebase-firestore-compat.js dimuat sebelum js/firebase.js.");
        }

        // Hindari error "Firebase App named '[DEFAULT]' already exists"
        // bila file ini tidak sengaja dimuat dua kali di halaman yang sama.
        firebaseApp = (window.firebase.apps && window.firebase.apps.length)
            ? window.firebase.app()
            : window.firebase.initializeApp(FIREBASE_CONFIG);

        firestoreDb = window.firebase.firestore();
        firebaseReady = true;

        // ===== LOG DIAGNOSTIK (console-only, tidak menyentuh UI) =====
        console.log("[Firebase] SDK compat termuat - versi " + (window.firebase.SDK_VERSION || "-"));
        console.log("[Firebase] Firebase initialized - project: " + firebaseApp.options.projectId);
        console.log("Firebase Firestore initialized");
        console.log("[Firebase] Instance Firestore siap - nama app: " + firebaseApp.name +
            ", database: (default), collection() tersedia: " + (typeof firestoreDb.collection === "function"));
    } catch (error) {
        firebaseReady = false;
        firebaseApp = null;
        firestoreDb = null;
        console.warn("[Firebase] Gagal inisialisasi Firestore:", error && (error.message || error));
    }
})();

// Status kesiapan koneksi (dipakai kode tahap berikutnya).
function isReady() {
    return firebaseReady && !!firestoreDb;
}

// ------------------------------------------------------------
// Uji koneksi READ-ONLY. TIDAK dijalankan otomatis (agar console tetap
// bersih bila Firestore Rules belum mengizinkan akses) dan TIDAK menulis
// apa pun. Panggil manual dari Console browser bila ingin memastikan
// koneksi benar-benar sampai ke Firestore:
//     await FirebaseService.testConnection()
//
// Catatan: operasi baca TIDAK membuat collection/dokumen di Firestore.
// ------------------------------------------------------------
async function testFirestoreConnection() {
    if (!isReady()) {
        console.warn("[Firebase] Test koneksi dilewati - Firestore belum siap.");
        return { success: false, error: "firestore-not-available" };
    }
    try {
        const snap = await firestoreDb.collection("users").limit(1).get();
        console.log("[Firebase] Test koneksi Firestore berhasil - dokumen terbaca: " + snap.size +
            " (read-only, tidak ada data yang diubah).");
        return { success: true, documents: snap.size };
    } catch (error) {
        const code = (error && error.code) || null;
        console.warn("[Firebase] Test koneksi Firestore gagal:", code || (error && error.message) || error,
            "- ini hanya uji baca; periksa Firestore Rules/project bila perlu.");
        return { success: false, error: code || (error && error.message) || error };
    }
}

// ------------------------------------------------------------
// Expose service (koneksi) - TANPA CRUD data aplikasi pada tahap ini.
// Penamaan sengaja mengikuti pola window.SupabaseService di supabase.js.
// ------------------------------------------------------------
window.FirebaseService = {
    app: firebaseApp,
    db: firestoreDb,
    config: FIREBASE_CONFIG,
    projectId: FIREBASE_CONFIG.projectId,
    ready: firebaseReady,
    isReady: isReady,
    version: (typeof window.firebase !== "undefined" && window.firebase.SDK_VERSION) || null,
    testConnection: testFirestoreConnection
};

// Alias ringkas untuk kode tahap berikutnya (instance Firestore).
window.FirebaseDB = firestoreDb;
