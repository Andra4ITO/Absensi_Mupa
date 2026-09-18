// ============================================================
// sync-mapping.js
// ---------------
// Mapping antara localStorage (sumber utama aplikasi) dan
// koleksi Firestore. Murni logika data (tanpa Firebase SDK)
// agar dapat diuji otomatis dan dipakai bersama oleh
// firebase-sync.js (module) dan halaman klasik.
// ============================================================

const SyncMapping = {
    // key localStorage -> koleksi Firestore
    STORES: [
        { key: 'mupa_users', coll: 'users', label: 'Pengguna' },
        { key: 'mupa_subjects', coll: 'subjects', label: 'Mata Pelajaran' },
        { key: 'mupa_attendance_sessions', coll: 'attendance_sessions', label: 'Sesi Presensi' },
        { key: 'mupa_attendance_records', coll: 'attendance_records', label: 'Presensi QR' },
        { key: 'mupa_parking_tickets', coll: 'parking_tickets', label: 'Karcis Parkir' }
    ],

    findStore(collName) {
        return this.STORES.find(function (s) { return s.coll === collName; }) || null;
    },

    // Firestore doc ID tidak boleh mengandung '/'
    sanitizeId(id) {
        let s = String(id == null ? '' : id).trim().replace(/[\/\\#]/g, '_');
        if (!s) s = 'doc-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
        return s;
    },

    // Item lokal -> dokumen Firestore (aman: undefined -> null, Date -> ISO)
    toDoc(item) {
        const out = {};
        Object.keys(item || {}).forEach(function (k) {
            const v = item[k];
            if (v === undefined) { out[k] = null; return; }
            if (v instanceof Date) { out[k] = v.toISOString(); return; }
            out[k] = v;
        });
        out.syncedAt = new Date().toISOString();
        return out;
    },

    // Dokumen Firestore -> item lokal (buang metadata sinkron, pastikan id)
    fromDoc(id, data) {
        const out = Object.assign({}, data || {});
        delete out.syncedAt;
        out.id = id;
        return out;
    },

    // Aman terhadap JSON rusak
    getStore(key) {
        try {
            const raw = localStorage.getItem(key);
            const arr = raw ? JSON.parse(raw) : [];
            return Array.isArray(arr) ? arr : [];
        } catch (error) {
            console.warn('[SyncMapping] Data rusak untuk ' + key, error);
            return [];
        }
    },

    setStore(key, arr) {
        try {
            localStorage.setItem(key, JSON.stringify(Array.isArray(arr) ? arr : []));
            return true;
        } catch (error) {
            console.error('[SyncMapping] Gagal menulis ' + key, error);
            return false;
        }
    }
};

// Ekspor ke global scope
window.SyncMapping = SyncMapping;