// ============================================================
// supabase.js - Koneksi Sistem Presensi Digital MUPA -> Supabase
// ------------------------------------------------------------
// Library supabase-js v2 dimuat via CDN (UMD -> window.supabase)
// oleh halaman yang membutuhkan, SEBELUM file ini.
//
// Hanya menggunakan Project URL + Publishable (anon) key.
// TIDAK ada service_role / secret key di sini.
//
// ARSITEKTUR (Task 2):
//   Supabase HANYA dipakai untuk AUTHENTICATION (login, logout,
//   session, identity, role). Seluruh DATA APLIKASI (siswa, guru,
//   kelas, jurusan, mapel, sesi QR, absensi, parkir, riwayat)
//   dikembalikan ke mekanisme lokal project (localStorage:
//   UserStore / AttendanceStore / ParkingTicketStore).
//
//   Satu-satunya query Supabase Database yang tersisa adalah tabel
//   `users` (kolom uid, role, nama, status) yang dipakai sebagai
//   profil & role untuk autentikasi - BUKAN data aplikasi.
// ============================================================

const SUPABASE_URL = "https://zdxsgytbahvmlpocwnlm.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_kcmpJFoezY5akl3z0YaORg_Vmo7uJ6P";

let supabaseClient = null;

try {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
        throw new Error("Library Supabase (window.supabase) belum termuat. Pastikan script CDN supabase-js dimuat sebelum js/supabase.js.");
    }
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    console.log("[Supabase] Client dibuat:", SUPABASE_URL);
} catch (error) {
    console.error("[Supabase] Gagal membuat client:", error.message || error);
}

// ============================================================
// Connection test - hanya cek ketersediaan client + session Auth.
// Tidak menampilkan apa pun ke UI; hasil hanya di Console.
// (TIDAK lagi query tabel database aplikasi.)
// ============================================================
async function testSupabaseConnection() {
    if (!supabaseClient) {
        console.error("[Supabase] Connection test dilewati - client tidak tersedia.");
        return { success: false, error: "client-not-available" };
    }
    try {
        const { data, error } = await supabaseClient.auth.getSession();
        if (error) {
            console.error("Supabase connection error:", error);
            return { success: false, error: error };
        }
        console.log("Supabase connection successful (auth session aktif: " + !!(data && data.session) + ").");
        return { success: true, data: data };
    } catch (error) {
        console.error("Supabase connection error:", error && (error.message || error));
        return { success: false, error: error };
    }
}

// Jalankan tes otomatis sekali saat halaman dimuat (console-only).
if (supabaseClient) {
    testSupabaseConnection();
}

// ============================================================
// SUPABASE AUTH - login/logout/session/identity/role.
//
// Identitas login dipetakan ke email virtual:
//   - 'admin'       -> admin@mupa.local
//   - email penuh   -> langsung dipakai sebagai email login
//                     (mis. {nis}@siswa.mupa.local)
//
//   CATATAN: lookup NIS/kode guru di tabel Supabase (students/
//   teachers) TIDAK dipakai lagi. Guru/Siswa yang login memakai
//   Nama + NIS/NIP otomatis dilanjutkan ke jalur lokal
//   (loginUniversal / mupa_users).
//
// Password TIDAK disimpan di tabel manapun - hanya di Supabase Auth.
// ============================================================

var AUTH_EMAIL_DOMAINS = {
    admin: 'admin@mupa.local',
    guru: '@guru.mupa.local',
    siswa: '@siswa.mupa.local'
};

function sanitizeEmailLocal(value) {
    return String(value == null ? '' : value).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
}

// Tentukan email virtual dari identifier login.
// Kembalikan null = identifier tidak dikenal (caller boleh fallback ke login lama).
async function resolveIdentifierEmail(identifier) {
    if (!supabaseClient) return null;
    const id = String(identifier == null ? '' : identifier).trim();
    if (!id) return null;

    // Identifier berupa email penuh -> pakai langsung sebagai email login Supabase Auth.
    if (id.indexOf('@') !== -1) {
        return String(id).toLowerCase();
    }

    // Admin: username 'admin'.
    if (id.toLowerCase() === 'admin') return AUTH_EMAIL_DOMAINS.admin;

    // Guru/Siswa: identifier nama/NIS/kode guru tidak lagi dipetakan lewat
    // tabel Supabase - biarkan caller memakai jalur login lokal.
    return null;
}

// Login via Supabase Auth. Mengembalikan { data, error }.
// error.code 'unknown_identifier' = identifier tidak dikenal.
async function authSignInWithIdentifier(identifier, password) {
    if (!supabaseClient) return { data: null, error: new Error('Supabase client tidak tersedia.') };
    const email = await resolveIdentifierEmail(identifier);
    if (!email) {
        return { data: null, error: { code: 'unknown_identifier', message: 'Akun tidak ditemukan.' } };
    }
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email: email, password: String(password == null ? '' : password) });
    if (error) console.error('[SupabaseAuth] signIn error:', error);
    return { data: data, error: error };
}

// Session aktif (user Auth) atau null.
async function authGetSessionUser() {
    if (!supabaseClient) return null;
    try {
        const { data, error } = await supabaseClient.auth.getUser();
        if (error) return null;
        return data && data.user ? data.user : null;
    } catch (e) {
        console.error('[SupabaseAuth] getUser error:', e);
        return null;
    }
}

// Profile & role dari tabel `users` (uid = user ID Supabase Auth).
// Dipakai SAJA untuk autentikasi/otorisasi (identity + role),
// bukan untuk data aplikasi.
async function authFetchAppProfile(uid) {
    if (!supabaseClient || !uid) return { data: null, error: new Error('uid kosong / Supabase tidak tersedia.') };
    const { data, error } = await supabaseClient.from('users').select('*').eq('uid', uid).maybeSingle();
    if (error) console.error('[SupabaseAuth] fetchAppProfile error:', error);
    return { data: data, error: error };
}

// Logout - hapus session Supabase Auth.
async function authSignOut() {
    if (!supabaseClient) return { error: null };
    const res = await supabaseClient.auth.signOut();
    if (res.error) console.error('[SupabaseAuth] signOut error:', res.error);
    return res;
}

function isReady() {
    return !!supabaseClient;
}

// Expose modul Auth untuk login.js / auth.js / dashboard.
window.SupabaseAuth = {
    signInWithIdentifier: authSignInWithIdentifier,
    getSessionUser: authGetSessionUser,
    fetchAppProfile: authFetchAppProfile,
    signOut: authSignOut,
    resolveIdentifierEmail: resolveIdentifierEmail,
    emailDomains: AUTH_EMAIL_DOMAINS
};

// Expose service (koneksi) - TANPA CRUD database aplikasi.
window.SupabaseService = {
    client: supabaseClient,
    url: SUPABASE_URL,
    isReady: isReady,
    testConnection: testSupabaseConnection
};