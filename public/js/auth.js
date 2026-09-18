// ============================================================
// auth.js
// -------
// Sistem autentikasi + manajemen pengguna berbasis localStorage.
//
// Mode login:
//   - Admin  : username + password  (admin / 123)
//   - Guru   : Nama + NIS/NIP       (terdaftar oleh Admin)
//   - Siswa  : Nama + NIS/NIP       (terdaftar oleh Admin)
//
// Penyimpanan:
//   - mupa_users         : daftar pengguna guru/siswa
//   - mupa_current_user  : pengguna yang sedang login
//   - token / user       : kompatibilitas dengan API.js
//
// Sistem ini tidak bergantung pada backend Node.js / Firebase
// sehingga seluruh fitur dapat diuji coba secara offline.
// ============================================================

// ===== USER STORE (Manajemen Pengguna) =====
// Penyimpanan data guru/siswa yang didaftarkan oleh Admin.
const UserStore = {
    USERS_KEY: 'mupa_users',
    CURRENT_KEY: 'mupa_current_user',

    // Membaca daftar pengguna (aman terhadap JSON rusak)
    getUsers() {
        try {
            const raw = localStorage.getItem(this.USERS_KEY);
            const users = raw ? JSON.parse(raw) : [];
            return Array.isArray(users) ? users : [];
        } catch (error) {
            console.warn('[UserStore] Data mupa_users rusak, akan di-reset.');
            return [];
        }
    },

    // Menyimpan daftar pengguna
    saveUsers(users) {
        try {
            localStorage.setItem(this.USERS_KEY, JSON.stringify(users));
            return true;
        } catch (error) {
            console.error('[UserStore] Gagal menyimpan ke localStorage:', error);
            return false;
        }
    },

    // Membuat data demo awal (hanya sekali, jika key belum pernah ada)
    seedIfEmpty() {
        if (localStorage.getItem(this.USERS_KEY) !== null) return;
        const now = new Date().toISOString();
        const demo = [
            { id: 'USR-001', role: 'siswa', nama: 'Andi Pratama', nis: '2026001', kelas: 'XI', jurusan: 'RPL', password: null, status: 'aktif', createdAt: now },
            { id: 'USR-002', role: 'guru', nama: 'Budi Santoso', nis: 'G001', subjectIds: ['SUB-001', 'SUB-002'], password: null, status: 'aktif', createdAt: now },
            { id: 'USR-003', role: 'siswa', nama: 'Dewi Lestari', nis: '2026002', kelas: 'X', jurusan: 'TKJ', password: null, status: 'aktif', createdAt: now }
        ];
        this.saveUsers(demo);
    },

    // Migrasi data lama: pastikan siswa memiliki kelas & jurusan.
    // Dipanggil sekali di awal dashboard agar demo tetap berjalan.
    ensureAcademicFields() {
        if (localStorage.getItem(this.USERS_KEY) === null) {
            this.seedIfEmpty();
        }
        const users = this.getUsers();
        let changed = false;
        users.forEach(u => {
            if (u.role === 'siswa') {
                if (!u.kelas || !u.jurusan) {
                    u.kelas = u.kelas || (u.nama && /andi/i.test(u.nama) ? 'XI' : 'X');
                    u.jurusan = u.jurusan || (u.nama && /andi/i.test(u.nama) ? 'RPL' : 'RPL');
                    changed = true;
                }
            } else if (u.role === 'guru') {
                // Migrasi: guru lama tanpa mapel → beri mapel default
                if (!Array.isArray(u.subjectIds) || u.subjectIds.length === 0) {
                    u.subjectIds = ['SUB-001'];
                    changed = true;
                }
            }
        });
        if (changed) this.saveUsers(users);
    },

    // Generate ID baru berformat USR-XXX
    generateUserId(users) {
        let max = 0;
        users.forEach(u => {
            const match = String(u.id || '').match(/USR-(\d+)/);
            if (match) max = Math.max(max, parseInt(match[1], 10));
        });
        return 'USR-' + String(max + 1).padStart(3, '0');
    },

    // Menambah pengguna baru (guru/siswa)
    addUser(data) {
        const users = this.getUsers();
        const nis = String(data.nis || '').trim().toUpperCase();
        const nama = String(data.nama || '').trim();
        const role = data.role === 'guru' ? 'guru' : 'siswa';
        if (!nama) return { success: false, error: 'Nama lengkap wajib diisi.' };
        if (!nis) return { success: false, error: 'NIS/NIP wajib diisi.' };
        if (role === 'siswa') {
            if (!data.kelas) return { success: false, error: 'Kelas wajib dipilih.' };
            if (!data.jurusan) return { success: false, error: 'Jurusan wajib dipilih.' };
        } else {
            // Guru: minimal satu mata pelajaran yang diajar
            const subjectIds = this._normalizeSubjectIds(data.subjectIds);
            if (subjectIds.length === 0) {
                return { success: false, error: 'Pilih minimal satu mata pelajaran yang diajar.' };
            }
            data.subjectIds = subjectIds;
        }
        if (users.some(u => String(u.nis || '').trim().toUpperCase() === nis)) {
            return { success: false, error: 'NIS/NIP tersebut sudah terdaftar.' };
        }
        const user = {
            id: this.generateUserId(users),
            role: role,
            nama,
            nis,
            kelas: role === 'siswa' ? String(data.kelas || '').trim() : null,
            jurusan: role === 'siswa' ? String(data.jurusan || '').trim() : null,
            subjectIds: role === 'guru' ? data.subjectIds : [],
            password: null,
            status: data.status || 'aktif',
            createdAt: new Date().toISOString()
        };
        users.push(user);
        if (!this.saveUsers(users)) {
            return { success: false, error: 'Gagal menyimpan data ke localStorage.' };
        }
        return { success: true, user };
    },

    // Mengubah data pengguna (ID tidak berubah)
    updateUser(id, data) {
        const users = this.getUsers();
        const idx = users.findIndex(u => u.id === id);
        if (idx === -1) return { success: false, error: 'Pengguna tidak ditemukan.' };
        const nis = String(data.nis || '').trim().toUpperCase();
        const nama = String(data.nama || '').trim();
        const role = data.role === 'guru' ? 'guru' : 'siswa';
        if (!nama) return { success: false, error: 'Nama lengkap wajib diisi.' };
        if (!nis) return { success: false, error: 'NIS/NIP wajib diisi.' };
        if (role === 'siswa') {
            if (!data.kelas) return { success: false, error: 'Kelas wajib dipilih.' };
            if (!data.jurusan) return { success: false, error: 'Jurusan wajib dipilih.' };
        } else {
            const subjectIds = this._normalizeSubjectIds(
                data.subjectIds !== undefined ? data.subjectIds : users[idx].subjectIds
            );
            if (subjectIds.length === 0) {
                return { success: false, error: 'Pilih minimal satu mata pelajaran yang diajar.' };
            }
            data.subjectIds = subjectIds;
        }
        if (users.some(u => u.id !== id && String(u.nis || '').trim().toUpperCase() === nis)) {
            return { success: false, error: 'NIS/NIP tersebut sudah terdaftar.' };
        }
        users[idx] = {
            ...users[idx],
            nama,
            nis,
            role: role,
            kelas: role === 'siswa' ? String(data.kelas || '').trim() : null,
            jurusan: role === 'siswa' ? String(data.jurusan || '').trim() : null,
            subjectIds: role === 'guru' ? data.subjectIds : [],
            status: data.status || users[idx].status,
            updatedAt: new Date().toISOString()
        };
        if (!this.saveUsers(users)) {
            return { success: false, error: 'Gagal menyimpan data ke localStorage.' };
        }
        return { success: true, user: users[idx] };
    },

    // Normalisasi subjectIds menjadi array string unik
    _normalizeSubjectIds(raw) {
        if (Array.isArray(raw)) return raw.map(function (s) { return String(s).trim(); }).filter(Boolean);
        if (typeof raw === 'string' && raw.trim()) return [raw.trim()];
        return [];
    },

    // Menghapus pengguna
    deleteUser(id) {
        const users = this.getUsers().filter(u => u.id !== id);
        if (!this.saveUsers(users)) {
            return { success: false, error: 'Gagal menyimpan data ke localStorage.' };
        }
        return { success: true, users };
    },

    // Cari pengguna berdasarkan ID
    findById(id) {
        return this.getUsers().find(u => u.id === id) || null;
    },

    // Ambil subjectIds milik seorang Guru (array aman)
    getSubjectIdsOf(user) {
        if (!user || user.role !== 'guru') return [];
        return Array.isArray(user.subjectIds) ? user.subjectIds : [];
    },

    // Ubah list subjectIds guru menjadi nama mata pelajaran (dari AttendanceStore)
    getSubjectNamesOf(user) {
        const ids = this.getSubjectIdsOf(user);
        if (ids.length === 0) return [];
        const store = window.AttendanceStore;
        const all = (store && typeof store.getSubjects === 'function') ? store.getSubjects() : [];
        const byId = {};
        all.forEach(function (s) { byId[s.id] = s.nama; });
        return ids.map(function (id) { return byId[id] || id; });
    },

    // Cari pengguna berdasarkan Nama + NIS/NIP (untuk login)
    findByCredentials(nama, nis) {
        const n = String(nama || '').trim().toLowerCase();
        const k = String(nis || '').trim().toUpperCase();
        return this.getUsers().find(u =>
            String(u.nama || '').toLowerCase() === n &&
            String(u.nis || '').trim().toUpperCase() === k
        ) || null;
    },

    // ===== SESSION =====
    getCurrentUser() {
        try {
            const raw = localStorage.getItem(this.CURRENT_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            return null;
        }
    },

    setCurrentUser(user) {
        try {
            localStorage.setItem(this.CURRENT_KEY, JSON.stringify(user));
            return true;
        } catch (error) {
            return false;
        }
    },

    clearCurrentUser() {
        localStorage.removeItem(this.CURRENT_KEY);
    }
};

// Ekspor ke global scope agar bisa dipakai oleh semua halaman
window.UserStore = UserStore;

const Auth = {
    // --- Akun demo (hardcoded) ---
    DEMO_ACCOUNTS: [
        {
            id: "admin1",
            nama: "Kesiswaan MUPA",
            username: "admin",
            password: "123",
            role: "admin"
        },
        {
            id: "guru1",
            nama: "Siti Rahmawati",
            username: "guru",
            password: "123",
            role: "guru"
        },
        {
            id: "siswa1",
            nama: "Aditya Pratama",
            username: "siswa",
            password: "123",
            role: "siswa"
        }
    ],

    // --- LocalStorage keys (kompatibel dengan API.js) ---
    TOKEN_KEY: 'token',
    USER_KEY: 'user',

    /**
     * LOGIN UNIVERSAL — satu fungsi untuk Admin, Guru, dan Siswa.
     *
     * Alur:
     *   1. Normalisasi input (trim).
     *   2. Coba cocokkan akun Admin (username + password).
     *   3. Jika bukan Admin, cari Guru/Siswa di mupa_users (Nama + NIS/NIP).
     *   4. Cek status akun (nonaktif ditolak).
     *   5. Simpan session lokal (tanpa token) → mupa_current_user + 'user'.
     *
     * Role ditentukan otomatis dari data akun yang ditemukan.
     * Sinkron & langsung (tanpa artificial delay).
     *
     * @param {string} credential1 - Username (admin) atau Nama lengkap (guru/siswa)
     * @param {string} credential2 - Password (admin) atau NIS/NIP (guru/siswa)
     * @returns {{user: Object}}
     * @throws  Error jika input kosong, akun tidak cocok, atau akun nonaktif
     */
    loginUniversal(credential1, credential2) {
        const c1 = String(credential1 || '').trim();
        const c2 = String(credential2 || '').trim();

        if (!c1) throw new Error('Username/Nama wajib diisi.');
        if (!c2) throw new Error('Password/NIS wajib diisi.');

        // 1) Coba Admin (username + password, case-insensitive username)
        const account = this.DEMO_ACCOUNTS.find(
            a => a.username.toLowerCase() === c1.toLowerCase() &&
                 a.password === c2
        );
        if (account) {
            const adminUser = {
                id: account.id,
                username: account.username,
                nama: account.nama,
                role: account.role,
                status: 'aktif'
            };
            this._setSession(adminUser);
            return { user: adminUser };
        }

        // 2) Bukan admin → cari Guru/Siswa di mupa_users (Nama + NIS/NIP)
        UserStore.seedIfEmpty();
        const user = UserStore.getUsers().find(u =>
            String(u.nama || '').trim().toLowerCase() === c1.toLowerCase() &&
            String(u.nis || '').trim().toUpperCase() === c2.toUpperCase()
        );

        if (!user) {
            throw new Error('Username/Nama atau Password/NIS salah.');
        }

        if (user.status === 'nonaktif' || user.status === 'tidak-aktif') {
            throw new Error('Akun Anda tidak aktif. Silakan hubungi Admin/Kesiswaan.');
        }

        this._setSession(user);
        return { user };
    },

    /**
     * Simpan session lokal (tanpa token).
     * Menulis ke mupa_current_user (primary) dan 'user' (kompatibilitas API).
     * @private
     */
    _setSession(user) {
        localStorage.setItem(this.USER_KEY, JSON.stringify(user));
        UserStore.setCurrentUser(user);
    },

    /**
     * Kompatibilitas: login admin lama → delegasikan ke loginUniversal.
     */
    login(username, password) {
        return this.loginUniversal(username, password);
    },

    /**
     * Kompatibilitas: login nama+NIS lama → delegasikan ke loginUniversal.
     */
    loginWithNama(nama, nis) {
        return this.loginUniversal(nama, nis);
    },

    /**
     * Logout — hapus session Supabase Auth + semua data session lokal.
     * (async: menunggu signOut Supabase agar tombol Back tidak
     *  membuka dashboard dengan session yang masih tersimpan)
     */
    async logout() {
        if (window.SupabaseAuth && typeof window.SupabaseAuth.signOut === 'function') {
            try {
                await window.SupabaseAuth.signOut();
            } catch (e) {
                console.error('[Auth] signOut Supabase error:', e);
            }
        }
        localStorage.removeItem(this.TOKEN_KEY);
        localStorage.removeItem(this.USER_KEY);
        UserStore.clearCurrentUser();
        window.location.href = '/';
    },

    /**
     * Ambil user yang sedang login dari localStorage.
     * @returns {Object|null}
     */
    getUser() {
        const current = UserStore.getCurrentUser();
        if (current) return current;
        const user = localStorage.getItem(this.USER_KEY);
        return user ? JSON.parse(user) : null;
    },

    /**
     * Ambil token dari localStorage.
     * @returns {string|null}
     */
    getToken() {
        return localStorage.getItem(this.TOKEN_KEY);
    },

    /**
     * Cek apakah pengguna sudah terautentikasi.
     * Berbasis session lokal (mupa_current_user / 'user'), tanpa token expiry.
     * @returns {boolean}
     */
    isAuthenticated() {
        const current = UserStore.getCurrentUser();
        if (current && current.role) return true;
        try {
            const user = localStorage.getItem(this.USER_KEY);
            const parsed = user ? JSON.parse(user) : null;
            return !!(parsed && parsed.role);
        } catch {
            return false;
        }
    },

    /**
     * Cek apakah pengguna memiliki role tertentu.
     * @param {string} role - 'admin' | 'guru' | 'siswa'
     * @returns {boolean}
     */
    hasRole(role) {
        const user = this.getUser();
        return user && user.role === role;
    },

    /**
     * Guard: pastikan pengguna terautentikasi dengan role tertentu.
     * Jika tidak, redirect ke halaman login.
     * @param {string} role - role yang diperlukan
     * @returns {Object|null} user object jika lolos, null jika tidak
     */
    requireAuth(role) {
        if (!this.isAuthenticated()) {
            window.location.href = '/';
            return null;
        }

        const user = this.getUser();
        if (role && user.role !== role) {
            // Role tidak sesuai → arahkan ke dashboard miliknya sendiri (Stage 4).
            window.location.href = this.ROLE_HOME[user.role] || '/';
            return null;
        }

        return user;
    }
};

// ============================================================
// STAGE 4 — Integrasi Supabase Auth (migrasi bertahap).
//   - Supabase Auth = sumber kebenaran (session + role dari DB).
//   - Jalur login lama (demo/localStorage) DIPERTAHANKAN sebagai
//     fallback selama migrasi — tidak dihapus agresif.
// ============================================================

// Terjemahkan error Supabase Auth menjadi pesan yang mudah dipahami.
Auth.friendlyAuthError = function (error) {
    const msg = (error && (error.message || error.msg)) || '';
    const code = (error && error.code) || '';
    if (code === 'invalid_credentials' || /invalid login credentials/i.test(msg)) {
        return 'Username/NIS atau password salah.';
    }
    if (code === 'email_not_confirmed' || /email not confirmed/i.test(msg)) {
        return 'Akun Anda belum dikonfirmasi. Silakan hubungi Admin/Kesiswaan.';
    }
    if (/user is disabled|banned/i.test(msg)) {
        return 'Akun Anda dinonaktifkan. Silakan hubungi Admin/Kesiswaan.';
    }
    if (/failed to fetch|network/i.test(msg)) {
        return 'Gagal terhubung ke server. Periksa koneksi internet Anda.';
    }
    return msg || 'Terjadi kesalahan saat login.';
};

/**
 * LOGIN VIA SUPABASE AUTH (Stage 4).
 * Identifier: 'admin' / kode guru / NIS siswa → email virtual Supabase.
 * Mengembalikan:
 *   { user }              → login sukses (session Supabase aktif)
 *   null                  → identifier tidak dikenal (caller boleh
 *                           memakai fallback login lama)
 * Melempar Error (pesan ramah) bila kredensial salah / akun bermasalah.
 */
Auth.loginSupabase = async function (identifier, password) {
    if (!window.SupabaseAuth || !window.SupabaseAuth.signInWithIdentifier) return null;

    const res = await window.SupabaseAuth.signInWithIdentifier(identifier, password);
    if (res.error) {
        if (res.error.code === 'unknown_identifier') return null;
        throw new Error(this.friendlyAuthError(res.error));
    }

    const sess = res.data && res.data.user;
    if (!sess) throw new Error('Session tidak ditemukan. Silakan coba lagi.');

    // Profile aplikasi (role/status) dari tabel `users` — bukan dari localStorage.
    const profRes = await window.SupabaseAuth.fetchAppProfile(sess.id);
    if (profRes.error) {
        console.error('[Auth] Gagal mengambil profile:', profRes.error);
        throw new Error('Gagal mengambil data pengguna. Silakan coba lagi.');
    }
    const profile = profRes.data;
    const userRole = profile ? profile.role : ((sess.user_metadata && sess.user_metadata.role) || null);
    if (!userRole) {
        throw new Error('Role pengguna tidak ditemukan. Silakan hubungi Admin/Kesiswaan.');
    }
    if (profile && profile.status && profile.status !== 'aktif') {
        throw new Error('Akun Anda tidak aktif. Silakan hubungi Admin/Kesiswaan.');
    }

    const user = {
        id: sess.id,
        uid: sess.id,
        nama: profile ? profile.nama : ((sess.user_metadata && sess.user_metadata.nama) || sess.email),
        role: userRole,
        status: profile ? (profile.status || 'aktif') : 'aktif'
    };
    this._setSession(user);
    return { user: user };
};

// Halaman tujuan tiap role (untuk redirect saat role tidak sesuai).
Auth.ROLE_HOME = {
    admin: '/dashboard-admin.html',
    guru: '/dashboard-guru.html',
    siswa: '/dashboard-siswa.html'
};

/**
 * GUARD DASHBOARD (Stage 4) — verifikasi session & role.
 * 1) Session Supabase Auth → profile dari tabel `users` → validasi role.
 * 2) Fallback migrasi: guard lama berbasis localStorage.
 * Mengembalikan user object jika lolos, null jika redirect terjadi.
 */
Auth.requireAuthAsync = async function (role) {
    if (window.SupabaseAuth && typeof window.SupabaseAuth.getSessionUser === 'function') {
        try {
            const sess = await window.SupabaseAuth.getSessionUser();
            if (sess) {
                const profRes = await window.SupabaseAuth.fetchAppProfile(sess.id);
                if (profRes.error) console.error('[Auth] Gagal mengambil profile:', profRes.error);
                const profile = profRes.data;
                const userRole = profile ? profile.role : ((sess.user_metadata && sess.user_metadata.role) || null);

                if (!userRole) {
                    window.location.href = '/';
                    return null;
                }
                if (profile && profile.status && profile.status !== 'aktif') {
                    if (typeof showToast === 'function') showToast('Akun Anda tidak aktif. Silakan hubungi Admin/Kesiswaan.', 'error');
                    window.location.href = '/';
                    return null;
                }
                if (role && userRole !== role) {
                    // Role tidak sesuai → arahkan ke dashboard miliknya sendiri.
                    if (typeof showToast === 'function') showToast('Akses ditolak: Anda tidak memiliki hak akses ke halaman ini.', 'error');
                    window.location.href = this.ROLE_HOME[userRole] || '/';
                    return null;
                }

                const user = {
                    id: sess.id,
                    uid: sess.id,
                    nama: profile ? profile.nama : ((sess.user_metadata && sess.user_metadata.nama) || sess.email),
                    role: userRole,
                    status: profile ? (profile.status || 'aktif') : 'aktif'
                };
                this._setSession(user);
                return user;
            }
        } catch (e) {
            console.error('[Auth] Guard Supabase error:', e);
            // lanjut ke fallback di bawah
        }
    }
    // Fallback migrasi: guard lama (localStorage).
    return this.requireAuth(role);
};

// Ekspor ke global scope agar bisa dipakai di semua halaman
window.Auth = Auth;


// Jaga kompatibilitas: override API.getUser / API.getToken / API.clearToken
// agar kode lama yang masih memakai API tetap berfungsi.
if (typeof API !== 'undefined') {
    const originalGetUser = API.getUser;
    API.getUser = function() {
        return Auth.getUser() || originalGetUser.call(this);
    };
    API.getToken = function() {
        return Auth.getToken();
    };
    API.clearToken = function() {
        Auth.logout();
    };
}

// Global logout function (dipanggil oleh tombol di header)
function logout() {
    Auth.logout();
}

// Global toggleDarkMode (dipanggil oleh tombol di header)
function toggleDarkMode() {
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    localStorage.setItem('darkMode', isDark);
}

// Restore dark mode on load
(function() {
    const saved = localStorage.getItem('darkMode');
    if (saved === 'true') {
        document.documentElement.classList.add('dark');
    }
})();