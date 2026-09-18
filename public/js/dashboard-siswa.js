// ===== DASHBOARD SISWA LOGIC =====
let html5QrCode = null;
let scanning = true;
var siswaUser = null;
let lastScanTime = 0;

document.addEventListener('DOMContentLoaded', async () => {
    // Cek autentikasi & role via Supabase Auth (fallback: sesi lokal lama)
    const user = await Auth.requireAuthAsync('siswa');
    if (!user) return;
    siswaUser = user;

    // Pastikan data akademik tersedia (migrasi data lama)
    UserStore.ensureAcademicFields();

    // Set user info
    // Set user info & identitas (Supabase bila tersedia)
    updateSiswaHeader();
    await initSiswaSupabase();
    updateSiswaHeader();

    // Set tanggal dan waktu
    updateDateTime();
    setInterval(updateDateTime, 1000);

    // Setup socket real-time (opsional; tanpa server akan no-op)
    setupSocket();

    // Scanner QR TIDAK otomatis aktif saat dashboard dibuka.
    // Kamera hanya aktif setelah siswa menekan tombol "Scan QR untuk Absen".
    setupScannerUI();

    // Load data
    loadRiwayat();
    loadTahunOptions();
    updateSiswaStats();

    // Presensi parkir: GPS nyata + geofencing (tanpa lokasi dummy)
    // Permission GPS TIDAK diminta saat halaman dibuka - hanya saat user
    // membuka section Parkir / menekan "Perbarui Lokasi" / "Absen Parkir".
    initParkingGps();
    const parkirLink = document.querySelector('a[href="#section-parkir"]');
    if (parkirLink) parkirLink.addEventListener('click', function () {
        if (!lastGpsFix) requestGpsOnce();
    });

    // Restore karcis parkir: tampilkan karcis aktif (atau terakhir keluar)
    // agar status tetap benar setelah refresh (tanpa suara — bukan aksi user).
    const activeTicket = ParkingTicketStore.getActiveTicketByStudent(siswaUser.id);
    if (activeTicket) {
        renderKarcis(activeTicket);
    } else {
        const history = ParkingTicketStore.getTicketsByStudent(siswaUser.id);
        if (history.length > 0) {
            renderKarcis(history[history.length - 1]);
        }
    }
});

// ===== LIGHT MODE (dashboard siswa selalu terang - dark mode dinonaktifkan) =====
document.documentElement.classList.remove('dark');

// ===== IDENTITAS SISWA =====
// Identitas siswa dilengkapi dari data aplikasi lokal (mupa_users).

// Tampilkan identitas siswa di header
function updateSiswaHeader() {
    if (!siswaUser) return;
    const nameEl = document.getElementById('user-name');
    const initEl = document.getElementById('user-initial');
    const nisEl = document.getElementById('user-nis');
    const kelasEl = document.getElementById('user-kelas');
    if (nameEl) nameEl.textContent = siswaUser.nama || '-';
    if (initEl) initEl.textContent = (siswaUser.nama || '?').charAt(0).toUpperCase();
    if (nisEl) nisEl.textContent = 'NIS: ' + (siswaUser.nis || '-');
    if (kelasEl) kelasEl.textContent = 'Kelas: ' + (siswaUser.kelas || '-') + ' ' + (siswaUser.jurusan || '');
}

// Lengkapi identitas siswa dari data lokal (mupa_users) bila belum ada
// (mis. ketika login via Supabase Auth, sedangkan data akademik siswa
//  ada di mupa_users / localStorage).
async function initSiswaSupabase() {
    if (!siswaUser) return false;
    const local = UserStore.getUsers().find(function (u) {
        return u.role === 'siswa' && String(u.nama || '').toLowerCase() === String(siswaUser.nama || '').toLowerCase();
    });
    if (local) {
        siswaUser.id = local.id;
        siswaUser.nis = local.nis;
        siswaUser.kelas = local.kelas;
        siswaUser.jurusan = local.jurusan;
        if (local.nama) siswaUser.nama = local.nama;
        return true;
    }
    return false;
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
    socket.on('sesi-ditutup', () => {
        showToast('Sesi presensi telah ditutup oleh guru.', 'info');
    });

    // Catatan: presensi QR kini diproses lokal via AttendanceStore,
    // tidak lagi melalui event server 'scan-result'.
}

// ===== QR SCANNER (di-trigger oleh tombol, bukan otomatis) =====
// Scanner hanya aktif setelah siswa menekan "Scan QR untuk Absen".
let isScannerActive = false;
let scannerStartPromise = null; // guard: stop() harus menunggu start() selesai (hindari exception transisi html5-qrcode)

function setupScannerUI() {
    const startBtn = document.getElementById('start-scan-btn');
    if (startBtn) startBtn.addEventListener('click', openScanner);
    const closeBtn = document.getElementById('close-scanner-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeScanner);
    const closeMain = document.getElementById('close-scanner-main');
    if (closeMain) closeMain.addEventListener('click', closeScanner);
    const btnLagi = document.getElementById('btn-scan-lagi');
    if (btnLagi) btnLagi.addEventListener('click', openScanner);
}

function openScanner() {
    if (isScannerActive) return;
    const modal = document.getElementById('scanner-modal');
    if (!modal) return;
    const scanResultCard = document.getElementById('scan-result-card');
    if (scanResultCard) scanResultCard.classList.add('hidden');
    const btnLagi = document.getElementById('btn-scan-lagi');
    if (btnLagi) btnLagi.classList.add('hidden');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setScannerStatus('OPENING', 'Menyiapkan kamera...');
    startScanner();
}

function closeScanner() {
    isScannerActive = false;
    stopScannerInternal();
    hideScannerModal();
}

function hideScannerModal() {
    const modal = document.getElementById('scanner-modal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
}

function startScanner() {
    if (typeof Html5Qrcode === 'undefined') {
        setScannerStatus('ERROR', 'Library QR Scanner gagal dimuat.');
        return;
    }
    if (isScannerActive) return;
    const isSecure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
    if (!isSecure) { setScannerStatus('ERROR', 'Kamera membutuhkan HTTPS atau localhost.'); return; }
    isScannerActive = true;
    setScannerStatus('OPENING', 'Menyiapkan kamera...');
    if (!html5QrCode) { html5QrCode = new Html5Qrcode("qr-reader"); }
    scannerStartPromise = html5QrCode.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
            const now = Date.now();
            if (!scanning || now - lastScanTime < 3000) return;
            lastScanTime = now;
            handleQRDecoded(decodedText);
        },
        () => { /* abaikan error frame */ }
    ).then(() => {
        scanning = true;
        setScannerStatus('SCANNING', 'Kamera aktif. Arahkan ke QR Code guru.');
    }).catch(err => {
        console.error('Gagal memulai scanner:', err);
        isScannerActive = false;
        setScannerStatus('ERROR', 'Camera tidak dapat digunakan. Izinkan akses kamera pada browser untuk melakukan scan QR.');
    });
}

