// ============================================================
// attendance.js
// -------------
// Data layer akademik & presensi QR berbasis localStorage.
// Menyimpan:
//   - mupa_subjects            : daftar mata pelajaran
//   - mupa_attendance_sessions : sesi presensi yang dibuat Guru
//   - mupa_attendance_records  : rekaman presensi siswa (scan QR)
//
// Sistem murni lokal (tanpa Firebase / tanpa token).
// ============================================================

const AttendanceStore = {
    SUBJECTS_KEY: 'mupa_subjects',
    SESSIONS_KEY: 'mupa_attendance_sessions',
    RECORDS_KEY: 'mupa_attendance_records',

    // Konstanta akademik (mudah diubah)
    KELAS_LIST: ['X', 'XI', 'XII'],
    JURUSAN_LIST: ['RPL', 'TKJ', 'DKV', 'AKL', 'MPLB', 'OTKP'],
    // Durasi QR presensi (menit)
    DURASI_OPTIONS: [5, 10, 15, 30],

    // Mata pelajaran default (dapat dikelola Admin nantinya)
    DEFAULT_SUBJECTS: [
        { id: 'SUB-001', nama: 'Pemrograman Web' },
        { id: 'SUB-002', nama: 'Basis Data' },
        { id: 'SUB-003', nama: 'Pemrograman Mobile' },
        { id: 'SUB-004', nama: 'Pemrograman Berorientasi Objek' },
        { id: 'SUB-005', nama: 'Jaringan Komputer' },
        { id: 'SUB-006', nama: 'Bahasa Indonesia' },
        { id: 'SUB-007', nama: 'Matematika' },
        { id: 'SUB-008', nama: 'Bahasa Inggris' }
    ],

    // ---- Safe get/set localStorage ----
    _read(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            const val = raw ? JSON.parse(raw) : fallback;
            return Array.isArray(val) ? val : fallback;
        } catch (error) {
            console.warn('[AttendanceStore] Data rusak untuk ' + key, error);
            return fallback;
        }
    },
    _write(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('[AttendanceStore] Gagal menulis ' + key, error);
            return false;
        }
    },

    // ---- Mata Pelajaran ----
    seedSubjectsIfEmpty() {
        if (localStorage.getItem(this.SUBJECTS_KEY) !== null) return;
        this._write(this.SUBJECTS_KEY, this.DEFAULT_SUBJECTS);
    },
    getSubjects() {
        this.seedSubjectsIfEmpty();
        return this._read(this.SUBJECTS_KEY, []);
    },

    // ---- Sesi Presensi ----
    getSessions() {
        return this._read(this.SESSIONS_KEY, []);
    },
    saveSessions(sessions) {
        return this._write(this.SESSIONS_KEY, sessions);
    },
    getRecords() {
        return this._read(this.RECORDS_KEY, []);
    },
    saveRecords(records) {
        return this._write(this.RECORDS_KEY, records);
    },

    // Generate ID sesi unik: SESSION-YYYYMMDD-XXX
    generateSessionId() {
        const d = new Date();
        const ymd = d.getFullYear() +
            String(d.getMonth() + 1).padStart(2, '0') +
            String(d.getDate()).padStart(2, '0');
        const sessions = this.getSessions();
        let max = 0;
        const prefix = 'SESSION-' + ymd + '-';
        sessions.forEach(s => {
            const m = String(s.id || '').match(new RegExp('^' + prefix + '(\\d+)$'));
            if (m) max = Math.max(max, parseInt(m[1], 10));
        });
        return prefix + String(max + 1).padStart(3, '0');
    },

    // Membuat sesi presensi baru
    createSession(data) {
        const { guruId, guruNama, kelas, jurusan, mataPelajaran, tanggal, jamMulai, durasiMenit } = data;
        if (!guruId || !kelas || !jurusan || !mataPelajaran || !tanggal) {
            return { success: false, error: 'Data sesi tidak lengkap.' };
        }
        const sekarang = new Date();
        const id = this.generateSessionId();
        const durasi = parseInt(durasiMenit, 10) || 10;
        const createdAt = sekarang.toISOString();
        const jamMulaiAkhir = jamMulai || sekarang.getHours() + ':' + String(sekarang.getMinutes()).padStart(2, '0');
        const session = {
            id: id,
            guruId: guruId,
            guruNama: guruNama,
            kelas: String(kelas || '').toUpperCase(),
            jurusan: String(jurusan || '').toUpperCase(),
            mataPelajaran: mataPelajaran,
            tanggal: tanggal || null,
            jamMulai: jamMulaiAkhir,
            durasiMenit: durasi,
            status: 'aktif',
            createdAt: createdAt,
            expiresAt: new Date(sekarang.getTime() + durasi * 60000).toISOString()
        };
        const sessions = this.getSessions();
        sessions.push(session);
        if (!this.saveSessions(sessions)) {
            return { success: false, error: 'Gagal menyimpan sesi ke localStorage.' };
        }
        return { success: true, session: session };
    },

    // Auto-tutup sesi yang sudah melewati masa aktif
    expireExpiredSessions() {
        const now = new Date().getTime();
        const sessions = this.getSessions();
        let changed = false;
        sessions.forEach(s => {
            if (s.status === 'aktif' && s.expiresAt && now > new Date(s.expiresAt).getTime()) {
                s.status = 'expired';
                changed = true;
            }
        });
        if (changed) this.saveSessions(sessions);
        return sessions;
    },

    getSessionById(id) {
        return this.getSessions().find(s => s.id === id) || null;
    },
    closeSession(id) {
        const sessions = this.getSessions();
        const s = sessions.find(x => x.id === id);
        if (!s) return { success: false, error: 'Sesi tidak ditemukan.' };
        s.status = 'ditutup';
        if (!this.saveSessions(sessions)) return { success: false, error: 'Gagal menyimpan.' };
        return { success: true };
    },
    getSessionsByGuru(guruId) {
        const sessions = this.getSessions().filter(s => s.guruId === guruId);
        // Urut: terbaru di atas
        return sessions.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    },

    // ---- Rekaman Presensi ----
    isDuplicate(sessionId, studentId) {
        return this.getRecords().some(r => r.sessionId === sessionId && r.studentId === studentId);
    },
    addRecord(session, student) {
        if (this.isDuplicate(session.id, student.id)) {
            return { success: false, duplicated: true, error: 'Anda sudah melakukan presensi untuk sesi ini.' };
        }
        const record = {
            id: 'ATT-' + Date.now() + '-' + Math.floor(Math.random() * 999),
            sessionId: session.id,
            mataPelajaran: session.mataPelajaran,
            guruId: session.guruId,
            guruNama: session.guruNama,
            kelas: session.kelas,
            jurusan: session.jurusan,
            studentId: student.id,
            studentNama: student.nama,
            nis: student.nis,
            waktuScan: new Date().toISOString(),
            status: 'hadir',
            method: 'qr'
        };
        const records = this.getRecords();
        records.push(record);
        if (!this.saveRecords(records)) {
            return { success: false, error: 'Gagal menyimpan presensi.' };
        }
        return { success: true, record: record };
    },
    getRecordsBySession(sessionId) {
        return this.getRecords().filter(r => r.sessionId === sessionId);
    },

    // ---- Siswa yang terdaftar untuk satu kelas+jurusan ----
    getStudentsForSession(session) {
        const store = window.UserStore;
        const users = store ? store.getUsers() : [];
        return users.filter(u =>
            u.role === 'siswa' &&
            (u.status === 'aktif' || !u.status) &&
            String(u.kelas || '').toUpperCase() === String(session.kelas || '').toUpperCase() &&
            String(u.jurusan || '').toUpperCase() === String(session.jurusan || '').toUpperCase()
        );
    },

    // ---- Statistik presensi ----
    computeStats(session) {
        const students = this.getStudentsForSession(session);
        const records = this.getRecordsBySession(session.id);
        const hadirIds = new Set(records.map(r => r.studentId));
        return {
            total: students.length,
            hadir: hadirIds.size,
            belum: Math.max(0, students.length - hadirIds.size)
        };
    },

    // ---- Payload QR ----
    // Format: JSON { type: "MUPA_ATTENDANCE", sessionId, timestamp }
    buildQRPayload(sessionId) {
        return { type: 'MUPA_ATTENDANCE', sessionId: sessionId, timestamp: Date.now() };
    },
    parseQRPayload(text) {
        try {
            const data = JSON.parse(text);
            return { success: true, data: data };
        } catch (error) {
            return { success: false, error: 'QR tidak valid.' };
        }
    },

    // ---- VALIDASI QR (langkah per langkah) ----
    // Kembalikan { valid: true, session } atau { valid:false, kode, message }
    validateQR(payload) {
        // Langkah 1: tipe QR
        if (!payload || payload.type !== 'MUPA_ATTENDANCE') {
            return { valid: false, kode: 'INVALID_FORMAT', message: 'QR tidak valid.' };
        }
        if (!payload.sessionId) {
            return { valid: false, kode: 'INVALID_FORMAT', message: 'QR tidak valid.' };
        }
        this.expireExpiredSessions();

        // Langkah 2: cari sesi
        const session = this.getSessionById(payload.sessionId);
        if (!session) {
            return { valid: false, kode: 'NOT_FOUND', message: 'QR tidak ditemukan.' };
        }
        // Langkah 3: status sesi
        if (session.status === 'ditutup') {
            return { valid: false, kode: 'CLOSED', message: 'Sesi presensi sudah tidak aktif.' };
        }
        if (session.status === 'expired') {
            return { valid: false, kode: 'EXPIRED', message: 'QR presensi sudah kadaluarsa.' };
        }
        // Langkah 4: masa aktif (expiresAt)
        if (session.expiresAt && new Date().getTime() > new Date(session.expiresAt).getTime()) {
            const sessions = this.getSessions();
            const s = sessions.find(x => x.id === session.id);
            if (s) s.status = 'expired';
            this.saveSessions(sessions);
            return { valid: false, kode: 'EXPIRED', message: 'QR presensi sudah kadaluarsa.' };
        }
        return { valid: true, session: session };
    },

    // ---- VALIDASI KELAS/JURUSAN SISWA ----
    validateStudentMatch(session, student) {
        if (!student || !student.kelas || !student.jurusan) {
            return { valid: false, message: 'Data kelas/jurusan Anda belum lengkap. Hubungi Admin.' };
        }
        const sk = String(student.kelas).toUpperCase();
        const sj = String(student.jurusan).toUpperCase();
        if (sk === String(session.kelas).toUpperCase() && sj === String(session.jurusan).toUpperCase()) {
            return { valid: true };
        }
        return {
            valid: false,
            message: 'QR Tidak Sesuai. Anda terdaftar di ' + sk + ' ' + sj +
                '. Sesi ini untuk ' + String(session.kelas).toUpperCase() + ' ' + String(session.jurusan).toUpperCase() + '.'
        };
    }
};

