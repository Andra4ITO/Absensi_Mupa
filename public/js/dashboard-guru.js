// ===== DASHBOARD GURU LOGIC =====
let currentSesi = null;
let daftarHadir = [];
var guruUser = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Cek autentikasi & role via Supabase Auth (fallback: sesi lokal lama)
    const user = await Auth.requireAuthAsync('guru');
    if (!user) return;
    guruUser = user;
    // Fallback refId agar fitur lama (mapel/sesi) tetap berfungsi
    // meskipun user berasal dari manajemen pengguna (mupa_users).
    guruUser.refId = user.refId || user.id || guruUser.id;

    // Set user info
    document.getElementById('user-name').textContent = user.nama;

    // Setup form
    document.getElementById('form-buka-sesi').addEventListener('submit', bukaSesi);

    // Load data & identitas Supabase (jika tersedia), lalu fresh-load sesi/riwayat
    await initGuruSupabase();
});

// ===== SUPABASE - IDENTITAS & HELPER (Stage 5 Presensi QR) =====
// Supabase Database tidak dipakai lagi untuk data guru/mapel/sesi.
// Semua fitur menuju AttendanceStore / UserStore (localStorage).

// Resolve identitas guru dari session Auth, lalu fresh-load sesi & riwayat.
// ===== IDENTITAS GURU (dari data aplikasi lokal) =====
// Lengkapi identitas guru dari mupa_users bila belum ada
// (mis. ketika login via Supabase Auth, sedangkan data akademik
//  guru ada di mupa_users / localStorage).
async function initGuruSupabase() {
    fillDatetimeDefaults();
    if (guruUser && !Array.isArray(guruUser.subjectIds)) {
        const local = UserStore.getUsers().find(function (u) {
            return u.role === 'guru' && String(u.nama || '').toLowerCase() === String(guruUser.nama || '').toLowerCase();
        });
        if (local) {
            guruUser.subjectIds = local.subjectIds || [];
            if (!guruUser.nis) guruUser.nis = local.nis;
        }
    }
    loadMapelGuru();
    await loadSesiAktif();
    await loadRiwayatSesi();
}

// ===== LIGHT MODE (dashboard guru selalu terang - dark mode dinonaktifkan) =====
document.documentElement.classList.remove('dark');

// ===== LOAD MATA PELAJARAN GURU (hanya yang diajar guru) =====
function loadMapelGuru() {
    const select = document.getElementById('select-mapel');
    if (!select) return;

    // Pastikan data guru siap
    if (guruUser) UserStore.ensureAcademicFields();

    const myIds = UserStore.getSubjectIdsOf(guruUser);
    const all = AttendanceStore.getSubjects();

    // Jika guru belum punya mapel terdaftar - tampilkan pesan
    if (!myIds || myIds.length === 0) {
        select.innerHTML = '<option value="">Guru ini belum memiliki mata pelajaran yang terdaftar</option>';
        return;
    }

    const byId = {};
    all.forEach(function (s) { byId[s.id] = s; });

    const mine = myIds.map(function (id) { return byId[id]; }).filter(Boolean);

    if (mine.length === 0) {
        select.innerHTML = '<option value="">Guru ini belum memiliki mata pelajaran yang terdaftar</option>';
        return;
    }

    select.innerHTML = '<option value="">Pilih Mata Pelajaran</option>' +
        mine.map(function (s) { return '<option value="' + s.id + '">' + s.nama + '</option>'; }).join('');
}

// Isi tanggal & jam default saat halaman dimuat
function fillDatetimeDefaults() {
    const tanggalEl = document.getElementById('select-tanggal');
    const jamEl = document.getElementById('select-jam');
    const now = new Date();
    if (tanggalEl && !tanggalEl.value) {
        tanggalEl.value = now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0');
    }
    if (jamEl && !jamEl.value) {
        jamEl.value = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    }
}