function stopScannerInternal() {
    scanning = false;
    if (html5QrCode) {
        const doStop = function () {
            try {
                if (typeof html5QrCode.stop === 'function') {
                    html5QrCode.stop().then(function () {
                        try { if (typeof html5QrCode.clear === 'function') html5QrCode.clear(); } catch (e) { /* abaikan */ }
                    }).catch(function () {
                        try { if (typeof html5QrCode.clear === 'function') html5QrCode.clear(); } catch (e) { /* abaikan */ }
                    });
                } else if (typeof html5QrCode.clear === 'function') {
                    html5QrCode.clear();
                }
            } catch (e) { /* abaikan */ }
        };
        if (scannerStartPromise && typeof scannerStartPromise.then === 'function') {
            scannerStartPromise.then(doStop, doStop);
        } else {
            doStop();
        }
    }
}

function setScannerStatus(kind, text) {
    const dot = document.getElementById('scanner-status-dot');
    const txt = document.getElementById('scanner-status-text');
    if (txt) txt.textContent = text;
    if (dot) {
        dot.className = 'w-3 h-3 rounded-full ' + (
            kind === 'SCANNING' ? 'bg-blue-500 animate-pulse' :
            kind === 'ERROR' ? 'bg-red-500' :
            kind === 'OPENING' ? 'bg-amber-500 animate-pulse' : 'bg-slate-400'
        );
    }
}

// (Jalur Supabase Database untuk validasi & simpan presensi dihapus.
//  Presensi QR diproses sepenuhnya lokal via AttendanceStore.)

// ===== HANDLE QR DECODED =====
// Presensi QR diproses sepenuhnya lokal via AttendanceStore
// (validasi sesi, kelas/jurusan, duplikat, dan simpan record).
async function handleQRDecoded(decodedText) {
    const payload = AttendanceStore.parseQRPayload(decodedText);
    if (!payload.success) {
        showScanResult({ valid: false, message: 'QR Presensi tidak valid.' }, 'INVALID_FORMAT');
        return;
    }
    const data = payload.data || {};
    if (data.type !== 'MUPA_ATTENDANCE' || !data.sessionId) {
        showScanResult({ valid: false, message: 'QR Presensi tidak valid.' }, 'INVALID_FORMAT');
        return;
    }

    // Validasi QR: tipe, sesi, status, masa aktif (data lokal)
    const validation = AttendanceStore.validateQR(data);
    if (!validation.valid) {
        showScanResult({ valid: false, message: validation.message }, validation.kode);
        return;
    }

    const session = validation.session;

    // Validasi kelas & jurusan siswa terhadap sesi
    const match = AttendanceStore.validateStudentMatch(session, siswaUser);
    if (!match.valid) {
        showScanResult({ valid: false, message: match.message }, 'WRONG_CLASS');
        return;
    }

    // Cek duplikat
    if (AttendanceStore.isDuplicate(session.id, siswaUser.id)) {
        showScanResult({ valid: false, message: 'Anda sudah melakukan presensi untuk sesi ini.' }, 'DUPLICATE');
        return;
    }

    // Simpan presensi ke storage lokal
    const recordResult = AttendanceStore.addRecord(session, siswaUser);
    if (!recordResult.success) {
        showScanResult({ valid: false, message: recordResult.error }, 'DUPLICATE');
        return;
    }

    if (typeof ActivityLog !== 'undefined' && siswaUser) {
        ActivityLog.log('presensi_qr', 'Presensi QR ' + (session && session.mataPelajaran ? session.mataPelajaran : '-'), siswaUser.nama);
    }
    updateSiswaStats();
    showScanResult({ valid: true, message: 'Presensi Berhasil', session: session }, 'OK');
    loadRiwayat();
}

