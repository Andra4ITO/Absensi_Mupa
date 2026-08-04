// ============================================================
// firebase-bootstrap.js
// --------------------
// Jembatan (bridge) antara modul ESM (Firebase/Database) dengan
// halaman frontend yang menggunakan Vanilla JS non-module.
//
// Modul ini di-load via <script type="module"> pada halaman HTML.
// Setelah inisialisasi selesai, ia mengekspos fungsi-fungsi async
// ke window.FirebaseDB agar dapat dipanggil oleh script biasa
// (public/js/*.js) tanpa perlu merubah seluruh arsitektur.
// ============================================================
import Database, {
  firebaseReady,
  isFirebaseConfigured,
  getSiswa,
  getGuru,
  getKelas,
  getMapel,
  getLogKehadiran,
  getSesiPresensi,
  migrateSeedToFirestore
} from "./Database.js";

// Flag untuk mencegah inisialisasi ganda
let initializing = false;
let initialized = false;

/**
 * Fungsi utama yang dipanggil oleh halaman.
 * Melakukan inisialisasi Firebase (jika dikonfigurasi) dan
 * mengekspos API database ke window.FirebaseDB.
 */
export async function initFirebaseData() {
  if (initialized) return window.FirebaseDB;
  if (initializing) {
    console.warn("[Firebase] Inisialisasi sedang berjalan...");
    return window.FirebaseDB;
  }

  initializing = true;

  const firebaseDB = {
    firebaseReady,
    isFirebaseConfigured,
    // CRUD Generic
    async add(collectionName, data) {
      return Database.addRecord(collectionName, data);
    },
    async getAll(collectionName, options = {}) {
      return Database.getRecords(collectionName, options);
    },
    async getById(collectionName, id) {
      return Database.getRecordById(collectionName, id);
    },
    async getByField(collectionName, field, value) {
      return Database.getRecordByField(collectionName, field, value);
    },
    async update(collectionName, id, data) {
      return Database.updateRecord(collectionName, id, data);
    },
    async remove(collectionName, id) {
      return Database.deleteRecord(collectionName, id);
    },
    // Convenience per entitas
    async getSiswa(options) { return getSiswa(options); },
    async getGuru(options) { return getGuru(options); },
    async getKelas(options) { return getKelas(options); },
    async getMapel(options) { return getMapel(options); },
    async getLogKehadiran(options) { return getLogKehadiran(options); },
    async getSesiPresensi(options) { return getSesiPresensi(options); },
    async migrateSeed() { return migrateSeedToFirestore(); }
  };

  // Ekspos ke global scope agar bisa dipakai script non-module
  window.FirebaseDB = firebaseDB;

  // Firebase aktif -> jalankan migrasi seed otomatis (opsional)
  if (firebaseReady) {
    try {
      console.log("[Firebase] Firebase aktif. Menjalankan migrasi seed otomatis...");
      const result = await migrateSeedToFirestore();
      console.log("[Firebase] Hasil migrasi:", result);
      window.dispatchEvent(new CustomEvent("firebase-ready", { detail: firebaseDB }));
    } catch (error) {
      console.error("[Firebase] Gagal migrasi seed:", error);
    }
  } else {
    console.warn("[Firebase] Mode fallback API aktif (Firebase belum dikonfigurasi).");
    window.dispatchEvent(new CustomEvent("firebase-fallback", { detail: firebaseDB }));
  }

  initialized = true;
  initializing = false;

  return window.FirebaseDB;
}

// Panggil inisialisasi otomatis saat modul dimuat
initFirebaseData().catch((error) => {
  console.error("[Firebase] Bootstrap error:", error);
});

export default initFirebaseData;