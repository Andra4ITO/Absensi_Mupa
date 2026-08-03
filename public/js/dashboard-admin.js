// ===== DASHBOARD ADMIN LOGIC =====
let adminUser = null;

document.addEventListener('DOMContentLoaded', () => {
    // Cek autentikasi
    const user = API.getUser();
    if (!user || user.role !== 'admin') {
        window.location.href = '/';
        return;
    }
    adminUser = user;

    // Set user info
    document.getElementById('user-name').textContent = user.nama;

    // Load data awal
    loadDashboard();
    loadRekapMapel();
    loadRekapDetail();
    loadSesiAktif();
    loadOptions();
    loadTahunOptions();

    // Setup socket real-time
    setupSocket();
});

// ===== DARK MODE =====
function toggleDarkMode() {
    document.documentElement.classList.toggle('dark');
    const isDark = document.documentElement.classList.contains('dark');
    localStorage.setItem('darkMode', isDark);
}

// ===== LOAD DASHBOARD =====
async function loadDashboard() {
    try {
        const result = await API.getDashboard();
        const data = result.data.statistik;
        
        document.getElementById('stat-siswa').textContent = data.totalSiswa;
        document.getElementById('stat-guru').textContent = data.totalGuru;
        document.getElementById('stat-mapel').textContent = data.totalMapel;
        document.getElementById('stat-sesi-aktif').textContent = data.sesiAktif;
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ===== LOAD REKAP PER MAPEL =====
async function loadRekapMapel() {
    try {
        const bulan = document.getElementById('filter-bulan').value;
        const tahun = document.getElementById('filter-tahun').value;
        
        const params = {};
        if (bulan) params.bulan = bulan;
        if (tahun) params.tahun = tahun;

        const result = await API.getRekapPerMapel(params);
        const data = result.data;
        const tbody = document.getElementById('rekap-mapel-body');

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-gray-500 dark:text-gray-400">Belum ada data kehadiran</td></tr>';
        } else {
            tbody.innerHTML = data.map((item, index) => `
                <tr class="table-row border-b border-gray-100 dark:border-gray-700">
                    <td class="py-3 px-4 text-gray-800 dark:text-gray-200">${index + 1}</td>
                    <td class="py-3 px-4">
                        <div class="flex items-center gap-2">
                            <div class="w-8 h-8 rounded-full bg-muhammadiyah-100 dark:bg-muhammadiyah-900 flex items-center justify-center">
                                <span class="text-sm font-bold text-muhammadiyah-700 dark:text-muhammadiyah-300">${getMapelInitial(item.mapelNama)}</span>
                            </div>
                            <div>
                                <p class="text-gray-800 dark:text-gray-200 font-semibold">${item.mapelNama}</p>
                                <p class="text-xs text-gray-500 dark:text-gray-400">${item.mapelKode}</p>
                            </div>
                        </div>
                    </td>
                    <td class="py-3 px-4 text-gray-800 dark:text-gray-200">${item.guruNama}</td>
                    <td class="py-3 px-4 text-center text-gray-800 dark:text-gray-200">${item.sesiCount}</td>
                    <td class="py-3 px-4 text-center text-blue-600 dark:text-blue-400 font-semibold">${item.totalKehadiran}</td>
                    <td class="py-3 px-4 text-center text-green-600 dark:text-green-400 font-semibold">${item.siswaUnik}</td>
                </tr>
            `).join('');
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ===== LOAD REKAP DETAIL =====
async function loadRekapDetail() {
    try {
        const tanggal = document.getElementById('filter-tanggal').value;
        const mapelId = document.getElementById('filter-mapel').value;
        const kelasId = document.getElementById('filter-kelas').value;
        
        const params = {};
        if (tanggal) params.tanggal = tanggal;
        if (mapelId) params.mapelId = mapelId;
        if (kelasId) params.kelasId = kelasId;

        const result = await API.getRekapPresensi(params);
        const data = result.data;
        const statistik = result.statistik;
        const tbody = document.getElementById('rekap-detail-body');

        // Update statistik
        document.getElementById('rekap-stat-total').textContent = statistik.total;
        document.getElementById('rekap-stat-siswa').textContent = statistik.siswaHadir;

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-gray-500 dark:text-gray-400">Belum ada data kehadiran</td></tr>';
        } else {
            tbody.innerHTML = data.map((item, index) => `
                <tr class="table-row border-b border-gray-100 dark:border-gray-700">
                    <td class="py-3 px-4 text-gray-800 dark:text-gray-200">${index + 1}</td>
                    <td class="py-3 px-4 text-gray-800 dark:text-gray-200">${item.siswaNis}</td>
                    <td class="py-3 px-4 text-gray-800 dark:text-gray-200">${item.siswaNama}</td>
                    <td class="py-3 px-4 text-gray-800 dark:text-gray-200">${item.mapelNama}</td>
                    <td class="py-3 px-4 text-gray-800 dark:text-gray-200">${item.kelasNama}</td>
                    <td class="py-3 px-4 text-center text-gray-800 dark:text-gray-200">${formatTanggal(item.tanggal)}</td>
                    <td class="py-3 px-4 text-center text-gray-800 dark:text-gray-200">${item.jam}</td>
                </tr>
            `).join('');
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ===== LOAD SESI AKTIF =====
async function loadSesiAktif() {
    try {
        const result = await API.getSesiAktifSemua();
        const data = result.data;
        const tbody = document.getElementById('sesi-aktif-body');

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500 dark:text-gray-400">Tidak ada sesi aktif saat ini</td></tr>';
        } else {
            tbody.innerHTML = data.map(sesi => `
                <tr class="table-row border-b border-gray-100 dark:border-gray-700">
                    <td class="py-3 px-4 text-gray-800 dark:text-gray-200">${sesi.guruNama}</td>
                    <td class="py-3 px-4 text-gray-800 dark:text-gray-200">${sesi.mapelNama}</td>
                    <td class="py-3 px-4 text-gray-800 dark:text-gray-200">${sesi.kelasNama}</td>
                    <td class="py-3 px-4 text-center text-green-600 dark:text-green-400 font-semibold">${sesi.jumlahHadir}</td>
                    <td class="py-3 px-4 text-center text-xs text-gray-500 dark:text-gray-400">${formatDateTime(sesi.dibukaPada)}</td>
                </tr>
            `).join('');
        }
    } catch (error) {
        console.error('Load sesi aktif error:', error);
    }
}

// ===== LOAD OPTIONS =====
async function loadOptions() {
    try {
        // Load mapel options
        const mapelResult = await API.getMapel();
        const filterMapel = document.getElementById('filter-mapel');
        filterMapel.innerHTML = '<option value="">Semua Mapel</option>' +
            mapelResult.data.map(m => `<option value="${m.id}">${m.nama}</option>`).join('');

        // Load kelas options
        const kelasResult = await API.getKelas();
        const filterKelas = document.getElementById('filter-kelas');
        filterKelas.innerHTML = '<option value="">Semua Kelas</option>' +
            kelasResult.data.map(k => `<option value="${k.id}">${k.nama}</option>`).join('');
    } catch (error) {
        console.error('Load options error:', error);
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

// ===== SOCKET.IO SETUP =====
function setupSocket() {
    const socket = initSocket(adminUser);
    
    if (!socket) return;

    // Terima event presensi baru dari siswa
    socket.on('presensi-bar', (data) => {
        // Refresh data secara real-time
        loadDashboard();
        loadSesiAktif();
        
        showToast(`${data.siswaNama} hadir di ${data.mapelNama}`, 'info');
    });
}