// ===== TAMPILKAN HASIL SCAN + BUNYI =====
function showScanResult(result, kode) {
    // Pause scanner agar tidak berbunyi berulang
    pauseScanner();
    // Tutup modal scanner (kamera sudah dihentikan) dan tampilkan hasil di card
    hideScannerModal();

    const resultCard = document.getElementById('scan-result-card');
    const resultContent = document.getElementById('scan-result-content');
    const resultInfo = document.getElementById('scan-result-info');
    const btnLagi = document.getElementById('btn-scan-lagi');
    if (!resultInfo || !resultCard) return;

    resultCard.classList.remove('hidden');

    if (result.valid) {
        const session = result.session;
        resultContent.className = 'bg-blue-50 rounded-lg p-6 animate-fade-in';
        resultInfo.innerHTML =
            '<div class="text-center mb-4">' +
                '<div class="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mx-auto mb-3">' +
                    '<svg class="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>' +
                    '</svg>' +
                '</div>' +
                '<h4 class="text-lg font-bold text-blue-800">âœ“ ' + result.message + '</h4>' +
                '<p class="text-sm text-blue-700">' + (session ? session.mataPelajaran : '') + '</p>' +
            '</div>' +
            '<div class="bg-white rounded-lg p-4 space-y-2">' +
                '<div class="flex justify-between"><p class="text-xs text-gray-500">Nama</p><p class="text-sm font-semibold text-gray-800">' + siswaUser.nama + '</p></div>' +
                '<div class="flex justify-between"><p class="text-xs text-gray-500">NIS</p><p class="text-sm font-semibold text-gray-800 font-mono">' + (siswaUser.nis || '-') + '</p></div>' +
                '<div class="flex justify-between"><p class="text-xs text-gray-500">Kelas/Jurusan</p><p class="text-sm font-semibold text-gray-800">' + (siswaUser.kelas || '-') + ' ' + (siswaUser.jurusan || '-') + '</p></div>' +
                '<div class="flex justify-between"><p class="text-xs text-gray-500">Mapel</p><p class="text-sm font-semibold text-gray-800">' + (session ? session.mataPelajaran : '-') + '</p></div>' +
                '<div class="flex justify-between"><p class="text-xs text-gray-500">Waktu</p><p class="text-sm font-semibold text-gray-800">' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + '</p></div>' +
            '</div>';
        playSuccessSound();
        showToast('Presensi Berhasil!', 'success');
    } else {
        resultContent.className = 'bg-red-50 rounded-lg p-6 animate-fade-in';
        resultInfo.innerHTML =
            '<div class="text-center mb-4">' +
                '<div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-3">' +
                    '<svg class="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"/>' +
                    '</svg>' +
                '</div>' +
                '<h4 class="text-lg font-bold text-red-800">âœ• ' + result.message + '</h4>' +
            '</div>' +
            '<p class="text-sm text-gray-500 text-center">Silakan coba scan ulang.</p>';
        if (kode === 'DUPLICATE' || kode === 'EXPIRED') {
            playWarningSound();
        } else {
            playErrorSound();
        }
        showToast(result.message, 'error');
    }

    if (btnLagi) btnLagi.classList.remove('hidden');
}

// Pause scanner kamera
function pauseScanner() {
    isScannerActive = false;
    stopScannerInternal();
}

// Lanjutkan / buka ulang scanner
function resumeScanner() {
    openScanner();
}

// ===== SHOW SCAN INFO (dipakai flow lama; kini tidak dipakai) =====
function showScanInfo(qrData) {
    // Alur baru menggunakan showScanResult.
}

// (showScanInfo lama dihapus - alur baru memakai showScanResult)

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

// Bunyi ERROR: dua nada pendek rendah (jelas berbeda dari sukses)
function playErrorSound() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        const now = audioContext.currentTime;
        // Beep 1: rendah (300 Hz), Beep 2 lebih rendah (200 Hz)
        playTone(300, now, 0.18, 0.35);
        playTone(200, now + 0.22, 0.28, 0.4);
    } catch (error) {
        console.warn('Audio error tidak dapat diputar:', error);
    }
}

// Bunyi PERINGATAN (beda dari sukses & error): nada tengah berulang
function playWarningSound() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        const now = audioContext.currentTime;
        playTone(440, now, 0.15, 0.3);
        playTone(440, now + 0.2, 0.15, 0.3);
    } catch (error) {
        console.warn('Audio warning tidak dapat diputar:', error);
    }
}

// ===== RIAWAYAT =====
// Dibaca dari mupa_attendance_records (localStorage) untuk siswa yang login.
function loadRiwayat() {
    const bulan = document.getElementById('filter-bulan').value;   // '1'..'12'
    const tahun = document.getElementById('filter-tahun').value;

    const semua = AttendanceStore.getRecords().filter(function (r) {
        return r.studentId === siswaUser.id;
    });
    renderRiwayat(semua, bulan, tahun);
}

