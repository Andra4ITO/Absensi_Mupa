// ===== DASHBOARD GURU LOGIC =====
let currentSesi = null;
let daftarHadir = [];
let guruUser = null;

document.addEventListener('DOMContentLoaded', () => {
    // Cek autentikasi
    const user = API.getUser();
    if (!user || user.role !== 'guru') {
        window.location.href = '/';
        return;
    }
    guruUser = user;

    // Set user info
    document.getElementById('user-name').textContent = user.nama;

    // Load data
    loadMapelGuru();
    loadKelas();
    loadSesiAktif();
    loadRiwayatSesi();

    // Setup socket real-time
    setupSocket();

    // Setup form
    document.getElementById('form-buka-sesi').addEventListener('submit', bukaSesi);
});

// ===== DARK MODE =====
function toggleDarkMode() {
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    localStorage.setItem('darkMode', isDark);
}

// ===== LOAD MAPEL =====
async function loadMapelGuru() {
    try {
        const result = await API.getMapelByGuru(guruUser.refId);
        const select = document.getElementById('select-mapel');
        
        if (result.data.length === 0) {
            select.innerHTML = '<option value="">Tidak ada mapel diampu</option>';
        } else {
            select.innerHTML = '<option value="">Pilih Mata Pelajaran</option>' +
                result.data.map(m => `<option value="${m.id}">${m.nama} (${m.kode})</option>`).join('');
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ===== LOAD KELAS =====
async function loadKelas() {
    try {
        const result = await API.getKelas();
        const select = document.getElementById('select-kelas');
        select.innerHTML = '<option value="">Pilih Kelas</option>' +
            result.data.map(k => `<option value="${k.id}">${k.nama}</option>`).join('');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ===== BUKA SESI =====
async function bukaSesi(e) {
    e.preventDefault();
    
    const mapelId = document.getElementById('select-mapel').value;
    const kelasId = document.getElementById('select-kelas').value;

    if (!mapelId || !kelasId) {
        showToast('Pilih mata pelajaran dan kelas terlebih dahulu.', 'warning');
        return;
    }

    try {
        const result = await API.bukaSesi({ mapelId, kelasId });
        currentSesi = result.data;
        
        // Tampilkan QR Code
        document.getElementById('qr-image').src = currentSesi.qrCodeDataUrl;
        document.getElementById('sesi-mapel').textContent = currentSesi.mapelNama;
        document.getElementById('sesi-kode').textContent = currentSesi.mapelKode;
        document.getElementById('sesi-kelas').textContent = currentSesi.kelasNama;
        document.getElementById('sesi-waktu').textContent = formatDateTime(currentSesi.dibukaPada);
        document.getElementById('jumlah-hadir').textContent = '0';
        
        document.getElementById('form-sesi-card').classList.add('hidden');
        document.getElementById('qr-sesi-card').classList.remove('hidden');
        document.getElementById('daftar-hadir-card').classList.remove('hidden');
        
        daftarHadir = [];
        renderDaftarHadir();
        
        showToast(result.message, 'success');
        loadRiwayatSesi();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ===== TUTUP SESI =====
async function tutupSesi() {
    if (!currentSesi) return;
    
    if (confirm(`Tutup sesi ${currentSesi.mapelNama} - ${currentSesi.kelasNama}?`)) {
        try {
            const result = await API.tutupSesi(currentSesi.id);
            
            showToast(result.message, 'success');
            
            // Broadcast ke siswa via socket
            const socket = getSocket();
            if (socket) {
                socket.emit('sesi-ditutup', { sesiId: currentSesi.id });
            }
            
            currentSesi = null;
            daftarHadir = [];
            
            document.getElementById('qr-sesi-card').classList.add('hidden');
            document.getElementById('daftar-hadir-card').classList.add('hidden');
            document.getElementById('form-sesi-card').classList.remove('hidden');
            
            loadRiwayatSesi();
        } catch (error) {
            showToast(error.message, 'error');
        }
    }
}

// ===== LOAD SESI AKTIF =====
async function loadSesiAktif() {
    try {
        const result = await API.getSesiAktifGuru(guruUser.refId);
        
        if (result.data.length > 0) {
            const sesi = result.data[0];
            currentSesi = sesi;
            
            // Tampilkan QR jika ada di memory (perlu fetch QR data)
            await loadSesiQR(sesi);
            
            document.getElementById('form-sesi-card').classList.add('hidden');
            document.getElementById('qr-sesi-card').classList.remove('hidden');
            document.getElementById('daftar-hadir-card').classList.remove('hidden');
            
            document.getElementById('sesi-mapel').textContent = sesi.mapelNama;
            document.getElementById('sesi-kode').textContent = sesi.mapelKode;
            document.getElementById('sesi-kelas').textContent = sesi.kelasNama;
            document.getElementById('sesi-waktu').textContent = formatDateTime(sesi.dibukaPada);
            document.getElementById('jumlah-hadir').textContent = sesi.jumlahHadir || 0;
            
            // Load daftar hadir
            await loadDaftarHadir(sesi.id);
        }
    } catch (error) {
        console.error('Load sesi aktif error:', error);
    }
}

// ===== LOAD SESI QR (untuk restore sesi aktif) =====
async function loadSesiQR(sesi) {
    try {
        const detail = await API.getSesiDetail(sesi.id);
        const sesiDetail = detail.data;
        
        // Regenerate QR dari data sesi
        const qrData = JSON.stringify({
            type: 'PRESENSI_SESI',
            sesiId: sesiDetail.id,
            token: sesiDetail.token,
            mapel: sesiDetail.mapelNama,
            guru: sesiDetail.guruNama,
            kelas: sesiDetail.kelasNama,
            timestamp: sesiDetail.dibukaPada
        });
        
        // Load qrcode dari CDN dan generate
        loadQRCodeLibrary(qrData);
        
        currentSesi = sesiDetail;
    } catch (error) {
        console.error('Load sesi QR error:', error);
    }
}

// ===== QR CODE LIBRARY CDN =====
function loadQRCodeLibrary(qrData) {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
    script.onload = () => {
        QRCode.toDataURL(qrData, { width: 256, margin: 1 })
            .then(url => {
                document.getElementById('qr-image').src = url;
            })
            .catch(err => console.error('QR generate error:', err));
    };
    document.head.appendChild(script);
}

// ===== LOAD DAFTAR HADIR =====
async function loadDaftarHadir(sesiId) {
    try {
        const result = await API.getSesiDetail(sesiId);
        daftarHadir = result.data.kehadiran || [];
        renderDaftarHadir();
    } catch (error) {
        console.error('Load daftar hadir error:', error);
    }
}

// ===== RENDER DAFTAR HADIR =====
function renderDaftarHadir() {
    const tbody = document.getElementById('daftar-hadir-body');
    
    if (daftarHadir.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-gray-500 dark:text-gray-400">Belum ada siswa yang hadir</td></tr>';
        return;
    }
    
    tbody.innerHTML = daftarHadir.map((log, index) => `
        <tr class="table-row border-b border-gray-100 dark:border-gray-700 animate-fade-in">
            <td class="py-3 px-4 text-gray-800 dark:text-gray-200">${index + 1}</td>
            <td class="py-3 px-4 text-gray-800 dark:text-gray-200">${log.siswaNis}</td>
            <td class="py-3 px-4">
                <div class="flex items-center gap-2">
                    <div class="w-8 h-8 rounded-full bg-muhammadiyah-100 dark:bg-muhammadiyah-900 flex items-center justify-center">
                        <span class="text-sm font-bold text-muhammadiyah-700 dark:text-muhammadiyah-300">${log.siswaNama.charAt(0)}</span>
                    </div>
                    <span class="text-gray-800 dark:text-gray-200">${log.siswaNama}</span>
                </div>
            </td>
            <td class="py-3 px-4 text-center">
                <span class="text-xs text-gray-500 dark:text-gray-400">${log.jam}</span>
            </td>
        </tr>
    `).join('');
}

// ===== LOAD RIWAYAT SESI =====
async function loadRiwayatSesi() {
    try {
        const result = await API.getRiwayatSesi(guruUser.refId);
        const data = result.data;
        const tbody = document.getElementById('riwayat-sesi-body');
        
        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500 dark:text-gray-400">Belum ada sesi presensi</td></tr>';
        } else {
            tbody.innerHTML = data.slice(0, 10).map(sesi => `
                <tr class="table-row border-b border-gray-100 dark:border-gray-700">
                    <td class="py-3 px-4 text-gray-800 dark:text-gray-200">${sesi.mapelNama}</td>
                    <td class="py-3 px-4 text-gray-800 dark:text-gray-200">${sesi.kelasNama}</td>
                    <td class="py-3 px-4 text-center">${getStatusBadge(sesi.status)}</td>
                    <td class="py-3 px-4 text-center text-gray-800 dark:text-gray-200">${sesi.jumlahHadir}</td>
                    <td class="py-3 px-4 text-center text-xs text-gray-500 dark:text-gray-400">${formatDateTime(sesi.dibukaPada)}</td>
                </tr>
            `).join('');
        }
    } catch (error) {
        console.error('Load riwayat sesi error:', error);
    }
}

// ===== SOCKET.IO SETUP =====
function setupSocket() {
    const socket = initSocket(guruUser);
    
    // Terima event presensi baru
    socket.on('presensi-bar', (data) => {
        if (!currentSesi || data.sesiId !== currentSesi.id) return;
        
        // Tambahkan ke daftar hadir
        daftarHadir.push(data);
        document.getElementById('jumlah-hadir').textContent = daftarHadir.length;
        renderDaftarHadir();
        
        showToast(`${data.siswaNama} hadir!`, 'success');
    });
    
    // Terima update sesi
    socket.on('sesi-update', (data) => {
        if (currentSesi && data.sesiId === currentSesi.id) {
            document.getElementById('jumlah-hadir').textContent = data.jumlahHadir;
        }
    });
    
    // Auto load jika ada sesi
    loadSesiAktif();
}