// ===== BUKA SESI (Buat Sesi & Generate QR) =====
async function bukaSesi(e) {
    e.preventDefault();

    const mapelId = document.getElementById('select-mapel').value;
    const kelas = document.getElementById('select-kelas').value;
    const jurusan = document.getElementById('select-jurusan').value;
    const tanggal = document.getElementById('select-tanggal').value;
    const jamMulai = document.getElementById('select-jam').value;
    const durasiMenit = document.getElementById('select-durasi').value;

    if (!mapelId || !kelas || !jurusan || !tanggal) {
        showToast('Silakan lengkapi kelas dan mata pelajaran.', 'warning');
        return;
    }

    const mapel = AttendanceStore.getSubjects().find(s => s.id === mapelId);
    const mapelNama = mapel ? mapel.nama : mapelId;

    // Buat sesi presensi lokal (AttendanceStore / localStorage).
    const result = AttendanceStore.createSession({
        guruId: guruUser.id || guruUser.refId,
        guruNama: guruUser.nama,
        kelas: kelas,
        jurusan: jurusan,
        mataPelajaran: mapelNama,
        tanggal: tanggal,
        jamMulai: jamMulai,
        durasiMenit: durasiMenit
    });

    if (!result.success) {
        showToast(result.error, 'error');
        return;
    }

    currentSesi = result.session;
    if (typeof ActivityLog !== 'undefined') { ActivityLog.log('sesi_dibuka', result.session.mataPelajaran + ' - ' + result.session.kelas + ' ' + result.session.jurusan, guruUser.nama); }
    displayActiveSession();
    showToast('QR Presensi berhasil dibuat.', 'success');
    loadRiwayatSesi();
}

// ===== TAMPILKAN SESI AKTIF + QR =====
async function displayActiveSession() {
    if (!currentSesi) return;

    document.getElementById('sesi-mapel').textContent = currentSesi.mataPelajaran;
    document.getElementById('sesi-kelas').textContent = currentSesi.kelas + ' ' + currentSesi.jurusan;
    document.getElementById('sesi-tanggal').textContent = currentSesi.tanggal || '-';
    document.getElementById('sesi-waktu').textContent = currentSesi.jamMulai || '-';
    document.getElementById('sesi-durasi').textContent = currentSesi.durasiMenit;
    document.getElementById('sesi-durasi-hint').textContent = currentSesi.durasiMenit;

    // Generate QR nyata
    resetSesiCardState();
    generateQR(currentSesi);
    startCountdown(currentSesi);

    // Statistik & daftar hadir (dari Supabase bila tersedia)
    await loadDaftarHadir(currentSesi.id);
    await renderStats();

    document.getElementById('form-sesi-card').classList.add('hidden');
    document.getElementById('qr-sesi-card').classList.remove('hidden');
    document.getElementById('daftar-hadir-card').classList.remove('hidden');
}

// Generate QR menggunakan library qrcodejs (cdnjs).
// API library ini: new QRCode(element, { text, width, height, correctLevel }).
// Library merender <canvas> (+<img> fallback) langsung ke dalam element.
function generateQR(session) {
    const s = session || currentSesi;
    if (!s) return;

    // Library harus sudah dimuat sebelum dashboard-guru.js
    if (typeof QRCode === 'undefined') {
        showToast('Library QRCode gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.', 'error');
        console.error('[QR] window.QRCode tidak tersedia - CDN library belum termuat.');
        return;
    }
    if (typeof AttendanceStore === 'undefined') {
        showToast('Data presensi tidak tersedia. Muat ulang halaman.', 'error');
        return;
    }

    const container = document.getElementById('qr-container');
    if (!container) {
        console.error('[QR] #qr-container tidak ditemukan di DOM.');
        showToast('Container QR tidak ditemukan. Muat ulang halaman.', 'error');
        return;
    }

    // Bersihkan render lama agar tidak menumpuk beberapa canvas
    container.innerHTML = '';

    // Payload QR: berisi session identifier + token unik (bukan password).
    //   { type, sessionId, token, timestamp }
    const payloadText = JSON.stringify({
        type: 'MUPA_ATTENDANCE',
        sessionId: s.sessionId || s.id,
        token: s.token || undefined,
        timestamp: Date.now()
    });
    try {
        new QRCode(container, {
            text: payloadText,
            width: 260,
            height: 260,
            // Warna QR: navy gelap (tema MUPA) - TIDAK memakai hijau.
            colorDark: '#172F4D',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });
        container.title = s.id; // id sesi tersemat untuk inspeksi cepat
    } catch (err) {
        console.error('[QR] Gagal membuat QR:', err);
        showToast('Gagal membuat QR Code: ' + err.message, 'error');
    }
}

// ===== COUNTDOWN MASA BERLAKU QR (live) =====
// Menghitung sisa waktu dari currentSesi.expiresAt (data asli sesi).
// Saat waktu habis:
//   - sesi di-expire di storage (data tetap utuh, tidak ada yang dihapus)
//   - QR tidak berlaku lagi + kartu menampilkan status "Selesai"
// Timer ini murni tampilan; validasi QR tetap dilakukan AttendanceStore.validateQR().
let countdownTimer = null;