// Render riwayat + statistik (dipakai jalur Supabase & lokal).
function renderRiwayat(semua, bulan, tahun) {

    // Statistik
    const now = new Date();
    const bulanIni = now.getMonth() + 1;
    const tahunIni = now.getFullYear();

    let data = semua;
    if (bulan || tahun) {
        data = data.filter(r => {
            const d = new Date(r.waktuScan);
            if (isNaN(d)) return false;
            const mOk = !bulan || (d.getMonth() + 1) === parseInt(bulan, 10);
            const yOk = !tahun || d.getFullYear() === parseInt(tahun, 10);
            return mOk && yOk;
        });
    }

    const total = semua.length;
    const mapelSet = new Set(semua.map(p => p.mataPelajaran));
    const kehadiranBulanIni = semua.filter(p => {
        const d = new Date(p.waktuScan);
        return !isNaN(d) && d.getMonth() + 1 === bulanIni && d.getFullYear() === tahunIni;
    }).length;

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-mapel').textContent = mapelSet.size;
    document.getElementById('stat-bulan').textContent = kehadiranBulanIni;

    // Update tabel (desktop) + card list (mobile)
    const tbody = document.getElementById('riwayat-body');
    const mobile = document.getElementById('riwayat-mobile');
    if (!tbody) return;
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-gray-500">Belum ada riwayat kehadiran</td></tr>';
        if (mobile) mobile.innerHTML =
            '<div class="text-center py-8">' +
            '<div class="w-12 h-12 mx-auto rounded-full bg-[#EAF1F7] flex items-center justify-center mb-3">' +
            '<svg class="w-6 h-6 text-navy-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg></div>' +
            '<p class="text-sm font-medium text-slate-600">Belum ada riwayat presensi</p>' +
            '<p class="text-xs text-slate-400 mt-1">Riwayat akan muncul setelah kamu melakukan presensi.</p></div>';
        return;
    }

    const renderOne = (item, index) => {
        const d = new Date(item.waktuScan);
        const tgl = isNaN(d) ? '-' :
            d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
        const jam = isNaN(d) ? '-' : d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        return { tgl: tgl, jam: jam, mapel: item.mataPelajaran, jurusan: (item.jurusan || '-'), guru: (item.guruNama || '-'), status: item.status || 'Hadir' };
    };

    tbody.innerHTML = data.map((item, index) => {
        const r = renderOne(item, index);
        return '<tr class="table-row border-b border-gray-100">' +
            '<td class="py-3 px-4 text-gray-800">' + (index + 1) + '</td>' +
            '<td class="py-3 px-4 text-gray-800">' + formatTanggal(r.tgl) + '</td>' +
            '<td class="py-3 px-4 text-gray-800">' + r.mapel + '</td>' +
            '<td class="py-3 px-4 text-gray-800">' + r.jurusan + '</td>' +
            '<td class="py-3 px-4 text-gray-800">' + r.guru + '</td>' +
            '<td class="py-3 px-4 text-center text-gray-800">' + r.jam + '</td>' +
            '<td class="py-3 px-4 text-center">' + getStatusBadge(r.status) + '</td>' +
        '</tr>';
    }).join('');

    // Card list untuk mobile
    if (mobile) {
        mobile.innerHTML = data.map((item, index) => {
            const r = renderOne(item, index);
            return '<div class="bg-[#F8FAFC] border border-[#E2E8F0] rounded-xl p-4">' +
                '<div class="flex items-start justify-between gap-3">' +
                '<div class="min-w-0">' +
                '<p class="font-semibold text-slate-800 text-sm truncate">' + r.mapel + '</p>' +
                '<p class="text-xs text-slate-500 mt-0.5">' + formatTanggal(r.tgl) + ' • ' + r.jam + '</p>' +
                '<p class="text-xs text-slate-400 mt-0.5">' + r.guru + ' • ' + r.jurusan + '</p>' +
                '</div>' +
                '<div class="shrink-0">' + getStatusBadge(r.status) + '</div>' +
                '</div></div>';
        }).join('');
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

// ===== PRESENSI PARKIR (GPS NYATA + GEOFENCING) =====
// - Lokasi siswa DIDAPAT lewat navigator.geolocation (permission browser).
// - TIDAK ada lokasi dummy / hardcode lokasi siswa.
// - Koordinat & radius sekolah dari SchoolSettings (mupa_settings),
//   nilainya berasal dari nilai lama project dan dapat dikoreksi Admin
//   lewat halaman Pengaturan.
const PARKING_KEY = parking_absensi_KEY();
function parking_absensi_KEY() { return 'parking_absensi'; }

// Google Maps JavaScript API (browser key - BUKAN secret/service key).
// TODO (DEVELOPER): isi Google Maps API key yang diperuntukkan untuk frontend
// (Maps JavaScript API). Key kosong = peta memakai fallback visualisasi radius,
// GPS/geofencing TETAP berfungsi normal.
const GOOGLE_MAPS_API_KEY = '';

// Titik resmi sekolah (sumber kebenaran: SchoolSettings / mupa_settings,
// default di attendance.js). Alamat resmi:
// Jl. Pakem-Turi KM 0,5, Pakem Binangun, Kec. Pakem, Kab. Sleman, DIY
const SCHOOL_ADDRESS_TEXT = 'Jl. Pakem-Turi KM 0,5<br>Pakem Binangun, Sleman, DIY';

// State peta Google (dimuat sekali - tanpa duplicate script/callback)
let gmap = null;
let gmapSchoolMarker = null;
let gmapUserMarker = null;
let gmapCircle = null;
let gmapInfoWindow = null;
let gmapLoadPromise = null;

// Format jarak: <1000 m → meter, >=1000 m → km
function formatDistance(m) {
    if (!isFinite(m)) return '-';
    return m < 1000 ? Math.round(m) + ' meter' : (m / 1000).toFixed(1).replace('.', ',') + ' km';
}

// Loader Google Maps JS API (aman dari double-load & race condition)
function loadGoogleMapsApi() {
    if (!GOOGLE_MAPS_API_KEY) return Promise.reject(new Error('NO_KEY'));
    if (window.google && window.google.maps) return Promise.resolve();
    if (gmapLoadPromise) return gmapLoadPromise;
    gmapLoadPromise = new Promise(function (resolve, reject) {
        window.__mupaGmapsReady = function () { resolve(); };
        var s = document.createElement('script');
        s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(GOOGLE_MAPS_API_KEY) + '&callback=__mupaGmapsReady&loading=async';
        s.async = true;
        s.onerror = function () { gmapLoadPromise = null; reject(new Error('LOAD_FAIL')); };
        document.head.appendChild(s);
        setTimeout(function () { reject(new Error('TIMEOUT')); }, 12000);
    });
    return gmapLoadPromise;
}

let gpsWatchId = null;
let lastGpsFix = null; // { lat, lng, accuracy, dist }

function getSchoolLocation() {
    const s = (typeof SchoolSettings !== 'undefined') ? SchoolSettings.get() : {};
    return {
        name: s.schoolName || 'SMKS Muhammadiyah Pakem',
        lat: Number(s.schoolLat),
        lng: Number(s.schoolLng),
        radiusM: Number(s.parkingRadiusM) || 100
    };
}

// Jarak haversine (meter)
function haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = function (deg) { return (deg * Math.PI) / 180; };
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function setParkingStatus(kind, text) {
    const dot = document.getElementById('parking-status-dot');
    const txt = document.getElementById('parking-status-text');
    if (txt) txt.textContent = text;
    if (dot) {
        dot.className = 'w-3 h-3 rounded-full ' + (kind === 'inside' ? 'bg-blue-500' : (kind === 'outside' || kind === 'error') ? 'bg-red-500' : 'bg-amber-500 animate-pulse');
    }
}

function setParkingButtonEnabled(enabled) {
    const btn = document.getElementById('btn-parking-absen');
    if (!btn) return;
    if (enabled) {
        btn.disabled = false;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
    } else {
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');
    }
}

// Render peta: Google Maps JavaScript API bila API key tersedia
// (marker sekolah + marker siswa + circle geofence); jika tidak:
// visualisasi radius terhitung dari GPS nyata (bukan data dummy).
function renderParkingMap(fix, school) {
    const mapEl = document.getElementById('parking-map');
    if (!mapEl) return;
    if (GOOGLE_MAPS_API_KEY) {
        initGoogleMap(school).then(function () {
            updateGoogleMapMarkers(fix, school);
            const note = document.getElementById('parking-gmaps-note');
            if (note) note.textContent = '';
        }).catch(function () {
            // Peta gagal dimuat → fallback visual, GPS/geofence TETAP berjalan
            const note = document.getElementById('parking-gmaps-note');
            if (note) note.textContent = 'Google Maps gagal dimuat. Visualisasi radius lokal digunakan.';
            renderParkingFallback(fix, school);
        });
        return;
    }
    const note = document.getElementById('parking-gmaps-note');
    if (note) note.textContent = 'Google Maps belum dikonfigurasi. Masukkan Google Maps API Key untuk menampilkan peta.';
    renderParkingFallback(fix, school);
}

// Init peta Google sekali (marker sekolah + InfoWindow alamat + circle geofence)
function initGoogleMap(school) {
    return loadGoogleMapsApi().then(function () {
        if (gmap) return true;
        var mapEl = document.getElementById('parking-map');
        if (!mapEl) return false;
        gmap = new google.maps.Map(mapEl, {
            center: { lat: school.lat, lng: school.lng },
            zoom: 17,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true
        });
        gmapInfoWindow = new google.maps.InfoWindow({
            content: '<div style="font-family:sans-serif;max-width:240px">' +
                '<p style="margin:0;font-weight:bold;color:#1E293B">' + school.name + '</p>' +
                '<p style="margin:4px 0 0;font-size:12px;color:#64748B">' + SCHOOL_ADDRESS_TEXT + '</p></div>'
        });
        gmapSchoolMarker = new google.maps.Marker({
            position: { lat: school.lat, lng: school.lng },
            map: gmap,
            title: school.name
        });
        gmapSchoolMarker.addListener('click', function () {
            gmapInfoWindow.open({ anchor: gmapSchoolMarker, map: gmap });
        });
        gmapCircle = new google.maps.Circle({
            map: gmap,
            center: { lat: school.lat, lng: school.lng },
            radius: school.radiusM,
            strokeColor: '#315A7D',
            strokeOpacity: 0.8,
            strokeWeight: 2,
            fillColor: '#315A7D',
            fillOpacity: 0.12
        });
        return true;
    });
}

// Marker siswa (biru/indigo) - dibuat sekali lalu di-update posisinya
function updateGoogleMapMarkers(fix, school) {
    if (!gmap || !fix) return;
    var pos = { lat: fix.lat, lng: fix.lng };
    if (!gmapUserMarker) {
        gmapUserMarker = new google.maps.Marker({
            position: pos,
            map: gmap,
            title: 'Lokasi Anda',
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 9,
                fillColor: '#4F46E5',
                fillOpacity: 1,
                strokeColor: '#FFFFFF',
                strokeWeight: 2
            }
        });
    } else {
        gmapUserMarker.setPosition(pos);
    }
}