// Ekspor ke global scope
window.AttendanceStore = AttendanceStore;

// ============================================================
// ParkingTicketStore
// ------------------
// Karcis parkir digital (masuk / keluar kendaraan).
// Key: mupa_parking_tickets
// Status ticket: 'PARKIR' (sedang parkir) | 'SUDAH KELUAR'
// ============================================================

const ParkingTicketStore = {
    TICKETS_KEY: 'mupa_parking_tickets',

    _read() {
        try {
            const raw = localStorage.getItem(this.TICKETS_KEY);
            const val = raw ? JSON.parse(raw) : [];
            return Array.isArray(val) ? val : [];
        } catch (error) {
            console.warn('[ParkingTicket] Data karcis rusak, akan di-reset.');
            return [];
        }
    },
    _write(tickets) {
        try {
            localStorage.setItem(this.TICKETS_KEY, JSON.stringify(tickets));
            return true;
        } catch (error) {
            console.error('[ParkingTicket] Gagal menyimpan karcis:', error);
            return false;
        }
    },

    // ID unik: PARK-XXXXXXXX (8 karakter alfanumerik)
    generateTicketId() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ123456789';
        let id = '';
        for (let i = 0; i < 8; i++) {
            id += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return 'PARK-' + id;
    },

    normalizePlat(plat) {
        return String(plat || '').trim().toUpperCase().replace(/\s+/g, ' ');
    },

    // Validasi format plat sederhana: minimal 3 karakter, huruf/angka/spasi/dash
    isValidPlat(plat) {
        const p = this.normalizePlat(plat);
        return p.length >= 3 && /^[A-Z0-9 \-]+$/.test(p);
    },

    getTickets() {
        return this._read();
    },

    getTicketById(id) {
        return this._read().find(t => t.id === id) || null;
    },

    // Karcis milik siswa yang masih berstatus PARKIR
    getActiveTicketByStudent(studentId) {
        return this._read().find(t =>
            t.studentId === studentId && t.status === 'PARKIR'
        ) || null;
    },

    // KENDARAAN MASUK: buat karcis baru
    createTicket(data) {
        const plat = this.normalizePlat(data.plat);
        if (!this.isValidPlat(plat)) {
            return { success: false, error: 'Plat nomor tidak valid.' };
        }
        // Satu siswa hanya boleh punya satu kendaraan aktif di parkir
        const active = this.getActiveTicketByStudent(data.studentId);
        if (active) {
            return { success: false, error: 'Kendaraan Anda sudah terdaftar sedang parkir (' + active.plat + ').' };
        }
        const ticket = {
            id: this.generateTicketId(),
            studentId: data.studentId,
            studentNama: data.nama,
            nis: data.nis,
            plat: plat,
            waktuMasuk: new Date().toISOString(),
            waktuKeluar: null,
            status: 'PARKIR',
            createdAt: new Date().toISOString()
        };
        const tickets = this._read();
        tickets.push(ticket);
        if (!this._write(tickets)) {
            return { success: false, error: 'Gagal menyimpan karcis.' };
        }
        return { success: true, ticket: ticket };
    },

    // KENDARAAN KELUAR: validasi lalu catat waktu keluar
    processExit(ticketId, studentId) {
        const tickets = this._read();
        const idx = tickets.findIndex(t => t.id === ticketId);

        // Ticket ID tidak ditemukan
        if (idx === -1) {
            return { success: false, kode: 'NOT_FOUND', error: 'Tiket parkir tidak valid.' };
        }
        const t = tickets[idx];

        // Tiket milik user lain
        if (t.studentId !== studentId) {
            return { success: false, kode: 'NOT_OWNER', error: 'Tiket parkir tidak valid.' };
        }
        // Tiket sudah digunakan / kendaraan tidak sedang parkir
        if (t.status === 'SUDAH KELUAR') {
            return { success: false, kode: 'ALREADY_USED', error: 'Tiket sudah digunakan. Kendaraan sudah keluar.' };
        }
        if (t.status !== 'PARKIR') {
            return { success: false, kode: 'NOT_PARKED', error: 'Kendaraan tidak sedang parkir.' };
        }

        // Berhasil: catat waktu keluar & ubah status
        t.waktuKeluar = new Date().toISOString();
        t.status = 'SUDAH KELUAR';
        if (!this._write(tickets)) {
            return { success: false, error: 'Gagal menyimpan perubahan karcis.' };
        }
        return { success: true, ticket: t };
    },

    // Durasi: "X jam Y menit"
    getDurasiText(waktuMasuk, waktuKeluar) {
        const start = new Date(waktuMasuk);
        const end = waktuKeluar ? new Date(waktuKeluar) : new Date();
        if (isNaN(start.getTime())) return '-';
        let diffMs = Math.max(0, end.getTime() - start.getTime());
        const menit = Math.floor(diffMs / 60000);
        const jam = Math.floor(menit / 60);
        const sisaMenit = menit % 60;
        if (jam > 0) return jam + ' jam ' + sisaMenit + ' menit';
        return sisaMenit + ' menit';
    },

    getTicketsByStudent(studentId) {
        return this._read().filter(t => t.studentId === studentId);
    }
};

