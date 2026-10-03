// ============================================================
// firestore-repo.js
// -----------------
// LAPISAN REPOSITORY TERPUSAT untuk Firebase Firestore.
//
// Tujuan: kode aplikasi (store/dashboard) TIDAK memanggil
// `FirebaseDB.collection(...)` langsung - semua lewat `window.FirestoreRepo`.
//
// RUANG LINGKUP TAHAP INI (hanya repository):
//   - Menyediakan API generik + helper per entitas.
//   - TIDAK mengubah UI, login, routing, QR, GPS, parking, PDF.
//   - TIDAK mengubah UserStore / AttendanceStore / ParkingTicketStore /
//     SchoolSettings / ActivityLog (belum dialihkan ke Firestore).
//   - TIDAK ada migrasi data & TIDAK ada penulisan otomatis ke Firestore.
//   - TIDAK memakai Firebase Auth / Firebase Storage / Security Rules.
//
// Collection yang dikenali (sesuai audit, tidak lebih):
//   users, subjects, attendance_sessions, attendance_records,
//   parking_tickets, parking_attendance, settings, activity_log
// Collection classes/teachers/students/majors/admin/sessions/records
// SENGAJA ditolak agar tidak tercipta tanpa instruksi.
//
// Bergantung pada (dimuat SEBELUM file ini):
//   CDN compat : firebase-app-compat.js, firebase-firestore-compat.js
//   js/firebase.js     -> window.FirebaseDB
//   js/sync-mapping.js -> window.SyncMapping (opsional; hanya untuk sanitizeId)
//
// Classic script (tanpa import/require), mengikuti pola project.
// Format data (ISO string, id USR-/SUB-/SESSION-/ATT-/PARK-/LOG-) TIDAK diubah.
// ============================================================