// Fallback visual (dipakai saat API key kosong / peta gagal dimuat)
function renderParkingFallback(fix, school) {
    const mapEl = document.getElementById('parking-map');
    if (!mapEl) return;
    if (!fix) {
        mapEl.innerHTML = '<div class="flex items-center justify-center h-full"><p class="text-slate-400">Menunggu lokasi GPS Anda...</p></div>';
        return;
    }
    const maxM = Math.max(school.radiusM * 2.2, fix.dist * 1.4, 10);
    const cx = 50, cy = 46;
    const radiusPct = (school.radiusM / maxM) * 44;
    const userPct = Math.min(46, (fix.dist / maxM) * 46);
    const dLat = fix.lat - school.lat;
    const dLng = fix.lng - school.lng;
    const angle = Math.atan2(dLng, dLat);
    const ux = cx + Math.sin(angle) * userPct;
    const uy = cy - Math.cos(angle) * userPct;
    const inside = fix.dist <= school.radiusM;
    mapEl.innerHTML =
        '<div class="relative w-full h-full min-h-[240px]">' +
        '<div class="absolute rounded-full bg-blue-100/60 border-2 border-blue-300" style="left:' + (cx - radiusPct) + '%;top:' + (cy - radiusPct) + '%;width:' + (radiusPct * 2) + '%;height:' + (radiusPct * 2) + '%"></div>' +
        '<div class="absolute -translate-x-1/2 -translate-y-1/2 text-center" style="left:' + cx + '%;top:' + cy + '%">' +
        '<div class="w-4 h-4 rounded-full bg-navy-700 border-2 border-white shadow mx-auto"></div>' +
        '<p class="text-[10px] font-semibold text-navy-700 mt-1 whitespace-nowrap">' + school.name + '</p></div>' +
        '<div class="absolute -translate-x-1/2 -translate-y-1/2 text-center" style="left:' + ux + '%;top:' + uy + '%">' +
        '<div class="w-4 h-4 rounded-full ' + (inside ? 'bg-indigo-500' : 'bg-red-400') + ' border-2 border-white shadow mx-auto animate-pulse"></div>' +
        '<p class="text-[10px] font-semibold ' + (inside ? 'text-indigo-600' : 'text-red-500') + ' mt-1 whitespace-nowrap">Lokasi Anda</p></div>' +
        '<div class="absolute bottom-2 left-3 text-[10px] text-slate-400">Skala visual: ' + Math.round(maxM) + ' m (dihitung dari GPS nyata)</div></div>';
}

function updateParkingUi(fix, school) {
    const set = function (id, v) { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('gps-lat', fix ? fix.lat.toFixed(6) : '-');
    set('gps-lng', fix ? fix.lng.toFixed(6) : '-');
    set('gps-acc', fix && fix.accuracy ? '±' + Math.round(fix.accuracy) + ' meter' : '-');
    set('gps-dist', fix && isFinite(fix.dist) ? formatDistance(fix.dist) : '-');
    // Link Google Maps menuju titik resmi sekolah (koordinat resmi, bukan random)
    const link = document.getElementById('parking-gmaps-link');
    if (link) link.href = 'https://www.google.com/maps/search/?api=1&query=' + school.lat + ',' + school.lng;
    const inside = fix && isFinite(fix.dist) && fix.dist <= school.radiusM;
    if (fix && fix.accuracy && fix.accuracy > 100) {
        // Akurasi buruk: jangan anggap siswa di sekolah — minta coba lagi
        setParkingStatus('wait', 'Akurasi GPS rendah (±' + Math.round(fix.accuracy) + ' m). Silakan pindah ke area terbuka dan coba lagi.');
        setParkingButtonEnabled(false);
    } else if (inside) {
        setParkingStatus('inside', 'Anda berada di area sekolah (' + formatDistance(fix.dist) + ' dari sekolah)');
        setParkingButtonEnabled(true);
    } else if (fix && isFinite(fix.dist)) {
        setParkingStatus('outside', 'Anda berada di luar area sekolah (' + formatDistance(fix.dist) + ')');
        setParkingButtonEnabled(false);
    }
    renderParkingMap(fix, school);
}

function handleGpsPosition(pos) {
    const school = getSchoolLocation();
    const fix = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        dist: (isFinite(school.lat) && isFinite(school.lng)) ? haversineMeters(pos.coords.latitude, pos.coords.longitude, school.lat, school.lng) : null
    };
    lastGpsFix = fix;
    updateParkingUi(fix, school);
}

