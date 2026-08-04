// ============================================================
// Database.js
// -----------
// Layer data untuk Sistem Presensi Digital SMKS Muhammadiyah Pakem.
// Menggunakan Firebase Firestore (modular SDK) sebagai primary store.
//
// Jika kredensial Firebase belum dikonfigurasi, semua operasi akan
// di-delegate ke REST API server (yang menggunakan Lowdb JSON) agar
// aplikasi tetap berfungsi tanpa crash.
// ============================================================
import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp
} from "firebase/firestore";
import { initFirebase, getDb, isFirebaseConfigured } from "./firebaseConfig.js";

// Flag status Firebase (dihitung sekali saat modul dimuat)
let firebaseReady = false;
let db = null;

// Inisialisasi Firebase saat modul pertama kali diimpor
try {
  const app = initFirebase();
  firebaseReady = !!app && isFirebaseConfigured();
  if (firebaseReady) {
    db = getDb();
  }
} catch (error) {
  console.warn("[Database] Firebase tidak tersedia, gunakan fallback API:", error.message);
  firebaseReady = false;
}

// ===== HELPER =====
// Map Firestore document snapshot -> object biasa dengan id
const mapDoc = (docSnap) => ({
  id: docSnap.id,
  ...docSnap.data()
});

const mapDocs = (snapshot) => snapshot.docs.map(mapDoc);

// ===== GENERIC FIREBASE CRUD =====

/**
 * Tambah dokumen baru ke koleksi.
 * @param {string} collectionName - Nama koleksi (siswa, guru, kelas, mapel, logKehadiran, dsb.)
 * @param {Object} data - Data yang akan disimpan
 * @returns {Promise<{id: string, ...data}>}
 */
