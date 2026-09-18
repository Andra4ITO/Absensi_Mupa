// API Helper untuk komunikasi dengan backend
const API = {
    baseURL: '/api',
    
    // Mendapatkan token dari localStorage
    getToken() {
        return localStorage.getItem('token');
    },
    
    // Menyimpan token
    setToken(token) {
        localStorage.setItem('token', token);
    },
    
    // Menghapus token
    clearToken() {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
    },
    
    // Mendapatkan user dari localStorage
    getUser() {
        const user = localStorage.getItem('user');
        return user ? JSON.parse(user) : null;
    },
    
    // Menyimpan user
    setUser(user) {
        localStorage.setItem('user', JSON.stringify(user));
    },
    
    // Membuat header dengan token
    getHeaders() {
        const token = this.getToken();
        return {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        };
    },
    
    // Helper untuk handle response
    async handleResponse(response) {
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || 'Terjadi kesalahan');
        }
        return data;
    },
    
    // ===== AUTH =====
    async login(username, password) {
        const response = await fetch(`${this.baseURL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        return this.handleResponse(response);
    },
    
    // ===== SISWA =====
    async getSiswa() {
        const response = await fetch(`${this.baseURL}/siswa`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },
    
    // ===== GURU =====
    async getGuru() {
        const response = await fetch(`${this.baseURL}/guru`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },
    
    // ===== KELAS =====
    async getKelas() {
        const response = await fetch(`${this.baseURL}/kelas`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },
    
    // ===== MAPEL =====
    async getMapel() {
        const response = await fetch(`${this.baseURL}/mapel`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },
    
    async getMapelByGuru(guruId) {
        const response = await fetch(`${this.baseURL}/mapel/guru/${guruId}`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },
    
    // ===== SESI PRESENSI =====
    async bukaSesi(data) {
        const response = await fetch(`${this.baseURL}/sesi/buka`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(data)
        });
        return this.handleResponse(response);
    },
    
    async tutupSesi(sesiId) {
        const response = await fetch(`${this.baseURL}/sesi/tutup/${sesiId}`, {
            method: 'POST',
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },
    
    async getSesiAktifGuru(guruId) {
        const response = await fetch(`${this.baseURL}/sesi/aktif/guru/${guruId}`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },
    
    async getSesiDetail(sesiId) {
        const response = await fetch(`${this.baseURL}/sesi/${sesiId}`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },
    
    async getSesiAktifSemua() {
        const response = await fetch(`${this.baseURL}/sesi/aktif`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },
    
    async getRiwayatSesi(guruId) {
        const response = await fetch(`${this.baseURL}/sesi/riwayat/guru/${guruId}`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },
    
    // ===== PRESENSI =====
    async getRiwayatPresensi(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const response = await fetch(`${this.baseURL}/presensi/riwayat?${queryString}`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },
    
    async getRekapPresensi(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const response = await fetch(`${this.baseURL}/presensi/rekap?${queryString}`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },
    
    async getRekapPerMapel(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const response = await fetch(`${this.baseURL}/presensi/rekap/mapel?${queryString}`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    },
    
    async getDashboard() {
        const response = await fetch(`${this.baseURL}/presensi/dashboard`, {
            headers: this.getHeaders()
        });
        return this.handleResponse(response);
    }
};

// ===== SOCKET.IO HELPER =====
let socket = null;

function initSocket(user) {
    if (!user) return null;
    
    // Load socket.io client dari CDN
    if (typeof io === 'undefined') {
        console.error('Socket.io client tidak ditemukan. Pastikan script socket.io dimuat.');
        return null;
    }
    
    socket = io();
    
    // Kirim autentikasi
    socket.emit('authenticate', {
        userId: user.id,
        role: user.role,
        refId: user.refId,
        nama: user.nama
    });
    
    return socket;
}

function getSocket() {
    return socket;
}

// ===== TOAST NOTIFICATION (satu implementasi untuk semua halaman) =====
// Jenis: success | info | warning | error — TANPA warna hijau.
// - aksen warna lembut + ikon, auto dismiss 4.5 detik, dapat ditutup manual
// - aksesibel: role status/alert + aria-live, tombol tutup ber-aria-label
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    // Palet: biru/slate/amber/merah lembut (tidak ada hijau)
    const variants = {
        success: { wrap: 'border-blue-200',  bar: 'bg-blue-500',  icon: 'bg-blue-50 text-blue-600',   glyph: 'M5 13l4 4L19 7' },
        info:    { wrap: 'border-slate-200', bar: 'bg-slate-400', icon: 'bg-slate-100 text-slate-600', glyph: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
        warning: { wrap: 'border-amber-200', bar: 'bg-amber-400', icon: 'bg-amber-50 text-amber-600', glyph: 'M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z' },
        error:   { wrap: 'border-red-200',   bar: 'bg-red-500',   icon: 'bg-red-50 text-red-600',     glyph: 'M6 18L18 6M6 6l12 12' }
    };
    const v = variants[type] || variants.success;
    const isAlert = (type === 'error' || type === 'warning');

    const toast = document.createElement('div');
    toast.className = 'relative overflow-hidden w-full max-w-[calc(100vw-2rem)] sm:max-w-sm bg-white border ' +
        v.wrap + ' rounded-xl shadow-lg pl-4 pr-2 py-3 flex items-start gap-3 animate-fade-in';
    toast.setAttribute('role', isAlert ? 'alert' : 'status');
    toast.setAttribute('aria-live', isAlert ? 'assertive' : 'polite');
    toast.innerHTML =
        '<span class="absolute left-0 top-0 bottom-0 w-1 ' + v.bar + '" aria-hidden="true"></span>' +
        '<span class="shrink-0 w-7 h-7 rounded-full ' + v.icon + ' flex items-center justify-center mt-0.5" aria-hidden="true">' +
            '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="' + v.glyph + '"/></svg>' +
        '</span>' +
        '<p class="flex-1 text-sm text-slate-700 leading-snug break-words">' + message + '</p>' +
        '<button type="button" class="shrink-0 p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition" aria-label="Tutup notifikasi">' +
            '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>' +
        '</button>';

    container.appendChild(toast);

    let removed = false;
    let timer = null;
    function dismiss() {
        if (removed) return;
        removed = true;
        if (timer) clearTimeout(timer);
        toast.style.transition = 'opacity 250ms ease, transform 250ms ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(12px)';
        setTimeout(function () { toast.remove(); }, 260);
    }

    const closeBtn = toast.querySelector('button');
    if (closeBtn) closeBtn.addEventListener('click', dismiss);

    timer = setTimeout(dismiss, 4500);
}

// ===== UTILITY FUNCTIONS =====
function formatTanggal(tanggal) {
    if (!tanggal) return '-';
    const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 
                    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    const [tahun, bulan, hari] = tanggal.split('-');
    return `${parseInt(hari)} ${months[parseInt(bulan)-1]} ${tahun}`;
}

function formatDateTime(isoString) {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleString('id-ID', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function formatWaktu(waktu) {
    if (!waktu) return '-';
    return waktu;
}

function getStatusBadge(status) {
    // Badge untuk status sesi presensi
    const sesiBadges = {
        'aktif': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
        'ditutup': 'bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-300',
        'expired': 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
    };
    const sesiMap = {
        'aktif': 'Aktif',
        'ditutup': 'Ditutup',
        'expired': 'Expired'
    };
    
    // Badge untuk status kehadiran siswa
    const kehadiranBadges = {
        'Hadir': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
        'Izin': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
        'Sakit': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300',
        'Alpa': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300'
    };
    
    // Cek apakah status adalah status kehadiran siswa
    if (kehadiranBadges[status]) {
        return `<span class="px-2 py-1 rounded-full text-xs font-semibold ${kehadiranBadges[status]}">${status}</span>`;
    }
    
    // Jika status sesi
    if (sesiBadges[status]) {
        return `<span class="px-2 py-1 rounded-full text-xs font-semibold ${sesiBadges[status]}">${sesiMap[status]}</span>`;
    }
    
    // Default
    return `<span class="px-2 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">${status}</span>`;
}

function getMapelInitial(nama) {
    if (!nama) return '?';
    return nama.charAt(0).toUpperCase();
}

function logout() {
    if (socket) socket.disconnect();
    API.clearToken();
    window.location.href = '/';
}

