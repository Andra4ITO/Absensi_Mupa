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

// ===== TOAST NOTIFICATION =====
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const colors = {
        success: 'bg-green-500',
        error: 'bg-red-500',
        warning: 'bg-yellow-500',
        info: 'bg-blue-500'
    };
    
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };
    
    const toast = document.createElement('div');
    toast.className = `${colors[type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 animate-fade-in`;
    toast.innerHTML = `
        <span class="font-bold text-lg">${icons[type]}</span>
        <span class="text-sm">${message}</span>
        <button class="ml-4 text-white/80 hover:text-white" onclick="this.parentElement.remove()">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
            </svg>
        </button>
    `;
    
    container.appendChild(toast);
    
    // Auto remove setelah 4 detik
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.5s';
        setTimeout(() => toast.remove(), 500);
    }, 4000);
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
        'aktif': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
        'ditutup': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
        'expired': 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
    };
    const sesiMap = {
        'aktif': 'Aktif',
        'ditutup': 'Ditutup',
        'expired': 'Expired'
    };
    
    // Badge untuk status kehadiran siswa
    const kehadiranBadges = {
        'Hadir': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
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