function handleGpsError(err) {
    setParkingButtonEnabled(false);
    renderParkingMap(null, getSchoolLocation());
    if (err && err.code === err.PERMISSION_DENIED) {
        setParkingStatus('error', 'Izin lokasi diperlukan untuk melakukan presensi parkir.');
    } else if (err && err.code === err.POSITION_UNAVAILABLE) {
        setParkingStatus('error', 'Lokasi tidak tersedia. Pastikan GPS aktif lalu coba lagi.');
    } else {
        setParkingStatus('error', 'Gagal membaca lokasi. Silakan coba lagi.');
    }
}

function initParkingGps() {
    const school = getSchoolLocation();
    const link = document.getElementById('parking-gmaps-link');
    if (link) link.href = 'https://www.google.com/maps/search/?api=1&query=' + school.lat + ',' + school.lng;
    if (!isFinite(school.lat) || !isFinite(school.lng)) {
        setParkingStatus('error', 'Koordinat sekolah belum dikonfigurasi. Hubungi Admin (Pengaturan).');
        setParkingButtonEnabled(false);
        return;
    }
    if (!('geolocation' in navigator)) {
        setParkingStatus('error', 'Browser Anda tidak mendukung GPS (geolocation).');
        setParkingButtonEnabled(false);
    } else {
        setParkingStatus('wait', 'Menunggu lokasi GPS. Klik "Perbarui Lokasi" untuk mengambil lokasi Anda.');
    }
    // Init peta + marker sekolah TANPA meminta permission GPS (spec: permission
    // hanya diminta saat user membuka bagian parkir / menekan "Perbarui Lokasi").
    renderParkingMap(null, school);
}

// Ambil GPS sekali (dipicu tombol "Perbarui Lokasi" / membuka section parkir)
function requestGpsOnce() {
    if (!('geolocation' in navigator)) {
        setParkingStatus('error', 'Browser Anda tidak mendukung GPS (geolocation).');
        setParkingButtonEnabled(false);
        return;
    }
    const btn = document.getElementById('btn-gps-refresh');
    const label = document.getElementById('btn-gps-refresh-label');
    const orig = label ? label.textContent : '';
    if (btn) btn.disabled = true;
    if (label) label.textContent = 'Mencari lokasi...';
    setParkingStatus('wait', 'Menunggu lokasi GPS...');
    navigator.geolocation.getCurrentPosition(function (pos) {
        if (btn) btn.disabled = false;
        if (label) label.textContent = orig;
        handleGpsPosition(pos);
    }, function (err) {
        if (btn) btn.disabled = false;
        if (label) label.textContent = orig;
        handleGpsError(err);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
}

function refreshGpsLocation() { requestGpsOnce(); }

function absensiParking() {
    const result = document.getElementById('parking-result');
    const msg = document.getElementById('parking-result-msg');
    const detail = document.getElementById('parking-result-detail');
    if (!result || !msg || !detail) return;
    const school = getSchoolLocation();
    if (!lastGpsFix) { showToast('Menunggu lokasi Anda...', 'warning'); return; }
    // Guard akurasi GPS: jangan proses absensi bila akurasi terlalu buruk
    if (lastGpsFix.accuracy && lastGpsFix.accuracy > 100) {
        result.classList.remove('hidden');
        result.className = 'mt-4 p-4 bg-amber-50 border border-amber-100 rounded-lg';
        msg.textContent = 'Akurasi GPS terlalu rendah!';
        msg.className = 'font-semibold text-amber-800';
        detail.textContent = 'Akurasi ±' + Math.round(lastGpsFix.accuracy) + ' m. Pindah ke area terbuka lalu klik "Perbarui Lokasi".';
        showToast('Akurasi GPS rendah. Pindah ke area terbuka dan coba lagi.', 'warning');
        return;
    }
    const inRadius = isFinite(lastGpsFix.dist) && lastGpsFix.dist <= school.radiusM;
    result.classList.remove('hidden');
    if (!inRadius) {
        result.className = 'mt-4 p-4 bg-red-50 border border-red-100 rounded-lg';
        msg.textContent = 'Di luar area presensi!';
        msg.className = 'font-semibold text-red-800';
        detail.textContent = 'Anda berada ' + Math.round(lastGpsFix.dist) + ' m dari sekolah. Dekati area sekolah lalu coba lagi.';
        showToast('Lokasi Anda berada di luar area sekolah.', 'error');
        return;
    }
    const timestamp = new Date().toISOString();
    const record = {
        userId: siswaUser ? siswaUser.id : '-',
        nama: siswaUser ? siswaUser.nama : '-',
        lat: lastGpsFix.lat,
        lng: lastGpsFix.lng,
        jarakM: Math.round(lastGpsFix.dist),
        status: 'Hadir',
        timestamp: timestamp
    };
    try {
        const list = JSON.parse(localStorage.getItem(PARKING_KEY) || '[]');
        list.push(record);
        localStorage.setItem(PARKING_KEY, JSON.stringify(list));
    } catch (e) { /* riwayat lokal gagal simpan: jangan blokir presensi */ }
    if (typeof ActivityLog !== 'undefined' && siswaUser) {
        ActivityLog.log('presensi_parkir', 'Presensi parkir dicatat (' + Math.round(lastGpsFix.dist) + ' m)', siswaUser.nama);
    }
    result.className = 'mt-4 p-4 bg-blue-50 border border-blue-100 rounded-lg';
    msg.textContent = 'Presensi parkir berhasil dicatat!';
    msg.className = 'font-semibold text-blue-800';
    detail.textContent = 'Anda berada dalam radius (' + Math.round(lastGpsFix.dist) + ' m). Jam: ' + new Date().toLocaleTimeString('id-ID');
    setParkingStatus('inside', 'Tercatat! Anda berada dalam radius parkir (' + Math.round(lastGpsFix.dist) + ' m).');
    showToast('Presensi parkir berhasil dicatat.', 'success');
}

function cekRiwayatParking() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(PARKING_KEY) || '[]'); } catch (e) { list = []; }
    if (list.length === 0) { showToast('Belum ada riwayat absensi parkir.', 'warning'); return; }
    const last = list[list.length - 1];
    showToast('Riwayat terakhir: ' + last.status + ' - ' + new Date(last.timestamp).toLocaleString('id-ID'), 'info');
}