// Kembalikan tampilan kartu QR ke kondisi "sesi aktif" (dipakai saat sesi baru dibuat)
function resetSesiCardState() {
    const label = document.getElementById('sesi-status-label');
    if (label) {
        label.textContent = 'Aktif';
        label.className = 'px-2 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold';
    }
    const live = document.querySelector('#qr-sesi-card .animate-pulse');
    if (live) {
        live.textContent = 'LIVE';
        live.className = 'px-3 py-1 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full text-xs font-semibold animate-pulse';
    }
    const btn = document.querySelector('#qr-sesi-card button[onclick="tutupSesi()"]');
    if (btn) btn.textContent = 'Tutup Sesi';
    const el = document.getElementById('sesi-countdown');
    if (el) el.className = 'font-mono text-xl font-bold text-navy-700 px-3 py-1 rounded-lg bg-[#EAF1F7] border border-[#D9E5F0]';
}

function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    const el = document.getElementById('sesi-countdown');
    if (el) {
        el.textContent = '--:--';
        el.className = 'font-mono text-xl font-bold text-navy-700 px-3 py-1 rounded-lg bg-[#EAF1F7] border border-[#D9E5F0]';
    }
}

function startCountdown(session) {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    const s = session || currentSesi;
    if (!s || !s.expiresAt) return;

    const el = document.getElementById('sesi-countdown');
    if (!el) return;

    const tick = function () {
        const sisa = new Date(s.expiresAt).getTime() - Date.now();
        if (sisa <= 0) {
            if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
            el.textContent = '00:00';
            handleSessionExpired(s);
            return;
        }
        const total = Math.floor(sisa / 1000);
        el.textContent = String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
        // 1 menit terakhir: peringatan amber (bukan hijau)
        if (total <= 60) {
            el.className = 'font-mono text-xl font-bold text-amber-700 px-3 py-1 rounded-lg bg-amber-50 border border-amber-200';
        }
    };

    tick();
    countdownTimer = setInterval(tick, 1000);
}

// Sesi berakhir karena waktu habis: QR tidak berlaku, kartu menampilkan status selesai.
function handleSessionExpired(session) {
    if (!session) return;

    // Tandai sesi sebagai expired di storage lokal (tidak menghapus data apapun)
    if (typeof AttendanceStore !== 'undefined' && AttendanceStore.expireExpiredSessions) {
        AttendanceStore.expireExpiredSessions();
    }

    const label = document.getElementById('sesi-status-label');
    if (label) {
        label.textContent = 'Selesai';
        label.className = 'px-2 py-1 bg-slate-200 text-slate-700 rounded-full text-xs font-semibold';
    }
    const live = document.querySelector('#qr-sesi-card .animate-pulse');
    if (live) {
        live.textContent = 'SELESAI';
        live.className = 'px-3 py-1 bg-slate-100 text-slate-600 border border-slate-200 rounded-full text-xs font-semibold';
    }
    const qr = document.getElementById('qr-container');
    if (qr) {
        qr.innerHTML = '<p class="text-center text-sm font-semibold text-slate-600 px-4 py-8" style="max-width:240px">Sesi telah berakhir.<br>QR Code tidak berlaku lagi.</p>';
    }
    const hint = document.getElementById('sesi-durasi-hint');
    if (hint) hint.textContent = '0';
    const btn = document.querySelector('#qr-sesi-card button[onclick="tutupSesi()"]');
    if (btn) btn.textContent = 'Tutup & Reset';

    showToast('Waktu sesi habis. QR Code sudah tidak berlaku lagi.', 'warning');
    loadRiwayatSesi();
}

// ===== TUTUP SESI =====
async function tutupSesi() {
    if (!currentSesi) return;
    if (!confirm('Tutup sesi ' + currentSesi.mataPelajaran + ' - ' + currentSesi.kelas + ' ' + currentSesi.jurusan + '?')) return;

    // Tutup sesi di storage lokal (AttendanceStore / localStorage).
    const result = AttendanceStore.closeSession(currentSesi.id);
    if (!result.success) { showToast(result.error, 'error'); return; }

    stopCountdown();
    showToast('Sesi ditutup.', 'success');
    if (typeof ActivityLog !== 'undefined') { ActivityLog.log('sesi_ditutup', currentSesi.mataPelajaran + ' - ' + currentSesi.kelas + ' ' + currentSesi.jurusan, guruUser.nama); }
    currentSesi = null;
    daftarHadir = [];
    document.getElementById('qr-sesi-card').classList.add('hidden');
    document.getElementById('daftar-hadir-card').classList.add('hidden');
    document.getElementById('form-sesi-card').classList.remove('hidden');
    await loadRiwayatSesi();
}

