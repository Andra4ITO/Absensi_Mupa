// ===== DASHBOARD SISWA LOGIC =====
let html5QrCode = null;
let scanning = true;
let siswaUser = null;
let lastScanTime = 0;

document.addEventListener('DOMContentLoaded', () => {
    // Cek autentikasi
    const user = API.getUser();
    if (!user || user.role !== 'siswa') {
        window.location.href = '/';
        return;
    }
    siswaUser = user;

    // Set user info
    document.getElementById('user-name').textContent = user.nama;
    document.getElementById('user-initial').textContent = user.nama.charAt(0).toUpperCase();
    document.getElementById('user-nis').textContent = `NIS: ${user.siswa ? user.siswa.nis : '-'}`;
    document.getElementById('user-kelas').textContent = `Kelas: ${user.kelas ? user.kelas.nama : '-'}`;

    // Set tanggal dan waktu
    updateDateTime();
    setInterval(updateDateTime, 1000);

    // Setup socket real-time
    setupSocket();

    // Start QR scanner
    startScanner();

    // Load data
    loadRiwayat();
    loadTahunOptions();
});

// ===== DARK MODE =====
function toggleDarkMode() {
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    localStorage.setItem('darkMode', isDark);
}

// ===== DATE TIME =====
function updateDateTime() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('current-date').textContent = now.toLocaleDateString('id-ID', options);
    document.getElementById('current-time').textContent = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ===== SOCKET.IO SETUP =====
function setupSocket() {
    const socket = initSocket(siswaUser);
    
    if (!socket) return;

    // Terima event sesi ditutup
    socket.on('sesi-ditutup', (data) => {
        showToast('Sesi presensi telah ditutup oleh guru.', 'info');
    });

    // Terima hasil scan dari server
    socket.on('scan-result', (result) => {
        handleScanResult(result);
    });
}

// ===== QR SCANNER =====
function startScanner() {
    if (typeof Html5Qrcode === 'undefined') {
        showToast('Library QR Scanner gagal dimuat. Muat ulang halaman.', 'error');
        return;
    }

    html5QrCode = new Html5Qrcode("qr-reader");

    html5QrCode.start(
        { facingMode: "environment" },
        {
            fps: 10,
            qrbox: { width: 250, height: 250 }
        },
        (decodedText) => {
            // Cooldown scan 3 detik untuk mencegah spam
            const now = Date.now();
            if (now - lastScanTime < 3000) return;
            lastScanTime = now;

            handleQRDecoded(decodedText);
        },
        (errorMessage) => {
            // Abaikan error scan (normal saat tidak ada QR)
        }
    ).catch(err => {
        console.error('Gagal memulai scanner:', err);
        showToast('Tidak dapat mengakses kamera. Pastikan izin kamera diberikan.', 'error');
    });
}

// ===== HANDLE QR DECODED =====
function handleQRDecoded(decodedText) {
    try {
        // Parse data QR
        const qrData = JSON.parse(decodedText);
        
        // Validasi tipe QR
        if (qrData.type !== 'PRESENSI_SESI') {
            showToast('QR Code bukan untuk presensi.', 'warning');
            return;
        }

        if (!qrData.sesiId || !qrData.token) {
            showToast('QR Code tidak valid.', 'error');
            return;
        }

        // Tampilkan info sesi yang di-scan
        showScanInfo(qrData);

        // Kirim ke server via socket untuk diproses
        const socket = getSocket();
        if (socket) {
            socket.emit('scan-qr', {
                sesiId: qrData.sesiId,
                token: qrData.token,
                siswaId: siswaUser.refId
            });
        } else {
            showToast('Koneksi real-time tidak terhubung.', 'error');
        }
    } catch (error) {
        console.error('Parse QR error:', error);
        showToast('QR Code tidak dikenali.', 'error');
    }
}