// ============================================================
// KARCIS PARKIR DIGITAL (MASUK / KELUAR KENDARAAN)
// Data via ParkingTicketStore (mupa_parking_tickets).
// Audio dipicu dari event klik (bukan autoplay) dan selalu
// dibungkus try/catch agar kegagalan audio tidak mengganggu
// proses parkir.
// ============================================================

// Bunyi KENDARAAN MASUK: beep pendek 1x (tinggi)
function playEntrySound() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') audioContext.resume();
        const now = audioContext.currentTime;
        playTone(880, now, 0.15, 0.35); // satu beep pendek tinggi
    } catch (error) {
        console.warn('Audio masuk gagal dimainkan:', error);
    }
}

// Bunyi KENDARAAN KELUAR BERHASIL: beep-beep-beep (3x pendek, pola gate parkir)
function playExitSuccessSound() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') audioContext.resume();
        const now = audioContext.currentTime;
        playTone(1000, now, 0.12, 0.4);
        playTone(1000, now + 0.20, 0.12, 0.4);
        playTone(1400, now + 0.40, 0.20, 0.45);
    } catch (error) {
        console.warn('Audio keluar gagal dimainkan:', error);
    }
}

// Bunyi ERROR parkir: beep rendah cepat 3x (pola berbeda dari sukses & QR)
function playParkirErrorSound() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') audioContext.resume();
        const now = audioContext.currentTime;
        playTone(220, now, 0.10, 0.4);
        playTone(220, now + 0.15, 0.10, 0.4);
        playTone(180, now + 0.30, 0.18, 0.45);
    } catch (error) {
        console.warn('Audio error parkir gagal dimainkan:', error);
    }
}

// Render kartu karcis digital
function renderKarcis(ticket) {
    const card = document.getElementById('karcis-card');
    if (!card) return;
    card.classList.remove('hidden');

    const isOut = ticket.status === 'SUDAH KELUAR';
    const badge = isOut
        ? '<span class="px-3 py-1 rounded-full text-xs font-bold bg-gray-200 text-gray-700">⚪ SUDAH KELUAR</span>'
        : '<span class="px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800">SEDANG PARKIR</span>';

    const tampil = function (d) {
        if (!d) return '-';
        const dt = new Date(d);
        return isNaN(dt.getTime()) ? '-' : dt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    };

    card.innerHTML =
        '<div class="bg-white border-2 ' +
            (isOut ? 'border-gray-300' : 'border-navy-400') +
            ' rounded-xl p-5 animate-fade-in">' +
            '<div class="flex items-center justify-between mb-4">' +
                '<div>' +
                    '<p class="text-xs uppercase tracking-widest text-gray-400">Karcis Parkir Digital</p>' +
                    '<p class="text-lg font-bold text-gray-800">MUPA PARKING</p>' +
                '</div>' +
                badge +
            '</div>' +
            '<div class="space-y-2 text-sm">' +
                '<div class="flex justify-between border-b border-gray-100 pb-1">' +
                    '<span class="text-gray-500">Ticket ID</span>' +
                    '<span class="font-mono font-bold text-gray-800">' + ticket.id + '</span>' +
                '</div>' +
                '<div class="flex justify-between border-b border-gray-100 pb-1">' +
                    '<span class="text-gray-500">Plat Nomor</span>' +
                    '<span class="font-bold text-gray-800">' + ticket.plat + '</span>' +
                '</div>' +
                '<div class="flex justify-between border-b border-gray-100 pb-1">' +
                    '<span class="text-gray-500">Pemilik</span>' +
                    '<span class="font-semibold text-gray-800">' + ticket.studentNama + '</span>' +
                '</div>' +
                '<div class="flex justify-between border-b border-gray-100 pb-1">' +
                    '<span class="text-gray-500">Waktu Masuk</span>' +
                    '<span class="font-semibold text-gray-800">' + tampil(ticket.waktuMasuk) + '</span>' +
                '</div>' +
                (ticket.waktuKeluar
                    ? '<div class="flex justify-between border-b border-gray-100 pb-1">' +
                        '<span class="text-gray-500">Waktu Keluar</span>' +
                        '<span class="font-semibold text-gray-800">' + tampil(ticket.waktuKeluar) + '</span>' +
                    '</div>' : '') +
                '<div class="flex justify-between border-b border-gray-100 pb-1">' +
                    '<span class="text-gray-500">Durasi</span>' +
                    '<span class="font-semibold text-gray-800">' +
                        ParkingTicketStore.getDurasiText(ticket.waktuMasuk, ticket.waktuKeluar) +
                    '</span>' +
                '</div>' +
                '<div class="flex justify-between">' +
                    '<span class="text-gray-500">Status</span>' +
                    '<span class="font-semibold text-gray-800">' + ticket.status + '</span>' +
                '</div>' +
            '</div>' +
        '</div>';
}