// ===== LOAD SESI AKTIF (dari Supabase; fallback localStorage) =====
async function loadSesiAktif() {
    AttendanceStore.expireExpiredSessions();
    const sessions = AttendanceStore.getSessionsByGuru(guruUser.id || guruUser.refId);
    const aktif = sessions.find(function (s) { return s.status === 'aktif'; });
    if (aktif) {
        currentSesi = aktif;
        await displayActiveSession();
    }
}

// ===== RENDER STATISTIK =====
async function renderStats() {
    if (!currentSesi) return;
    const t = document.getElementById('stat-total');
    const h = document.getElementById('stat-hadir');
    const b = document.getElementById('stat-belum');
    if (!t || !h || !b) return;

    const stats = AttendanceStore.computeStats(currentSesi);
    t.textContent = stats.total;
    h.textContent = stats.hadir;
    b.textContent = stats.belum;
}

// ===== LOAD DAFTAR HADIR =====
async function loadDaftarHadir(sessionId) {
    daftarHadir = AttendanceStore.getRecordsBySession(sessionId);
    renderDaftarHadir();
}

// ===== RENDER DAFTAR HADIR =====
function renderDaftarHadir() {
    const tbody = document.getElementById('daftar-hadir-body');
    if (!tbody) return;

    if (!currentSesi) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-gray-500">Belum ada siswa yang hadir</td></tr>';
        return;
    }

    const records = daftarHadir || [];
    if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-gray-500">Belum ada siswa yang hadir</td></tr>';
        return;
    }

    tbody.innerHTML = records.map((log, index) =>
        '<tr class="table-row border-b border-gray-100 animate-fade-in">' +
            '<td class="py-3 px-4 text-gray-800">' + (index + 1) + '</td>' +
            '<td class="py-3 px-4 text-gray-800 font-mono">' + (log.nis || '-') + '</td>' +
            '<td class="py-3 px-4 text-gray-800 font-semibold">' + (log.studentNama || '-') + '</td>' +
            '<td class="py-3 px-4 text-center text-xs text-gray-500">' +
                new Date(log.waktuScan).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) +
            '</td>' +
        '</tr>'
    ).join('');
}

// ===== LOAD RIWAYAT SESI =====
async function loadRiwayatSesi() {
    const tbody = document.getElementById('riwayat-sesi-body');
    if (!tbody) return;

    AttendanceStore.expireExpiredSessions();
    const data = AttendanceStore.getSessionsByGuru(guruUser.id || guruUser.refId);
    renderRiwayatSesi(data, null);
    updateGuruStats();
}

function renderRiwayatSesi(data, counts) {
    const tbody = document.getElementById('riwayat-sesi-body');
    if (!tbody) return;

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">Belum ada sesi presensi</td></tr>';
        return;
    }

    tbody.innerHTML = data.map(sesi => {
        let jumlah = counts ? (counts[sesi.id] || 0) : 0;
        if (counts === null && typeof AttendanceStore !== 'undefined') {
            jumlah = AttendanceStore.getRecordsBySession(sesi.id).length;
        }
        return '<tr class="table-row border-b border-gray-100">' +
            '<td class="py-3 px-4 text-gray-800">' + (sesi.mataPelajaran || '-') + '</td>' +
            '<td class="py-3 px-4 text-gray-800">' + (sesi.kelas || '') + ' ' + (sesi.jurusan || '') + '</td>' +
            '<td class="py-3 px-4 text-center">' + getStatusBadge(sesi.status) + '</td>' +
            '<td class="py-3 px-4 text-center text-gray-800">' + jumlah + '</td>' +
            '<td class="py-3 px-4 text-center text-xs text-gray-500">' +
                ((sesi.tanggal || '') + ' ' + (sesi.jamMulai || '')) +
            '</td>' +
        '</tr>';
    }).join('');
}