const FirestoreRepo = {
    // ===== Nama collection (hindari salah ketik di pemanggil) =====
    COLLECTIONS: {
        USERS: 'users',
        SUBJECTS: 'subjects',
        ATTENDANCE_SESSIONS: 'attendance_sessions',
        ATTENDANCE_RECORDS: 'attendance_records',
        PARKING_TICKETS: 'parking_tickets',
        PARKING_ATTENDANCE: 'parking_attendance',
        SETTINGS: 'settings',
        ACTIVITY_LOG: 'activity_log'
    },

    // Dokumen tunggal untuk pengaturan sekolah (bukan banyak dokumen)
    SETTINGS_DOC_ID: 'school',

    // Batas log aktivitas (sama dengan ActivityLog.MAX di attendance.js)
    ACTIVITY_LOG_MAX: 150,

    // Nilai resmi yang dikenal aplikasi (rujukan, BUKAN pembatas keras)
    ROLES: ['guru', 'siswa'],
    USER_STATUS: ['aktif', 'nonaktif'],
    SESSION_STATUS: ['aktif', 'ditutup', 'expired'],
    RECORD_STATUS: ['hadir', 'izin', 'sakit', 'alpa', 'tidak hadir', 'terlambat'],
    RECORD_METHODS: ['qr'],
    TICKET_STATUS: ['PARKIR', 'SUDAH KELUAR'],
    PARKING_ATTENDANCE_STATUS: ['Hadir'],
    SETTINGS_FIELDS: ['schoolName', 'schoolLat', 'schoolLng', 'parkingRadiusM', 'qrDurationDefault', 'jamMasuk'],

    // Error terakhir (untuk diagnosa dari console; tidak ditampilkan ke UI)
    lastError: null,

    // ===== Utilitas dasar =====

    /** True bila instance Firestore siap dipakai. */
    isReady() {
        return !!(window.FirebaseDB && typeof window.FirebaseDB.collection === 'function');
    },

    /** Instance Firestore atau null (tanpa melempar error). */
    _db() {
        if (!this.isReady()) {
            console.error('[FirestoreRepo] Firestore belum siap');
            return null;
        }
        return window.FirebaseDB;
    },

    /** Nama collection harus salah satu yang resmi (cegah collection liar). */
    _isAllowedCollection(collectionName) {
        const self = this;
        const allowed = Object.keys(this.COLLECTIONS).map(function (key) { return self.COLLECTIONS[key]; });
        return allowed.indexOf(String(collectionName)) !== -1;
    },

    /** Firestore doc ID tidak boleh mengandung '/'; pakai SyncMapping bila ada. */
    sanitizeId(id) {
        if (window.SyncMapping && typeof window.SyncMapping.sanitizeId === 'function') {
            return window.SyncMapping.sanitizeId(id);
        }
        let s = String(id == null ? '' : id).trim().replace(/[/\\#]/g, '_');
        if (!s) s = 'doc-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
        return s;
    },

    /** Waktu ISO sekarang (format yang dipakai aplikasi saat ini). */
    nowIso() {
        return new Date().toISOString();
    },

    /** Snapshot -> boolean (kompatibel antar versi compat SDK). */
    _snapExists(snap) {
        if (!snap) return false;
        return (typeof snap.exists === 'function') ? !!snap.exists() : !!snap.exists;
    },

    /** Catat error ke console (tidak pernah ditampilkan ke UI). */
    _fail(message, error) {
        this.lastError = { message: message, error: error };
        console.error('[FirestoreRepo] ' + message,
            (error && (error.code ? error.code + ' - ' : '') + (error.message || error)) || error);
        return null;
    },

    _ok(extra) {
        this.lastError = null;
        return Object.assign({ success: true }, extra || {});
    },

    _err(message, error) {
        this.lastError = { message: message, error: error };
        console.error('[FirestoreRepo] ' + message, (error && (error.message || error)) || error);
        return { success: false, error: (error && (error.code || error.message)) || message };
    },

    /**
     * Sanitasi nilai agar aman disimpan ke Firestore:
     * undefined -> null, Date -> ISO string, fungsi dibuang, objek/array rekursif.
     * TIDAK menambah field apa pun (format data aplikasi tetap sama).
     */
    _toDocData(value) {
        const self = this;
        if (value === undefined) return null;
        if (value === null) return null;
        if (value instanceof Date) return value.toISOString();
        if (Array.isArray(value)) return value.map(function (item) { return self._toDocData(item); });
        if (typeof value === 'function') return undefined;
        if (typeof value === 'object') {
            const out = {};
            Object.keys(value).forEach(function (key) {
                const v = self._toDocData(value[key]);
                if (v !== undefined) out[key] = v;
            });
            return out;
        }
        return value;
    },

    /**
     * Dokumen Firestore -> objek aplikasi: pastikan `id` ada.
     * Metadata sinkron (`syncedAt`) dibuang bila ada (memakai SyncMapping.fromDoc).
     */
    _fromDoc(doc) {
        const data = (doc && typeof doc.data === 'function') ? (doc.data() || {}) : {};
        if (window.SyncMapping && typeof window.SyncMapping.fromDoc === 'function') {
            return window.SyncMapping.fromDoc(doc.id, data);
        }
        const out = Object.assign({}, data);
        delete out.syncedAt;
        out.id = doc.id;
        return out;
    },

    // ===== Generator ID (mempertahankan format lama) =====
    _pad(n, len) { return String(n).padStart(len, '0'); },

    /** USR-XXX —— mengikuti UserStore.generateUserId (auth.js). */
    generateUserId(existingUsers) {
        let max = 0;
        (existingUsers || []).forEach(function (u) {
            const m = String((u && u.id) || '').match(/USR-(\d+)/);
            if (m) max = Math.max(max, parseInt(m[1], 10));
        });
        return 'USR-' + this._pad(max + 1, 3);
    },

    /** SUB-XXX —— hanya untuk mapel baru; ID lama tidak diubah. */
    generateSubjectId(existingSubjects) {
        let max = 0;
        (existingSubjects || []).forEach(function (s) {
            const m = String((s && s.id) || '').match(/SUB-(\d+)/);
            if (m) max = Math.max(max, parseInt(m[1], 10));
        });
        return 'SUB-' + this._pad(max + 1, 3);
    },

    /** SESSION-YYYYMMDD-NNN —— mengikuti AttendanceStore.generateSessionId. */
    generateSessionId(existingSessions, date) {
        const d = (date instanceof Date) ? date : new Date();
        const ymd = d.getFullYear() + this._pad(d.getMonth() + 1, 2) + this._pad(d.getDate(), 2);
        const prefix = 'SESSION-' + ymd + '-';
        let max = 0;
        (existingSessions || []).forEach(function (s) {
            const m = String((s && s.id) || '').match(new RegExp('^' + prefix + '(\\d+)$'));
            if (m) max = Math.max(max, parseInt(m[1], 10));
        });
        return prefix + this._pad(max + 1, 3);
    },

    /** ATT-<timestamp>-<acak> —— mengikuti AttendanceStore.addRecord. */
    generateRecordId() {
        return 'ATT-' + Date.now() + '-' + Math.floor(Math.random() * 999);
    },

    /** PARK-XXXXXXXX —— mengikuti ParkingTicketStore.generateTicketId. */
    generateTicketId() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ123456789';
        let id = '';
        for (let i = 0; i < 8; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
        return 'PARK-' + id;
    },

    /** LOG-<timestamp>-<acak> —— mengikuti ActivityLog.log. */
    generateLogId() {
        return 'LOG-' + Date.now() + '-' + Math.floor(Math.random() * 900 + 100);
    },

    // ============================================================
    // CRUD GENERIK
    // Semua method: TIDAK melempar error ke pemanggil (aman untuk UI).
    //   baca  -> objek|null / array
    //   tulis -> { success, ... } | { success:false, error }
    // ============================================================

    /** Ambil 1 dokumen: FirestoreRepo.get('users', 'USR-001') */
    async get(collectionName, id) {
        if (!this._isAllowedCollection(collectionName)) {
            return this._fail('Collection tidak dikenal/dilarang: ' + collectionName);
        }
        const db = this._db();
        if (!db) return null;
        if (id === undefined || id === null || String(id).trim() === '') {
            return this._fail('ID dokumen kosong pada ' + collectionName);
        }
        const docId = this.sanitizeId(id);
        try {
            const snap = await db.collection(collectionName).doc(docId).get();
            return this._snapExists(snap) ? this._fromDoc(snap) : null;
        } catch (error) {
            return this._fail('Gagal membaca collection ' + collectionName + '/' + docId, error);
        }
    },

    /** Ambil seluruh dokumen collection -> array (kosong bila gagal). */
    async getAll(collectionName) {
        if (!this._isAllowedCollection(collectionName)) {
            this._fail('Collection tidak dikenal/dilarang: ' + collectionName);
            return [];
        }
        const db = this._db();
        if (!db) return [];
        try {
            const snap = await db.collection(collectionName).get();
            const self = this;
            const rows = [];
            snap.forEach(function (doc) { rows.push(self._fromDoc(doc)); });
            return rows;
        } catch (error) {
            this._fail('Gagal membaca collection ' + collectionName, error);
            return [];
        }
    },

    /**
     * Query sederhana (dipakai helper di bawah; tidak wajib untuk UI).
     * options: { where: [[field, op, value], ...], orderBy: [[field,'desc'], ...], limit: number }
     * Mengembalikan array (kosong bila gagal / index belum tersedia).
     */
    async query(collectionName, options) {
        if (!this._isAllowedCollection(collectionName)) {
            this._fail('Collection tidak dikenal/dilarang: ' + collectionName);
            return [];
        }
        const db = this._db();
        if (!db) return [];
        const opt = options || {};
        try {
            const self = this;
            let ref = db.collection(collectionName);
            (opt.where || []).forEach(function (w) { ref = ref.where(w[0], w[1], w[2]); });
            if (opt.orderBy) {
                const list = Array.isArray(opt.orderBy[0]) ? opt.orderBy : [opt.orderBy];
                list.forEach(function (o) { ref = ref.orderBy(o[0], o[1] || 'asc'); });
            }
            if (opt.limit) ref = ref.limit(opt.limit);
            const snap = await ref.get();
            const rows = [];
            snap.forEach(function (doc) { rows.push(self._fromDoc(doc)); });
            return rows;
        } catch (error) {
            this._fail('Gagal query collection ' + collectionName, error);
            return [];
        }
    },

    /** Tulis dokumen dengan ID tertentu (menimpa dokumen yang sama). */
    async set(collectionName, id, data) {
        if (!this._isAllowedCollection(collectionName)) {
            return this._err('Collection tidak dikenal/dilarang: ' + collectionName);
        }
        const db = this._db();
        if (!db) return this._err('Firestore belum siap');
        if (id === undefined || id === null || String(id).trim() === '') {
            return this._err('ID dokumen kosong pada ' + collectionName);
        }
        const docId = this.sanitizeId(id);
        try {
            const payload = this._toDocData(data || {});
            await db.collection(collectionName).doc(docId).set(payload);
            return this._ok({ collection: collectionName, id: docId, data: payload });
        } catch (error) {
            return this._err('Gagal menulis document ' + collectionName + '/' + docId, error);
        }
    },

    /** Tambah dokumen baru: ID dari parameter, atau auto-ID Firestore bila kosong. */
    async add(collectionName, data, id) {
        if (!this._isAllowedCollection(collectionName)) {
            return this._err('Collection tidak dikenal/dilarang: ' + collectionName);
        }
        const db = this._db();
        if (!db) return this._err('Firestore belum siap');
        if (id !== undefined && id !== null && String(id).trim() !== '') {
            return this.set(collectionName, id, data);
        }
        try {
            const payload = this._toDocData(data || {});
            const ref = await db.collection(collectionName).add(payload);
            return this._ok({ collection: collectionName, id: ref.id, data: payload });
        } catch (error) {
            return this._err('Gagal menulis document baru di ' + collectionName, error);
        }
    },

    /** Ubah sebagian field dokumen (field lain tidak disentuh). */
    async update(collectionName, id, data) {
        if (!this._isAllowedCollection(collectionName)) {
            return this._err('Collection tidak dikenal/dilarang: ' + collectionName);
        }
        const db = this._db();
        if (!db) return this._err('Firestore belum siap');
        if (id === undefined || id === null || String(id).trim() === '') {
            return this._err('ID dokumen kosong pada ' + collectionName);
        }
        const docId = this.sanitizeId(id);
        try {
            const payload = this._toDocData(data || {});
            await db.collection(collectionName).doc(docId).update(payload);
            return this._ok({ collection: collectionName, id: docId, data: payload });
        } catch (error) {
            return this._err('Gagal memperbarui document ' + collectionName + '/' + docId, error);
        }
    },

    /** Hapus dokumen. */
    async remove(collectionName, id) {
        if (!this._isAllowedCollection(collectionName)) {
            return this._err('Collection tidak dikenal/dilarang: ' + collectionName);
        }
        const db = this._db();
        if (!db) return this._err('Firestore belum siap');
        if (id === undefined || id === null || String(id).trim() === '') {
            return this._err('ID dokumen kosong pada ' + collectionName);
        }
        const docId = this.sanitizeId(id);
        try {
            await db.collection(collectionName).doc(docId).delete();
            return this._ok({ collection: collectionName, id: docId });
        } catch (error) {
            return this._err('Gagal menghapus document ' + collectionName + '/' + docId, error);
        }
    },

    // ============================================================
    // ENTITAS: users  (users/{userId}, id = USR-XXX)
    // Struktur: id, role(guru|siswa), nama, nis, kelas, jurusan,
    //           subjectIds[], status(aktif|nonaktif), createdAt, updatedAt
    // Field bantu login: namaLower, nisUpper.
    // TIDAK menyimpan password (autentikasi tetap Supabase Auth/localStorage).
    // ============================================================

    /** Field turunan untuk pencarian (login guru/siswa memakai Nama + NIS). */
    userSearchFields(user) {
        return {
            namaLower: String((user && user.nama) || '').trim().toLowerCase(),
            nisUpper: String((user && user.nis) || '').trim().toUpperCase()
        };
    },

    /** subjectIds -> array string unik (mengikuti UserStore._normalizeSubjectIds). */
    _normalizeSubjectIds(raw) {
        if (Array.isArray(raw)) {
            return raw.map(function (s) { return String(s).trim(); }).filter(Boolean);
        }
        if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
        return [];
    },

    /**
     * Normalisasi user sesuai struktur aplikasi:
     * role hanya guru|siswa, status hanya aktif|nonaktif, kelas/jurusan hanya
     * untuk siswa, subjectIds hanya untuk guru, TANPA field password.
     */
    normalizeUser(data) {
        const src = data || {};
        const role = String(src.role || '').toLowerCase() === 'guru' ? 'guru' : 'siswa';
        const isSiswa = role === 'siswa';
        const user = {
            role: role,
            nama: String(src.nama || '').trim(),
            nis: String(src.nis || '').trim().toUpperCase(),
            kelas: isSiswa ? (String(src.kelas || '').trim() || null) : null,
            jurusan: isSiswa ? (String(src.jurusan || '').trim() || null) : null,
            subjectIds: isSiswa ? [] : this._normalizeSubjectIds(src.subjectIds),
            status: String(src.status || '').toLowerCase() === 'nonaktif' ? 'nonaktif' : 'aktif'
        };
        if (src.id) user.id = src.id;
        if (src.createdAt) user.createdAt = src.createdAt;
        if (src.updatedAt) user.updatedAt = src.updatedAt;
        return Object.assign(user, this.userSearchFields(user));
    },

    /** Semua pengguna (guru + siswa). */
    async getUsers() {
        return this.getAll(this.COLLECTIONS.USERS);
    },

    /** Satu pengguna berdasarkan ID (mis. 'USR-001'). */
    async getUser(id) {
        return this.get(this.COLLECTIONS.USERS, id);
    },

    /** Pengguna menurut role ('guru' | 'siswa'). */
    async getUsersByRole(role) {
        const wanted = String(role || '').toLowerCase();
        const rows = await this.query(this.COLLECTIONS.USERS, { where: [['role', '==', wanted]] });
        if (rows.length) return rows;
        // Fallback bila index/query belum siap: saring di sisi klien.
        const all = await this.getUsers();
        return all.filter(function (u) { return String(u.role || '').toLowerCase() === wanted; });
    },

    /**
     * Cari pengguna untuk login (Nama + NIS/NIP, tidak case-sensitive).
     * 1) coba field turunan namaLower + nisUpper (butuh index komposit),
     * 2) fallback: nisUpper saja,
     * 3) fallback terakhir: baca semua lalu cocokkan (aman untuk dokumen lama).
     */
    async findByCredentials(nama, nis) {
        const namaLower = String(nama || '').trim().toLowerCase();
        const nisUpper = String(nis || '').trim().toUpperCase();
        if (!namaLower || !nisUpper) return null;

        let rows = await this.query(this.COLLECTIONS.USERS, {
            where: [['namaLower', '==', namaLower], ['nisUpper', '==', nisUpper]], limit: 1
        });
        if (rows.length) return rows[0];

        rows = await this.query(this.COLLECTIONS.USERS, { where: [['nisUpper', '==', nisUpper]], limit: 1 });
        const byNis = rows.find(function (u) {
            return String(u.nama || '').trim().toLowerCase() === namaLower;
        });
        if (byNis) return byNis;

        const all = await this.getUsers();
        return all.find(function (u) {
            return String(u.nama || '').trim().toLowerCase() === namaLower &&
                String(u.nis || '').trim().toUpperCase() === nisUpper;
        }) || null;
    },

    /**
     * Tambah pengguna (validasi sama dengan UserStore.addUser).
     * ID memakai format lama USR-XXX dan datanya TANPA password.
     */
    async addUser(data) {
        const src = data || {};
        const nama = String(src.nama || '').trim();
        const nis = String(src.nis || '').trim().toUpperCase();
        const role = String(src.role || '').toLowerCase() === 'guru' ? 'guru' : 'siswa';
        if (!nama) return { success: false, error: 'Nama lengkap wajib diisi.' };
        if (!nis) return { success: false, error: 'NIS/NIP wajib diisi.' };
        if (role === 'siswa') {
            if (!String(src.kelas || '').trim()) return { success: false, error: 'Kelas wajib dipilih.' };
            if (!String(src.jurusan || '').trim()) return { success: false, error: 'Jurusan wajib dipilih.' };
        } else if (this._normalizeSubjectIds(src.subjectIds).length === 0) {
            return { success: false, error: 'Pilih minimal satu mata pelajaran yang diajar.' };
        }

        const users = await this.getUsers();
        const duplicate = users.some(function (u) {
            return String(u.nis || '').trim().toUpperCase() === nis;
        });
        if (duplicate) return { success: false, error: 'NIS/NIP tersebut sudah terdaftar.' };

        const id = String(src.id || this.generateUserId(users));
        const payload = Object.assign(this.normalizeUser(src), {
            id: id,
            createdAt: src.createdAt || this.nowIso()
        });
        const res = await this.set(this.COLLECTIONS.USERS, id, payload);
        if (!res.success) return res;
        return { success: true, id: id, user: payload };
    },

    /** Ubah pengguna (ID & createdAt tetap; menambah updatedAt). */
    async updateUser(id, data) {
        const src = data || {};
        const existing = await this.getUser(id);
        if (!existing) return { success: false, error: 'Pengguna tidak ditemukan.' };

        const nama = String(src.nama !== undefined ? src.nama : existing.nama).trim();
        const nis = String(src.nis !== undefined ? src.nis : existing.nis).trim().toUpperCase();
        const role = String(src.role !== undefined ? src.role : existing.role).toLowerCase() === 'guru' ? 'guru' : 'siswa';
        if (!nama) return { success: false, error: 'Nama lengkap wajib diisi.' };
        if (!nis) return { success: false, error: 'NIS/NIP wajib diisi.' };

        let kelas = null;
        let jurusan = null;
        let subjectIds = [];
        if (role === 'siswa') {
            kelas = String(src.kelas !== undefined ? src.kelas : existing.kelas).trim();
            jurusan = String(src.jurusan !== undefined ? src.jurusan : existing.jurusan).trim();
            if (!kelas) return { success: false, error: 'Kelas wajib dipilih.' };
            if (!jurusan) return { success: false, error: 'Jurusan wajib dipilih.' };
        } else {
            subjectIds = this._normalizeSubjectIds(
                src.subjectIds !== undefined ? src.subjectIds : existing.subjectIds
            );
            if (subjectIds.length === 0) return { success: false, error: 'Pilih minimal satu mata pelajaran yang diajar.' };
        }

        const users = await this.getUsers();
        const duplicate = users.some(function (u) {
            return String(u.id) !== String(id) && String(u.nis || '').trim().toUpperCase() === nis;
        });
        if (duplicate) return { success: false, error: 'NIS/NIP tersebut sudah terdaftar.' };

        const merged = this.normalizeUser(Object.assign({}, existing, {
            role: role, nama: nama, nis: nis, kelas: kelas, jurusan: jurusan,
            subjectIds: subjectIds, status: src.status || existing.status
        }));
        merged.id = existing.id || id;
        merged.createdAt = existing.createdAt || this.nowIso();
        merged.updatedAt = this.nowIso();

        const res = await this.set(this.COLLECTIONS.USERS, merged.id, merged);
        if (!res.success) return res;
        return { success: true, id: merged.id, user: merged };
    },

    /** Hapus pengguna. */
    async removeUser(id) {
        const res = await this.remove(this.COLLECTIONS.USERS, id);
        if (!res.success) return res;
        return { success: true, id: this.sanitizeId(id) };
    },

    // ============================================================
    // ENTITAS: subjects  (subjects/{subjectId}, id = SUB-XXX)
    // Struktur: id, nama  (ID lama tidak diubah)
    // ============================================================

    async getSubjects() {
        return this.getAll(this.COLLECTIONS.SUBJECTS);
    },

    async getSubject(id) {
        return this.get(this.COLLECTIONS.SUBJECTS, id);
    },

    /** Tambah mapel; ID memakai format SUB-XXX (bukan random). */
    async addSubject(data) {
        const src = data || {};
        const nama = String(src.nama || '').trim();
        if (!nama) return { success: false, error: 'Nama mata pelajaran wajib diisi.' };
        const id = String(src.id || this.generateSubjectId(await this.getSubjects()));
        const payload = { id: id, nama: nama };
        const res = await this.set(this.COLLECTIONS.SUBJECTS, id, payload);
        if (!res.success) return res;
        return { success: true, id: id, subject: payload };
    },

    /** Ubah nama mapel (ID tetap). */
    async updateSubject(id, data) {
        const src = data || {};
        const existing = await this.getSubject(id);
        if (!existing) return { success: false, error: 'Mata pelajaran tidak ditemukan.' };
        const nama = String(src.nama !== undefined ? src.nama : existing.nama).trim();
        if (!nama) return { success: false, error: 'Nama mata pelajaran wajib diisi.' };
        const payload = { id: existing.id || id, nama: nama };
        const res = await this.set(this.COLLECTIONS.SUBJECTS, payload.id, payload);
        if (!res.success) return res;
        return { success: true, id: payload.id, subject: payload };
    },

    /** Hapus mapel. */
    async removeSubject(id) {
        const res = await this.remove(this.COLLECTIONS.SUBJECTS, id);
        if (!res.success) return res;
        return { success: true, id: this.sanitizeId(id) };
    },

    // ============================================================
    // ENTITAS: attendance_sessions
    // (attendance_sessions/{sessionId}, id = SESSION-YYYYMMDD-NNN)
    // Status: aktif | ditutup | expired
    // ============================================================

    async getSessions() {
        return this.getAll(this.COLLECTIONS.ATTENDANCE_SESSIONS);
    },

    async getSession(id) {
        return this.get(this.COLLECTIONS.ATTENDANCE_SESSIONS, id);
    },

    /** Sesi milik satu guru (urut terbaru di atas, sama seperti aplikasi). */
    async getSessionsByGuru(guruId) {
        const gid = String(guruId || '').trim();
        if (!gid) return [];
        let rows = await this.query(this.COLLECTIONS.ATTENDANCE_SESSIONS, {
            where: [['guruId', '==', gid]], orderBy: [['createdAt', 'desc']]
        });
        if (rows.length) return rows;
        rows = (await this.getSessions()).filter(function (s) { return String(s.guruId || '') === gid; });
        return rows.sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); });
    },

    /** Sesi berstatus 'aktif' (untuk panel admin / validasi QR). */
    async getActiveSessions() {
        let rows = await this.query(this.COLLECTIONS.ATTENDANCE_SESSIONS, { where: [['status', '==', 'aktif']] });
        if (rows.length) return rows;
        return (await this.getSessions()).filter(function (s) { return s.status === 'aktif'; });
    },

    /**
     * Buat sesi presensi baru (format & validasi sama dengan
     * AttendanceStore.createSession; ID SESSION-YYYYMMDD-NNN).
     */
    async createSession(data) {
        const src = data || {};
        const guruId = String(src.guruId || '').trim();
        const kelas = String(src.kelas || '').trim().toUpperCase();
        const jurusan = String(src.jurusan || '').trim().toUpperCase();
        const mataPelajaran = String(src.mataPelajaran || '').trim();
        const tanggal = src.tanggal || null;
        if (!guruId || !kelas || !jurusan || !mataPelajaran || !tanggal) {
            return { success: false, error: 'Data sesi tidak lengkap.' };
        }

        const sessions = await this.getSessions();
        const id = String(src.id || this.generateSessionId(sessions));
        const sekarang = new Date();
        const durasi = parseInt(src.durasiMenit, 10) || 10;
        const createdAt = src.createdAt || sekarang.toISOString();
        const jamMulai = src.jamMulai || (sekarang.getHours() + ':' + String(sekarang.getMinutes()).padStart(2, '0'));
        const payload = {
            id: id,
            guruId: guruId,
            guruNama: src.guruNama || null,
            kelas: kelas,
            jurusan: jurusan,
            mataPelajaran: mataPelajaran,
            tanggal: tanggal,
            jamMulai: jamMulai,
            durasiMenit: durasi,
            status: 'aktif',
            createdAt: createdAt,
            expiresAt: src.expiresAt || new Date(sekarang.getTime() + durasi * 60000).toISOString()
        };
        const res = await this.set(this.COLLECTIONS.ATTENDANCE_SESSIONS, id, payload);
        if (!res.success) return res;
        return { success: true, id: id, session: payload };
    },

    /** Ubah status sesi: aktif | ditutup | expired. */
    async setSessionStatus(id, status) {
        const wanted = String(status || '').trim().toLowerCase();
        if (this.SESSION_STATUS.indexOf(wanted) === -1) {
            return { success: false, error: 'Status sesi tidak dikenal: ' + status };
        }
        const res = await this.update(this.COLLECTIONS.ATTENDANCE_SESSIONS, id, { status: wanted });
        if (!res.success) return res;
        return { success: true, id: this.sanitizeId(id), status: wanted };
    },

    /** Tutup sesi (status -> 'ditutup'). */
    async closeSession(id) {
        return this.setSessionStatus(id, 'ditutup');
    },

    // ============================================================
    // ENTITAS: attendance_records
    // (attendance_records/{recordId}, id = ATT-<timestamp>-<acak>)
    // status: hadir | izin | sakit | alpa | tidak hadir | terlambat
    //         (repository TIDAK membatasi hanya 'hadir')
    // method: qr
    // Aturan lama: 1 siswa hanya boleh presensi 1x per sesi.
    // ============================================================

    async getAttendanceRecords() {
        return this.getAll(this.COLLECTIONS.ATTENDANCE_RECORDS);
    },

    async getAttendanceRecord(id) {
        return this.get(this.COLLECTIONS.ATTENDANCE_RECORDS, id);
    },

    /** Presensi pada satu sesi. */
    async getRecordsBySession(sessionId) {
        const sid = String(sessionId || '').trim();
        if (!sid) return [];
        let rows = await this.query(this.COLLECTIONS.ATTENDANCE_RECORDS, { where: [['sessionId', '==', sid]] });
        if (rows.length) return rows;
        return (await this.getAttendanceRecords()).filter(function (r) { return String(r.sessionId || '') === sid; });
    },

    /** Presensi milik satu siswa. */
    async getRecordsByStudent(studentId) {
        const stid = String(studentId || '').trim();
        if (!stid) return [];
        let rows = await this.query(this.COLLECTIONS.ATTENDANCE_RECORDS, { where: [['studentId', '==', stid]] });
        if (rows.length) return rows;
        return (await this.getAttendanceRecords()).filter(function (r) { return String(r.studentId || '') === stid; });
    },

    /**
     * Helper pengganti AttendanceStore.isDuplicate() di tahap berikutnya:
     * mengembalikan record bila siswa sudah presensi pada sesi tersebut.
     */
    async findAttendanceBySessionAndStudent(sessionId, studentId) {
        const sid = String(sessionId || '').trim();
        const stid = String(studentId || '').trim();
        if (!sid || !stid) return null;
        const rows = await this.query(this.COLLECTIONS.ATTENDANCE_RECORDS, {
            where: [['sessionId', '==', sid], ['studentId', '==', stid]], limit: 1
        });
        if (rows.length) return rows[0];
        const all = await this.getAttendanceRecords();
        return all.find(function (r) {
            return String(r.sessionId || '') === sid && String(r.studentId || '') === stid;
        }) || null;
    },

    /**
     * Tambah record presensi.
     * options.allowDuplicate = true bila pemanggil ingin melewati pemeriksaan
     * duplikat (default false = mengikuti aturan lama aplikasi).
     */
    async addAttendanceRecord(data, options) {
        const src = data || {};
        const opt = options || {};
        const sessionId = String(src.sessionId || '').trim();
        const studentId = String(src.studentId || '').trim();
        if (!sessionId) return { success: false, error: 'Session ID wajib diisi.' };
        if (!studentId) return { success: false, error: 'Student ID wajib diisi.' };

        if (!opt.allowDuplicate) {
            const duplicate = await this.findAttendanceBySessionAndStudent(sessionId, studentId);
            if (duplicate) {
                return { success: false, duplicated: true, error: 'Anda sudah melakukan presensi untuk sesi ini.' };
            }
        }

        // status tidak dibatasi ke 'hadir' (izin/sakit/alpa/tidak hadir/terlambat siap dipakai)
        const status = String(src.status || 'hadir').trim() || 'hadir';
        const payload = {
            id: String(src.id || this.generateRecordId()),
            sessionId: sessionId,
            studentId: studentId,
            studentNama: src.studentNama || null,
            nis: src.nis || null,
            kelas: src.kelas || null,
            jurusan: src.jurusan || null,
            mataPelajaran: src.mataPelajaran || null,
            guruId: src.guruId || null,
            guruNama: src.guruNama || null,
            waktuScan: src.waktuScan || this.nowIso(),
            status: status,
            method: String(src.method || 'qr').trim() || 'qr'
        };
        const res = await this.set(this.COLLECTIONS.ATTENDANCE_RECORDS, payload.id, payload);
        if (!res.success) return res;
        return { success: true, id: payload.id, record: payload };
    },

    // ============================================================
    // ENTITAS: parking_tickets
    // (parking_tickets/{ticketId}, id = PARK-XXXXXXXX)
    // status: PARKIR | SUDAH KELUAR
    // Aturan lama: 1 siswa maksimal punya 1 karcis berstatus PARKIR.
    // ============================================================

    /** Normalisasi plat (huruf besar, spasi dirapikan) — sama seperti aplikasi. */
    normalizePlat(plat) {
        return String(plat || '').trim().toUpperCase().replace(/\s+/g, ' ');
    },

    /** Validasi plat sederhana: minimal 3 karakter, huruf/angka/spasi/dash. */
    isValidPlat(plat) {
        const p = this.normalizePlat(plat);
        return p.length >= 3 && /^[A-Z0-9 \-]+$/.test(p);
    },

    async getParkingTickets() {
        return this.getAll(this.COLLECTIONS.PARKING_TICKETS);
    },

    async getParkingTicket(id) {
        return this.get(this.COLLECTIONS.PARKING_TICKETS, id);
    },

    /** Karcis milik satu siswa. */
    async getTicketsByStudent(studentId) {
        const stid = String(studentId || '').trim();
        if (!stid) return [];
        let rows = await this.query(this.COLLECTIONS.PARKING_TICKETS, { where: [['studentId', '==', stid]] });
        if (rows.length) return rows;
        return (await this.getParkingTickets()).filter(function (t) { return String(t.studentId || '') === stid; });
    },

    /** Karcis aktif (status PARKIR) milik siswa — maksimal satu. */
    async findActiveTicketByStudent(studentId) {
        const stid = String(studentId || '').trim();
        if (!stid) return null;
        const rows = await this.query(this.COLLECTIONS.PARKING_TICKETS, {
            where: [['studentId', '==', stid], ['status', '==', 'PARKIR']], limit: 1
        });
        if (rows.length) return rows[0];
        const all = await this.getParkingTickets();
        return all.find(function (t) {
            return String(t.studentId || '') === stid && t.status === 'PARKIR';
        }) || null;
    },

    /** Kendaraan masuk: buat karcis baru (ID PARK-XXXXXXXX). */
    async createTicket(data) {
        const src = data || {};
        const studentId = String(src.studentId || '').trim();
        if (!studentId) return { success: false, error: 'Student ID wajib diisi.' };

        const plat = this.normalizePlat(src.plat);
        if (!this.isValidPlat(plat)) return { success: false, error: 'Plat nomor tidak valid.' };

        const active = await this.findActiveTicketByStudent(studentId);
        if (active) {
            return { success: false, error: 'Kendaraan Anda sudah terdaftar sedang parkir (' + active.plat + ').' };
        }

        const now = this.nowIso();
        const payload = {
            id: String(src.id || this.generateTicketId()),
            studentId: studentId,
            studentNama: src.studentNama || src.nama || null,
            nis: src.nis || null,
            plat: plat,
            waktuMasuk: src.waktuMasuk || now,
            waktuKeluar: null,
            status: 'PARKIR',
            createdAt: src.createdAt || now
        };
        const res = await this.set(this.COLLECTIONS.PARKING_TICKETS, payload.id, payload);
        if (!res.success) return res;
        return { success: true, id: payload.id, ticket: payload };
    },

    /** Kendaraan keluar: status -> 'SUDAH KELUAR' + waktuKeluar. */
    async closeTicket(id, waktuKeluar) {
        const res = await this.update(this.COLLECTIONS.PARKING_TICKETS, id, {
            status: 'SUDAH KELUAR',
            waktuKeluar: waktuKeluar || this.nowIso()
        });
        if (!res.success) return res;
        return { success: true, id: this.sanitizeId(id), status: 'SUDAH KELUAR' };
    },

    // ============================================================
    // ENTITAS: parking_attendance  (parking_attendance/{autoId})
    // Field: userId, nama, lat, lng, jarakM, status, timestamp
    // (dokumen lama tidak punya field `id` -> doc ID dibuat otomatis oleh
    //  Firestore; saat dibaca, repository tetap menyertakan `id` = doc ID)
    // CATATAN: algoritma GPS, koordinat sekolah, dan radius TIDAK diubah.
    // ============================================================

    /**
     * Riwayat presensi parkir (opsional per userId, opsional dibatasi).
     * Diurutkan timestamp terbaru di atas.
     */
    async getParkingAttendance(userId, limit) {
        const uid = String(userId || '').trim();
        let rows = uid
            ? await this.query(this.COLLECTIONS.PARKING_ATTENDANCE, {
                where: [['userId', '==', uid]], orderBy: [['timestamp', 'desc']]
            })
            : await this.query(this.COLLECTIONS.PARKING_ATTENDANCE, { orderBy: [['timestamp', 'desc']] });
        if (!rows.length) {
            rows = await this.getAll(this.COLLECTIONS.PARKING_ATTENDANCE);
            if (uid) rows = rows.filter(function (r) { return String(r.userId || '') === uid; });
            rows.sort(function (a, b) { return String(b.timestamp || '').localeCompare(String(a.timestamp || '')); });
        }
        const n = parseInt(limit, 10);
        return (n > 0) ? rows.slice(0, n) : rows;
    },

    /**
     * Catat presensi parkir (data GPS apa adanya; repository TIDAK menghitung
     * jarak/radius - itu tetap tugas dashboard-siswa.js + SchoolSettings).
     */
    async addParkingAttendance(data) {
        const src = data || {};
        const userId = String(src.userId || '').trim();
        if (!userId) return { success: false, error: 'User ID wajib diisi.' };
        const payload = {
            userId: userId,
            nama: src.nama || null,
            lat: (typeof src.lat === 'number') ? src.lat : null,
            lng: (typeof src.lng === 'number') ? src.lng : null,
            jarakM: (typeof src.jarakM === 'number') ? src.jarakM : null,
            status: String(src.status || 'Hadir').trim() || 'Hadir',
            timestamp: src.timestamp || this.nowIso()
        };
        const res = await this.add(this.COLLECTIONS.PARKING_ATTENDANCE, payload);
        if (!res.success) return res;
        return { success: true, id: res.id, parking: payload };
    },

    // ============================================================
    // ENTITAS: settings  (DOKUMEN TUNGGAL: settings/school)
    // Field: schoolName, schoolLat, schoolLng, parkingRadiusM,
    //        qrDurationDefault, jamMasuk
    // Repository TIDAK menyimpan nilai default - nilai default tetap milik
    // SchoolSettings (attendance.js) agar tidak ada duplikasi konstanta GPS.
    // ============================================================

    /** Baca dokumen pengaturan sekolah (null bila belum ada). */
    async getSettings() {
        const doc = await this.get(this.COLLECTIONS.SETTINGS, this.SETTINGS_DOC_ID);
        // Bentuk lama (SchoolSettings.get) TIDAK punya key `id` - buang agar
        // kembalian identik dengan mupa_settings di localStorage.
        if (doc && doc.id === this.SETTINGS_DOC_ID) delete doc.id;
        return doc;
    },

    /**
     * Simpan pengaturan sekolah (hanya field resmi; field asing diabaikan).
     * Bila dokumen sudah ada -> update (field lain dipertahankan),
     * bila belum ada -> dibuat dengan ID 'school'.
     */
    async saveSettings(data) {
        const src = data || {};
        const payload = {};
        this.SETTINGS_FIELDS.forEach(function (field) {
            if (src[field] !== undefined) payload[field] = src[field];
        });
        if (Object.keys(payload).length === 0) {
            return { success: false, error: 'Tidak ada field pengaturan yang dikirim.' };
        }
        const existing = await this.getSettings();
        const res = existing
            ? await this.update(this.COLLECTIONS.SETTINGS, this.SETTINGS_DOC_ID, payload)
            : await this.set(this.COLLECTIONS.SETTINGS, this.SETTINGS_DOC_ID, payload);
        if (!res.success) return res;
        return { success: true, id: this.SETTINGS_DOC_ID, settings: payload };
    },

    // ============================================================
    // ENTITAS: activity_log  (activity_log/{logId}, id = LOG-<ts>-<acak>)
    // Field: id, action, detail, actor, time   (urut time DESC, maks 150)
    // ============================================================

    /**
     * Tambah entri log aktivitas (format sama dengan ActivityLog.log di
     * attendance.js: action, detail, actor, time).
     */
    async addActivityLog(entry) {
        const src = entry || {};
        const action = String(src.action || 'aktivitas').trim() || 'aktivitas';
        const payload = {
            id: String(src.id || this.generateLogId()),
            action: action,
            detail: src.detail || '',
            actor: src.actor || '',
            time: src.time || this.nowIso()
        };
        const res = await this.set(this.COLLECTIONS.ACTIVITY_LOG, payload.id, payload);
        if (!res.success) return res;
        return { success: true, id: payload.id, log: payload };
    },

    /**
     * Ambil log aktivitas terbaru (default 150, time DESC).
     * Bila query orderBy 'time' gagal (mis. index belum tersedia), otomatis
     * memakai fallback baca-semua + urutkan di klien agar aplikasi tidak rusak.
     */
    async getActivityLogs(limit) {
        const parsed = parseInt(limit, 10);
        const max = (parsed > 0) ? parsed : this.ACTIVITY_LOG_MAX;
        let rows = await this.query(this.COLLECTIONS.ACTIVITY_LOG, {
            orderBy: [['time', 'desc']], limit: max
        });
        if (rows.length) return rows;
        const all = await this.getAll(this.COLLECTIONS.ACTIVITY_LOG);
        all.sort(function (a, b) { return String(b.time || '').localeCompare(String(a.time || '')); });
        return all.slice(0, max);
    }
};

// ============================================================
// Ekspor ke global scope (pola sama seperti SyncMapping / FirebaseService)
// ============================================================
window.FirestoreRepo = FirestoreRepo;

// Diagnostik console-only (tidak menyentuh UI, tidak menulis data)
console.log('[FirestoreRepo] Repository siap - Firestore ' +
    (FirestoreRepo.isReady() ? 'terhubung' : 'belum siap') +
    ' | collection: ' + Object.keys(FirestoreRepo.COLLECTIONS).map(function (key) {
        return FirestoreRepo.COLLECTIONS[key];
    }).join(', '));