// KENDARAAN MASUK
function parkirMasuk() {
    const platInput = document.getElementById('parkir-plat');
    const plat = platInput ? platInput.value.trim() : '';

    if (!plat) {
        playParkirErrorSound();
        showToast('Plat nomor wajib diisi.', 'warning');
        return;
    }

    const result = ParkingTicketStore.createTicket({
        studentId: siswaUser.id,
        nama: siswaUser.nama,
        nis: siswaUser.nis || '-',
        plat: plat
    });

    if (!result.success) {
        // Kendaraan sudah terdaftar parkir / plat tidak valid
        playParkirErrorSound();
        showToast('❌ ' + result.error, 'error');
        return;
    }

    if (platInput) platInput.value = '';
    ActivityLog.log('parkir_masuk', 'Karcis ' + result.ticket.id + ' (' + result.ticket.plat + ')', siswaUser.nama);
    renderKarcis(result.ticket);
    playEntrySound(); // audio hanya feedback; kegagalan tidak mempengaruhi proses
    showToast('✅ Kendaraan masuk. Karcis dibuat: ' + result.ticket.id, 'success');
}

// KENDARAAN KELUAR
function karcisKeluar() {
    const active = ParkingTicketStore.getActiveTicketByStudent(siswaUser.id);

    // Tidak ada kendaraan yang sedang parkir
    if (!active) {
        playParkirErrorSound();
        showToast('❌ Tidak ada kendaraan yang sedang parkir.', 'error');
        return;
    }

    const result = ParkingTicketStore.processExit(active.id, siswaUser.id);

    if (!result.success) {
        // Jangan ubah status / catat waktu keluar / hapus ticket
        playParkirErrorSound();
        showToast('❌ ' + result.error, 'error');
        return;
    }

    // Berhasil: karcis diperbarui ke SUDAH KELUAR + durasi tercatat
    ActivityLog.log('parkir_keluar', 'Kendaraan keluar, karcis ' + result.ticket.id, siswaUser.nama);
    renderKarcis(result.ticket);
    playExitSuccessSound();
    showToast('✅ Kendaraan berhasil keluar.', 'success');
}

// ===== STATUS & STATISTIK SISWA (data lokal aktual) =====
function updateSiswaStats() {
    if (!siswaUser || typeof AttendanceStore === 'undefined') return;
    const semua = AttendanceStore.getRecords().filter(function (r) { return r.studentId === siswaUser.id; });
    const norm = function (s) { return String(s || 'hadir').toLowerCase(); };
    const hadir = semua.filter(function (r) { return norm(r.status) === 'hadir'; }).length;
    const izin = semua.filter(function (r) { return norm(r.status) === 'izin'; }).length;
    const sakit = semua.filter(function (r) { return norm(r.status) === 'sakit'; }).length;
    const alpa = semua.filter(function (r) { const s = norm(r.status); return s === 'alpa' || s === 'tidak hadir'; }).length;
    const terlambat = semua.filter(function (r) { return norm(r.status) === 'terlambat'; }).length;
    const set = function (id, v) { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('stat-total', hadir);
    set('sw-total-izin', izin);
    set('sw-total-sakit', sakit);
    set('sw-total-alpa', alpa);

    // Ringkasan Kehadiran (progress bar - data asli, tanpa dummy)
    const totalSemua = hadir + izin + sakit + alpa + terlambat;
    const counts = { 'sw-count-hadir': hadir, 'sw-count-terlambat': terlambat, 'sw-count-izin': izin, 'sw-count-sakit': sakit, 'sw-count-alpa': alpa };
    Object.keys(counts).forEach(function (id) { set(id, counts[id]); });
    const pct = function (n) { return totalSemua ? Math.round((n / totalSemua) * 100) + '%' : '0%'; };
    const bars = { 'sw-bar-hadir': pct(hadir), 'sw-bar-terlambat': pct(terlambat), 'sw-bar-izin': pct(izin), 'sw-bar-sakit': pct(sakit), 'sw-bar-alpa': pct(alpa) };
    Object.keys(bars).forEach(function (id) { const el = document.getElementById(id); if (el) el.style.width = bars[id]; });
    const emptyEl = document.getElementById('sw-ringkasan-empty');
    const bodyEl = document.getElementById('sw-ringkasan-body');
    if (emptyEl && bodyEl) {
        if (totalSemua === 0) { emptyEl.classList.remove('hidden'); bodyEl.classList.add('hidden'); }
        else { emptyEl.classList.add('hidden'); bodyEl.classList.remove('hidden'); }
    }
    const today = new Date();
    const tkey = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const hariIni = semua.some(function (r) {
        const d = new Date(r.waktuScan);
        return !isNaN(d) && tkey(d) === tkey(today);
    });
    set('sw-hari-ini', hariIni ? 'Sudah' : 'Belum');
    const dot = document.getElementById('sw-presensi-dot');
    const txt = document.getElementById('sw-presensi-status-text');
    if (dot) dot.className = 'w-2 h-2 rounded-full ' + (hariIni ? 'bg-blue-500' : 'bg-amber-500');
    if (txt) txt.textContent = hariIni ? 'Presensi hari ini sudah tercatat. Terima kasih!' : 'Anda belum melakukan presensi hari ini.';
}

// ===== EXPORT RIWAYAT SISWA (CSV, kompatibel Excel) =====
function exportRiwayatSiswa() {
    const tbody = document.getElementById('riwayat-body');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr');
    if (rows.length === 0 || rows[0].querySelectorAll('td').length <= 1) {
        showToast('Belum ada riwayat untuk diexport.', 'warning');
        return;
    }
    const heads = Array.prototype.map.call(document.querySelectorAll('#section-riwayat thead th'), function (th) { return th.textContent.trim(); });
    const out = [heads];
    rows.forEach(function (tr) {
        out.push(Array.prototype.map.call(tr.querySelectorAll('td'), function (td) { return td.textContent.trim(); }));
    });
    const csv = out.map(function (r) { return r.map(function (v) { return '"' + String(v).replace(/'"'/g, '""') + '"'; }).join(';'); }).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'riwayat-presensi-siswa-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