// ===== STATISTIK GURU (data lokal: sesi, presensi, mapel) =====
function updateGuruStats() {
    if (!guruUser || typeof AttendanceStore === 'undefined') return;
    const sesi = AttendanceStore.getSessionsByGuru(guruUser.id || guruUser.refId);
    const aktif = sesi.filter(function (s) { return s.status === 'aktif'; }).length;
    let presensi = 0;
    sesi.forEach(function (s) { presensi += AttendanceStore.getRecordsBySession(s.id).length; });
    let mapel = 0;
    if (typeof UserStore !== 'undefined' && UserStore.getSubjectIdsOf) {
        mapel = UserStore.getSubjectIdsOf(guruUser).length;
    } else if (Array.isArray(guruUser.subjectIds)) {
        mapel = guruUser.subjectIds.length;
    }
    const set = function (id, v) { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('guru-stat-sesi', sesi.length);
    set('guru-stat-aktif', aktif);
    set('guru-stat-presensi', presensi);
    set('guru-stat-mapel', mapel);

    // Rekap strip (Riwayat & Rekap Sesi)
    set('guru-rekap-sesi', sesi.length);
    set('guru-rekap-kehadiran', presensi);
    set('guru-rekap-aktif', aktif);

    // Kartu Presensi Aktif
    const wrap = document.getElementById('guru-presensi-aktif');
    if (wrap) {
        const aktifSesi = sesi.find(function (s) { return s.status === 'aktif'; });
        if (aktifSesi) {
            const jumlahSiswa = UserStore.getUsers().filter(function (u) {
                return u.role === 'siswa' && String(u.kelas || '') === String(aktifSesi.kelas || '') && String(u.jurusan || '') === String(aktifSesi.jurusan || '');
            }).length;
            const sudah = AttendanceStore.getRecordsBySession(aktifSesi.id).length;
            wrap.classList.remove('hidden');
            wrap.innerHTML =
            '<div class="bg-white border border-[#E2E8F0] rounded-xl shadow-sm p-6 animate-fade-in">' +
            '<div class="flex items-center justify-between mb-4"><h2 class="text-lg font-bold text-slate-800">Presensi Aktif</h2>' +
            '<span class="px-3 py-1 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-full text-xs font-semibold animate-pulse">LIVE</span></div>' +
            '<div class="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">' +
            '<div><p class="text-xs text-slate-500">Mata Pelajaran</p><p class="font-semibold text-slate-800">' + (aktifSesi.mataPelajaran || '-') + '</p></div>' +
            '<div><p class="text-xs text-slate-500">Kelas</p><p class="font-semibold text-slate-800">' + (aktifSesi.kelas || '') + ' ' + (aktifSesi.jurusan || '') + '</p></div>' +
            '<div><p class="text-xs text-slate-500">Waktu Mulai</p><p class="font-semibold text-slate-800">' + (aktifSesi.jamMulai || '-') + '</p></div>' +
            '<div><p class="text-xs text-slate-500">Jumlah Siswa Kelas</p><p class="font-semibold text-slate-800">' + jumlahSiswa + '</p></div>' +
            '<div><p class="text-xs text-slate-500">Sudah Presensi</p><p class="font-semibold text-blue-600">' + sudah + '</p></div>' +
            '<div><p class="text-xs text-slate-500">Status</p><p class="font-semibold text-indigo-600">Aktif</p></div>' +
            '</div></div>' +
            '';
        } else {
            wrap.classList.add('hidden');
            wrap.innerHTML = '';
        }
    }
}

// ===== EXPORT RIWAYAT SESI (CSV, kompatibel Excel) =====
function exportRiwayatGuru() {
    if (!guruUser || typeof AttendanceStore === 'undefined') return;
    const sesi = AttendanceStore.getSessionsByGuru(guruUser.id || guruUser.refId);
    if (sesi.length === 0) { showToast('Belum ada data untuk diexport.', 'warning'); return; }
    const rows = [['No', 'Sesi', 'Mata Pelajaran', 'Kelas', 'Jurusan', 'Tanggal', 'Jam Mulai', 'Status', 'Jumlah Hadir']];
    sesi.forEach(function (s, i) {
        rows.push([i + 1, s.id, s.mataPelajaran || '-', (s.kelas || '') + ' ' + (s.jurusan || ''), s.jurusan || '-', s.tanggal || '-', s.jamMulai || '-', s.status || '-', AttendanceStore.getRecordsBySession(s.id).length]);
    });
    const csv = rows.map(function (r) { return r.map(function (v) { return '"' + String(v).replace(/'"'/g, '""') + '"'; }).join(';'); }).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rekap-presensi-guru-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