// Ekspor ke global scope
window.ParkingTicketStore = ParkingTicketStore;

// ============================================================
// SchoolSettings (mupa_settings)
// Konfigurasi sekolah: nama, koordinat, radius parkir, dll.
// Nilai default diambil dari nilai yang SUDAH ADA di project
// (koordinat & radius 100 m dari kode parkir sebelumnya).
// Koordinat dapat dikoreksi Admin lewat halaman Pengaturan.
// ============================================================
const SchoolSettings = {
    KEY: 'mupa_settings',
    DEFAULTS: {
        schoolName: 'SMKS Muhammadiyah Pakem',
        // Koordinat resmi SMKS Muhammadiyah Pakem:
        // Jl. Pakem-Turi KM 0,5, Pakem Binangun, Kec. Pakem, Kab. Sleman, DIY
        schoolLat: -7.663035,
        schoolLng: 110.4143683,
        parkingRadiusM: 100,
        qrDurationDefault: 10,
        jamMasuk: '07:00'
    },
    get() {
        try {
            const raw = localStorage.getItem(this.KEY);
            const val = raw ? JSON.parse(raw) : {};
            return Object.assign({}, this.DEFAULTS, val);
        } catch (error) {
            return Object.assign({}, this.DEFAULTS);
        }
    },
    save(partial) {
        try {
            const next = Object.assign(this.get(), partial || {});
            localStorage.setItem(this.KEY, JSON.stringify(next));
            return true;
        } catch (error) {
            return false;
        }
    }
};
window.SchoolSettings = SchoolSettings;

// ============================================================
// ActivityLog (mupa_activity_log)
// Catatan aktivitas penting (timestamp aktual), dibatasi 150 entri.
// ============================================================
const ActivityLog = {
    KEY: 'mupa_activity_log',
    MAX: 150,
    _read() {
        try {
            const raw = localStorage.getItem(this.KEY);
            const val = raw ? JSON.parse(raw) : [];
            return Array.isArray(val) ? val : [];
        } catch (error) {
            return [];
        }
    },
    log(action, detail, actor) {
        try {
            const list = this._read();
            list.unshift({
                id: 'LOG-' + Date.now() + '-' + Math.floor(Math.random() * 900 + 100),
                action: action || 'aktivitas',
                detail: detail || '',
                actor: actor || '',
                time: new Date().toISOString()
            });
            if (list.length > this.MAX) list.length = this.MAX;
            localStorage.setItem(this.KEY, JSON.stringify(list));
            return true;
        } catch (error) {
            return false;
        }
    },
    get(limit) {
        const list = this._read();
        return typeof limit === 'number' ? list.slice(0, limit) : list;
    },
    clear() {
        localStorage.removeItem(this.KEY);
    }
};
window.ActivityLog = ActivityLog;