// ===== SHOW SCAN INFO =====
function showScanInfo(qrData) {
    const resultCard = document.getElementById('scan-result-card');
    const resultInfo = document.getElementById('scan-result-info');
    
    resultCard.classList.remove('hidden');
    
    resultInfo.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-3">
            <div class="flex items-center justify-between">
                <p class="text-xs text-gray-500 dark:text-gray-400">Mata Pelajaran</p>
                <p class="text-sm font-semibold text-gray-800 dark:text-white">${qrData.mapel || '-'}</p>
            </div>
            <div class="flex items-center justify-between">
                <p class="text-xs text-gray-500 dark:text-gray-400">Guru</p>
                <p class="text-sm font-semibold text-gray-800 dark:text-white">${qrData.guru || '-'}</p>
            </div>
            <div class="flex items-center justify-between">
                <p class="text-xs text-gray-500 dark:text-gray-400">Kelas</p>
                <p class="text-sm font-semibold text-gray-800 dark:text-white">${qrData.kelas || '-'}</p>
            </div>
            <div class="flex items-center justify-between">
                <p class="text-xs text-gray-500 dark:text-gray-400">Sesi ID</p>
                <p class="text-sm font-mono text-gray-800 dark:text-white">${qrData.sesiId}</p>
            </div>
        </div>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-3 text-center">
            <span class="inline-flex items-center gap-2">
                <svg class="animate-spin w-4 h-4 text-muhammadiyah-600" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Memproses kehadiran...
            </span>
        </p>
    `;
}

// ===== AUDIO FEEDBACK (Web Audio API) =====
let audioContext = null;

// Memainkan suara sukses (chime modern) saat presensi berhasil
function playSuccessSound() {
    try {
        // Inisialisasi AudioContext (lazy, setelah interaksi user)
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        
        const now = audioContext.currentTime;
        
        // Nada 1: C5 (523.25 Hz) - durasi 0.15s
        playTone(523.25, now, 0.15, 0.25);
        // Nada 2: E5 (659.25 Hz) - mulai 0.12s setelah nada 1
        playTone(659.25, now + 0.12, 0.15, 0.25);
        // Nada 3: G5 (783.99 Hz) - mulai 0.24s setelah nada 1
        playTone(783.99, now + 0.24, 0.2, 0.3);
        // Nada 4: C6 (1046.50 Hz) - mulai 0.36s setelah nada 1
        playTone(1046.50, now + 0.36, 0.3, 0.35);
    } catch (error) {
        console.warn('Audio feedback tidak dapat diputar:', error);
    }
}

// Helper untuk memainkan satu nada
function playTone(frequency, startTime, duration, volume) {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, startTime);
    
    // Envelope: fade in & fade out agar terdengar halus
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.02);
    gainNode.gain.setValueAtTime(volume, startTime + duration - 0.05);
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.05);
}

// ===== HANDLE SCAN RESULT =====
function handleScanResult(result) {
    const resultInfo = document.getElementById('scan-result-info');
    const resultContent = document.getElementById('scan-result-content');
    
    if (result.success) {
        // Berhasil - tampilkan data siswa
        resultContent.className = 'bg-green-50 dark:bg-gray-700 rounded-lg p-6 animate-fade-in';
        resultInfo.innerHTML = `
            <div class="text-center mb-4">
                <div class="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center mx-auto mb-3">
                    <svg class="w-8 h-8 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                </div>
                <h4 class="text-lg font-bold text-green-800 dark:text-green-300">Presensi Berhasil!</h4>
                <p class="text-sm text-green-700 dark:text-green-400">${result.message}</p>
            </div>
            <div class="bg-white dark:bg-gray-800 rounded-lg p-4 space-y-2">
                <div class="flex justify-between">
                    <p class="text-xs text-gray-500 dark:text-gray-400">Nama Lengkap</p>
                    <p class="text-sm font-semibold text-gray-800 dark:text-white">${siswaUser.nama}</p>
                </div>
                <div class="flex justify-between">
                    <p class="text-xs text-gray-500 dark:text-gray-400">NIS</p>
                    <p class="text-sm font-semibold text-gray-800 dark:text-white">${siswaUser.siswa ? siswaUser.siswa.nis : '-'}</p>
                </div>
                <div class="flex justify-between">
                    <p class="text-xs text-gray-500 dark:text-gray-400">Jurusan</p>
                    <p class="text-sm font-semibold text-gray-800 dark:text-white">${result.data && result.data.jurusan ? result.data.jurusan : (siswaUser.siswa ? siswaUser.siswa.jurusan : '-')}</p>
                </div>
                <div class="flex justify-between">
                    <p class="text-xs text-gray-500 dark:text-gray-400">Kelas</p>
                    <p class="text-sm font-semibold text-gray-800 dark:text-white">${siswaUser.kelas ? siswaUser.kelas.nama : '-'}</p>
                </div>
                <div class="flex justify-between">
                    <p class="text-xs text-gray-500 dark:text-gray-400">Status</p>
                    <p class="text-sm font-semibold text-green-600 dark:text-green-400">${result.data && result.data.status ? result.data.status : 'Hadir'}</p>
                </div>
                <div class="flex justify-between">
                    <p class="text-xs text-gray-500 dark:text-gray-400">Jam</p>
                    <p class="text-sm font-semibold text-gray-800 dark:text-white">${result.data ? result.data.jam : '-'}</p>
                </div>
                <div class="flex justify-between">
                    <p class="text-xs text-gray-500 dark:text-gray-400">Mapel</p>
                    <p class="text-sm font-semibold text-gray-800 dark:text-white">${result.data ? result.data.mapelNama : '-'}</p>
                </div>
            </div>
        `;
        
        showToast(result.message, 'success');
        
        // Mainkan audio feedback sukses
        playSuccessSound();
        
        // Refresh riwayat
        setTimeout(() => loadRiwayat(), 500);
    } else {
        // Gagal
        resultContent.className = 'bg-red-50 dark:bg-gray-700 rounded-lg p-6 animate-fade-in';
        resultInfo.innerHTML = `
            <div class="text-center mb-4">
                <div class="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center mx-auto mb-3">
                    <svg class="w-8 h-8 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                </div>
                <h4 class="text-lg font-bold text-red-800 dark:text-red-300">Presensi Gagal</h4>
                <p class="text-sm text-red-700 dark:text-red-400">${result.message}</p>
            </div>
            <p class="text-sm text-gray-500 dark:text-gray-400 text-center">
                Silakan coba scan ulang QR Code yang ditampilkan guru.
            </p>
        `;
        
        showToast(result.message, 'error');
    }
}

// ===== RIAWAYAT =====
async function loadRiwayat() {
    try {
        const bulan = document.getElementById('filter-bulan').value;
        const tahun = document.getElementById('filter-tahun').value;
        
        const params = {};
        if (bulan) params.bulan = bulan;
        if (tahun) params.tahun = tahun;

        const result = await API.getRiwayatPresensi(params);
        const data = result.data;
        const now = new Date();
        const bulanIni = now.getMonth() + 1;
        const tahunIni = now.getFullYear();
        
        // Update statistik
        const total = data.length;
        const mapelSet = new Set(data.map(p => p.mapelNama));
        const kehadiranBulanIni = data.filter(p => {
            const [t, b] = p.tanggal.split('-');
            return t === String(tahunIni) && b === String(bulanIni).padStart(2, '0');
        }).length;
        
        document.getElementById('stat-total').textContent = total;
        document.getElementById('stat-mapel').textContent = mapelSet.size;
        document.getElementById('stat-bulan').textContent = kehadiranBulanIni;

        // Update tabel
        const tbody = document.getElementById('riwayat-body');
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-gray-500 dark:text-gray-400">Belum ada riwayat kehadiran</td></tr>';
        } else {
            tbody.innerHTML = data.map((item, index) => `
                <tr class="table-row border-b border-gray-100 dark:border-gray-700">
                    <td class="py-3 px-4 text-gray-800 dark:text-gray-200">${index + 1}</td>
                    <td class="py-3 px-4 text-gray-800 dark:text-gray-200">${formatTanggal(item.tanggal)}</td>
                    <td class="py-3 px-4 text-gray-800 dark:text-gray-200">${item.mapelNama}</td>
                    <td class="py-3 px-4 text-gray-800 dark:text-gray-200">${item.jurusan || '-'}</td>
                    <td class="py-3 px-4 text-gray-800 dark:text-gray-200">${item.guruNama || item.siswaNama || '-'}</td>
                    <td class="py-3 px-4 text-center text-gray-800 dark:text-gray-200">${item.jam}</td>
                    <td class="py-3 px-4 text-center">
                        ${getStatusBadge(item.status || 'Hadir')}
                    </td>
                </tr>
            `).join('');
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ===== TAHUN OPTIONS =====
function loadTahunOptions() {
    const currentYear = new Date().getFullYear();
    const select = document.getElementById('filter-tahun');
    
    let options = '<option value="">Semua Tahun</option>';
    for (let year = currentYear; year >= currentYear - 5; year--) {
        options += `<option value="${year}">${year}</option>`;
    }
    select.innerHTML = options;
}