export async function addRecord(collectionName, data = {}) {
  if (firebaseReady) {
    const docRef = await addDoc(collection(db, collectionName), {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return { id: docRef.id, ...data };
  }
  // Fallback: POST ke REST API
  const res = await fetch(`/api/${collectionName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || "Gagal menambah data");
  return json.data || json;
}

/**
 * Ambil semua dokumen dari koleksi.
 * @param {string} collectionName
 * @param {Object} options - { where: {field, operator, value}, orderBy: {field, direction}, limit }
 * @returns {Promise<Array<Object>>}
 */
export async function getRecords(collectionName, options = {}) {
  if (firebaseReady) {
    let q = collection(db, collectionName);

    const conditions = [];
    if (options.where) {
      const { field, operator, value } = options.where;
      conditions.push(where(field, operator || "==", value));
    }

    if (options.orderBy) {
      conditions.push(orderBy(options.orderBy.field, options.orderBy.direction || "asc"));
    }

    if (conditions.length > 0) {
      q = query(q, ...conditions);
    }

    const snapshot = await getDocs(q);
    return mapDocs(snapshot);
  }
  // Fallback: GET ke REST API
  const res = await fetch(`/api/${collectionName}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || "Gagal mengambil data");
  return json.data || [];
}

/**
 * Ambil satu dokumen berdasarkan field & value.
 * @param {string} collectionName
 * @param {string} field
 * @param {*} value
 */
export async function getRecordByField(collectionName, field, value) {
  if (firebaseReady) {
    const q = query(collection(db, collectionName), where(field, "==", value), limit(1));
    const snapshot = await getDocs(q);
    const docs = mapDocs(snapshot);
    return docs.length > 0 ? docs[0] : null;
  }
  // Fallback: GET semua lalu filter
  const records = await getRecords(collectionName);
  return records.find(r => r[field] === value) || null;
}

/**
 * Ambil satu dokumen berdasarkan ID Firestore (document id).
 * @param {string} collectionName
 * @param {string} id
 */
export async function getRecordById(collectionName, id) {
  if (firebaseReady) {
    const docRef = doc(db, collectionName, id);
    const snap = await getDoc(docRef);
    if (!snap.exists()) return null;
    return mapDoc(snap);
  }
  const records = await getRecords(collectionName);
  return records.find(r => String(r.id) === String(id)) || null;
}

/**
 * Update dokumen berdasarkan ID Firestore.
 * @param {string} collectionName
 * @param {string} id
 * @param {Object} data
 */
export async function updateRecord(collectionName, id, data = {}) {
  if (firebaseReady) {
    const docRef = doc(db, collectionName, id);
    await updateDoc(docRef, {
      ...data,
      updatedAt: serverTimestamp()
    });
    return { id, ...data };
  }
  const res = await fetch(`/api/${collectionName}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || "Gagal update data");
  return json.data || json;
}

/**
 * Hapus dokumen berdasarkan ID Firestore.
 * @param {string} collectionName
 * @param {string} id
 */
export async function deleteRecord(collectionName, id) {
  if (firebaseReady) {
    const docRef = doc(db, collectionName, id);
    await deleteDoc(docRef);
    return { id, deleted: true };
  }
  const res = await fetch(`/api/${collectionName}/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" }
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || "Gagal hapus data");
  return json.data || json;
}

// ===== COLLECTION CONSTANTS =====
export const COLLECTIONS = {
  SISWA: "siswa",
  GURU: "guru",
  KELAS: "kelas",
  MAPEL: "mapel",
  GURU_MAPEL: "guruMapel",
  SESI_PRESENSI: "sesiPresensi",
  LOG_KEHADIRAN: "logKehadiran",
  USERS: "users"
};

// ===== CONVENIENCE METHODS =====

// --- SISWA ---
export const getSiswa = (options) => getRecords(COLLECTIONS.SISWA, options);
export const getSiswaById = (id) => getRecordById(COLLECTIONS.SISWA, id);
export const addSiswa = (data) => addRecord(COLLECTIONS.SISWA, data);
export const updateSiswa = (id, data) => updateRecord(COLLECTIONS.SISWA, id, data);
export const deleteSiswa = (id) => deleteRecord(COLLECTIONS.SISWA, id);

// --- GURU ---
export const getGuru = (options) => getRecords(COLLECTIONS.GURU, options);
export const getGuruById = (id) => getRecordById(COLLECTIONS.GURU, id);
export const addGuru = (data) => addRecord(COLLECTIONS.GURU, data);
export const updateGuru = (id, data) => updateRecord(COLLECTIONS.GURU, id, data);
export const deleteGuru = (id) => deleteRecord(COLLECTIONS.GURU, id);

// --- KELAS ---
export const getKelas = (options) => getRecords(COLLECTIONS.KELAS, options);
export const getKelasById = (id) => getRecordById(COLLECTIONS.KELAS, id);
export const addKelas = (data) => addRecord(COLLECTIONS.KELAS, data);
export const updateKelas = (id, data) => updateRecord(COLLECTIONS.KELAS, id, data);
export const deleteKelas = (id) => deleteRecord(COLLECTIONS.KELAS, id);

// --- MAPEL ---
export const getMapel = (options) => getRecords(COLLECTIONS.MAPEL, options);
export const addMapel = (data) => addRecord(COLLECTIONS.MAPEL, data);
export const updateMapel = (id, data) => updateRecord(COLLECTIONS.MAPEL, id, data);
export const deleteMapel = (id) => deleteRecord(COLLECTIONS.MAPEL, id);

// --- LOG KEHADIRAN ---
export const getLogKehadiran = (options) => getRecords(COLLECTIONS.LOG_KEHADIRAN, options);
export const addLogKehadiran = (data) => addRecord(COLLECTIONS.LOG_KEHADIRAN, data);

// --- SESI PRESENSI ---
export const getSesiPresensi = (options) => getRecords(COLLECTIONS.SESI_PRESENSI, options);
export const addSesiPresensi = (data) => addRecord(COLLECTIONS.SESI_PRESENSI, data);
export const updateSesiPresensi = (id, data) => updateRecord(COLLECTIONS.SESI_PRESENSI, id, data);

/**
 * Migrasi data awal (seed) ke Firestore.
 * Panggil sekali setelah Firebase dikonfigurasi untuk mengisi koleksi
 * dari data yang sudah ada di backend (Lowdb).
 */
export async function migrateSeedToFirestore() {
  if (!firebaseReady) {
    console.warn("[Database] Firebase belum dikonfigurasi, migrasi dilewati.");
    return { migrated: false, reason: "firebase-not-configured" };
  }

  const results = {};

  // Baca data dari REST API (backend Lowdb) lalu tulis ke Firestore
  const collectionsToMigrate = [
    COLLECTIONS.SISWA,
    COLLECTIONS.GURU,
    COLLECTIONS.KELAS,
    COLLECTIONS.MAPEL,
    COLLECTIONS.GURU_MAPEL,
    COLLECTIONS.USERS
  ];

  for (const col of collectionsToMigrate) {
    try {
      const res = await fetch(`/api/${col}`);
      const json = await res.json();
      const records = json.data || [];

      // Hanya isi jika koleksi Firestore masih kosong
      const existing = await getRecords(col);
      if (existing.length === 0) {
        let count = 0;
        for (const record of records) {
          const { id, ...data } = record;
          await addDoc(collection(db, col), { ...data, legacyId: id });
          count++;
        }
        results[col] = { migrated: count };
      } else {
        results[col] = { migrated: 0, reason: "already-exists" };
      }
    } catch (error) {
      console.error(`[Database] Gagal migrasi ${col}:`, error.message);
      results[col] = { migrated: 0, error: error.message };
    }
  }

  return { migrated: true, results };
}

export default {
  firebaseReady,
  isFirebaseConfigured,
  addRecord,
  getRecords,
  getRecordByField,
  getRecordById,
  updateRecord,
  deleteRecord,
  getSiswa,
  getSiswaById,
  addSiswa,
  updateSiswa,
  deleteSiswa,
  getGuru,
  getGuruById,
  addGuru,
  updateGuru,
  deleteGuru,
  getKelas,
  getKelasById,
  addKelas,
  updateKelas,
  deleteKelas,
  getMapel,
  addMapel,
  updateMapel,
  deleteMapel,
  getLogKehadiran,
  addLogKehadiran,
  getSesiPresensi,
  addSesiPresensi,
  updateSesiPresensi,
  migrateSeedToFirestore,
  COLLECTIONS
};