// ===== DASHBOARD ADMIN LOGIC =====
let adminUser = null;

document.addEventListener('DOMContentLoaded', async () => {
    // Cek autentikasi & role via Supabase Auth (fallback: sesi lokal lama)
    const user = await Auth.requireAuthAsync('admin');
    if (!user) return;
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

    // Inisialisasi manajemen pengguna (localStorage)
    initUserManagement();
    initPengaturan();
    setupPdfExports();

    // Setup socket real-time
    setupSocket();
});

// ===== LIGHT MODE (dashboard admin selalu terang - dark mode dinonaktifkan) =====
document.documentElement.classList.remove('dark');

// ===== LOAD DASHBOARD =====
// Statistik dihitung dari data lokal (UserStore + AttendanceStore) agar
// konsisten dengan tabel Manajemen Pengguna dan tidak bergantung pada
// API backend yang membutuhkan token JWT (sumber error 401 sebelumnya).
async function loadDashboard() {
    try {
        if (typeof UserStore !== 'undefined') UserStore.seedIfEmpty();
        AttendanceStore.expireExpiredSessions();
        const users = UserStore.getUsers();
        const totalSiswa = users.filter(function (u) { return u.role === 'siswa'; }).length;
        const totalGuru = users.filter(function (u) { return u.role === 'guru'; }).length;
        const totalMapel = AttendanceStore.getSubjects().length;
        const sesiAktif = AttendanceStore.getSessions().filter(function (s) { return s.status === 'aktif'; }).length;

        document.getElementById('stat-siswa').textContent = totalSiswa;
        document.getElementById('stat-guru').textContent = totalGuru;
        document.getElementById('stat-mapel').textContent = totalMapel;
        document.getElementById('stat-sesi-aktif').textContent = sesiAktif;

        // Presensi hari ini, grafik 7 hari, aktivitas terbaru (data lokal)
        renderAdminPresensiHariIni();
        renderAdminGrafik();
        renderAktivitas();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ===== LOAD REKAP PER MAPEL =====
// Agregasi dari sesi & record presensi lokal (AttendanceStore / localStorage).
async function loadRekapMapel() {
    const tbody = document.getElementById('rekap-mapel-body');
    if (!tbody) return;

    const bulan = document.getElementById('filter-bulan').value;
    const tahun = document.getElementById('filter-tahun').value;

    const inPeriod = function (d) {
        if (!bulan && !tahun) return true;
        if (!d || isNaN(d.getTime())) return false;
        if (tahun && String(d.getFullYear()) !== String(tahun)) return false;
        if (bulan && String(d.getMonth() + 1) !== String(parseInt(bulan, 10))) return false;
        return true;
    };

    const sessions = (typeof AttendanceStore !== 'undefined') ? AttendanceStore.getSessions() : [];
    const records = (typeof AttendanceStore !== 'undefined') ? AttendanceStore.getRecords() : [];
    const subjects = (typeof AttendanceStore !== 'undefined') ? AttendanceStore.getSubjects() : [];

    const subjByNama = {};
    subjects.forEach(function (s) { subjByNama[s.nama] = s; });

    const agg = {};
    const note = function (key, guruNama, mataPelajaran) {
        if (!agg[key]) agg[key] = { sesi: 0, hadir: 0, siswa: new Set(), nama: mataPelajaran, guru: guruNama };
    };

    sessions.forEach(function (s) {
        if (!inPeriod(s.createdAt ? new Date(s.createdAt) : null)) return;
        const key = String(s.mataPelajaran || '-');
        note(key, s.guruNama || '-', s.mataPelajaran || '-');
        agg[key].sesi++;
    });
    records.forEach(function (r) {
        if (!inPeriod(r.waktuScan ? new Date(r.waktuScan) : null)) return;
        const key = String(r.mataPelajaran || '-');
        note(key, r.guruNama || '-', r.mataPelajaran || '-');
        agg[key].hadir++;
        if (r.studentId != null) agg[key].siswa.add(String(r.studentId));
    });

    const data = Object.keys(agg).map(function (key) {
        const a = agg[key];
        const subj = subjByNama[a.nama];
        return {
            mapelNama: a.nama,
            mapelKode: (subj && subj.kode) || '-',
            guruNama: a.guru,
            sesiCount: a.sesi,
            totalKehadiran: a.hadir,
            siswaUnik: a.siswa.size
        };
    }).sort(function (a, b) { return b.totalKehadiran - a.totalKehadiran; });

    window.__rekapMapelData = data;

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-gray-500">Belum ada data kehadiran</td></tr>';
    } else {
        tbody.innerHTML = data.map(function (item, index) {
            return `
                <tr class="table-row border-b border-gray-100">
                    <td class="py-3 px-4 text-gray-800">${index + 1}</td>
                    <td class="py-3 px-4">
                        <div class="flex items-center gap-2">
                            <div class="w-8 h-8 rounded-full bg-navy-100 flex items-center justify-center">
                                <span class="text-sm font-bold text-navy-700">${getMapelInitial(item.mapelNama)}</span>
                            </div>
                            <div>
                                <p class="text-gray-800 font-semibold">${item.mapelNama}</p>
                                <p class="text-xs text-gray-500">${item.mapelKode}</p>
                            </div>
                        </div>
                    </td>
                    <td class="py-3 px-4 text-gray-800">${item.guruNama}</td>
                    <td class="py-3 px-4 text-center text-gray-800">${item.sesiCount}</td>
                    <td class="py-3 px-4 text-center text-blue-600 font-semibold">${item.totalKehadiran}</td>
                    <td class="py-3 px-4 text-center text-blue-600 font-semibold">${item.siswaUnik}</td>
                </tr>
            `;
        }).join('');
    }
}

// ===== LOAD REKAP DETAIL =====
// Baca attendance records lokal + filter (tanggal/mapel/kelas/jurusan/guru/status).
async function loadRekapDetail() {
    const tbody = document.getElementById('rekap-detail-body');
    if (!tbody) return;

    const tanggal = document.getElementById('filter-tanggal').value;
    const mapelNama = document.getElementById('filter-mapel').value;
    const kelas = document.getElementById('filter-kelas').value;
    const jurusan = document.getElementById('filter-jurusan') ? document.getElementById('filter-jurusan').value : '';
    const guruId = document.getElementById('filter-guru') ? document.getElementById('filter-guru').value : '';
    const status = document.getElementById('filter-status') ? document.getElementById('filter-status').value : '';

    const semua = (typeof AttendanceStore !== 'undefined') ? AttendanceStore.getRecords() : [];

    const data = semua.filter(function (r) {
        if (tanggal) {
            const d = new Date(r.waktuScan);
            if (isNaN(d.getTime())) return false;
            if (d.toISOString().slice(0, 10) !== tanggal) return false;
        }
        if (mapelNama && String(r.mataPelajaran || '') !== String(mapelNama)) return false;
        if (kelas && String(r.kelas || '') !== String(kelas)) return false;
        if (jurusan && String(r.jurusan || '') !== String(jurusan)) return false;
        if (guruId && String(r.guruId || '') !== String(guruId) && String(r.guruNama || '') !== String(guruId)) return false;
        if (status && String(r.status || '') !== String(status)) return false;
        return true;
    });

    window.__rekapDetailData = data;

    // Statistik
    document.getElementById('rekap-stat-total').textContent = data.length;
    document.getElementById('rekap-stat-siswa').textContent =
        new Set(data.filter(function (r) { return r.status === 'hadir'; }).map(function (r) { return String(r.studentId); })).size;

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center py-4 text-gray-500">Belum ada data kehadiran</td></tr>';
    } else {
        tbody.innerHTML = data.map(function (item, index) {
            const d = item.waktuScan ? new Date(item.waktuScan) : null;
            const tgl = d && !isNaN(d.getTime()) ? formatTanggal(d.toISOString().slice(0, 10)) : '-';
            const jam = d && !isNaN(d.getTime()) ? d.toTimeString().slice(0, 5) : '-';
            return `
                <tr class="table-row border-b border-gray-100">
                    <td class="py-3 px-4 text-gray-800">${index + 1}</td>
                    <td class="py-3 px-4 text-gray-800">${item.nis || '-'}</td>
                    <td class="py-3 px-4 text-gray-800">${item.studentNama || '-'}</td>
                    <td class="py-3 px-4 text-gray-800">${item.mataPelajaran || '-'}</td>
                    <td class="py-3 px-4 text-gray-800">${item.kelas || '-'}</td>
                    <td class="py-3 px-4 text-gray-800">${item.jurusan || '-'}</td>
                    <td class="py-3 px-4 text-gray-800">${item.guruNama || '-'}</td>
                    <td class="py-3 px-4 text-center text-gray-800">${tgl}</td>
                    <td class="py-3 px-4 text-center text-gray-800">${jam}</td>
                    <td class="py-3 px-4 text-center"><span class="px-2 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700">${item.status || 'hadir'}</span></td>
                </tr>`;
        }).join('');
    }
}

// ===== LOAD SESI AKTIF =====
// Sesi dibaca dari storage lokal (AttendanceStore) - tanpa dependency API/JWT.
async function loadSesiAktif() {
    const tbody = document.getElementById('sesi-aktif-body');
    if (!tbody) return;

    AttendanceStore.expireExpiredSessions();
    const data = AttendanceStore.getSessions()
        .filter(function (s) { return s.status === 'aktif'; })
        .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
        .slice(0, 20);

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-4 text-gray-500">Belum ada sesi presensi aktif</td></tr>';
    } else {
        tbody.innerHTML = data.map(function (sesi) {
            const jumlahHadir = (typeof AttendanceStore !== 'undefined') ? AttendanceStore.getRecordsBySession(sesi.id).length : 0;
            return `
                <tr class="table-row border-b border-gray-100">
                    <td class="py-3 px-4 text-gray-800">${sesi.guruNama || '-'}</td>
                    <td class="py-3 px-4 text-gray-800">${sesi.mataPelajaran || '-'}</td>
                    <td class="py-3 px-4 text-gray-800">${sesi.kelas || ''} ${sesi.jurusan || ''}</td>
                    <td class="py-3 px-4 text-center text-blue-600 font-semibold">${jumlahHadir}</td>
                    <td class="py-3 px-4 text-center text-xs text-gray-500">${formatDateTime(sesi.createdAt)}</td>
                </tr>
            `;
        }).join('');
    }
}

// ===== LOAD OPTIONS =====
// Isi dropdown filter rekap dari data lokal (mapel, kelas, jurusan, guru).
async function loadOptions() {
    const setOptions = function (id, items, label) {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.innerHTML = '<option value="">' + label + '</option>' +
            items.map(function (it) { return '<option value="' + it.value + '">' + it.text + '</option>'; }).join('');
    };

    const subjects = (typeof AttendanceStore !== 'undefined') ? AttendanceStore.getSubjects() : [];
    const guru = UserStore.getUsers().filter(function (u) { return u.role === 'guru'; });

    setOptions('filter-mapel', subjects.map(function (s) { return { value: s.nama, text: s.nama }; }), 'Semua Mapel');
    setOptions('filter-kelas', (typeof AttendanceStore !== 'undefined' ? AttendanceStore.KELAS_LIST : []).map(function (k) { return { value: k, text: k }; }), 'Semua Kelas');
    setOptions('filter-jurusan', (typeof AttendanceStore !== 'undefined' ? AttendanceStore.JURUSAN_LIST : []).map(function (j) { return { value: j, text: j }; }), 'Semua Jurusan');
    setOptions('filter-guru', guru.map(function (g) { return { value: g.id, text: g.nama }; }), 'Semua Guru');
    setOptions('filter-status', [{ value: 'hadir', text: 'Hadir' }], 'Semua Status');
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

// ===== MANAJEMEN PENGGUNA =====
// Sumber data SEPENUHNYA dari localStorage (UserStore / mupa_users).
// Supabase Database tidak lagi dipakai untuk data siswa/guru/akademik.
let editingUserId = null;
function getDisplayedUsers() {
    return UserStore.getUsers();
}

function findDisplayedUserById(id) {
    const found = getDisplayedUsers().find(function (u) { return String(u.id) === String(id); });
    return found || null;
}

// Isi dropdown Kelas & Jurusan pada form dari data lokal.
function populateKelasJurusanOptions() {
    const kelasSelect = document.getElementById('user-form-kelas');
    const jurusanSelect = document.getElementById('user-form-jurusan');

    if (kelasSelect) {
        kelasSelect.innerHTML = '<option value="">Pilih</option>' +
            AttendanceStore.KELAS_LIST.map(function (t) {
                return '<option value="' + t + '">' + t + '</option>';
            }).join('');
    }

    if (jurusanSelect) {
        jurusanSelect.innerHTML = '<option value="">Pilih</option>' +
            AttendanceStore.JURUSAN_LIST.map(function (m) {
                return '<option value="' + m + '">' + m + '</option>';
            }).join('');
    }
}

// Inisialisasi manajemen pengguna
function initUserManagement() {
    UserStore.seedIfEmpty();
    UserStore.ensureAcademicFields();
    populateSubjectOptions();
    populateKelasJurusanOptions();
    renderUserTable();

    const searchInput = document.getElementById('user-search');
    if (searchInput) searchInput.addEventListener('input', renderUserTable);

    const filterRole = document.getElementById('user-filter-role');
    if (filterRole) filterRole.addEventListener('change', renderUserTable);

    const filterKelasEl = document.getElementById('user-filter-kelas');
    if (filterKelasEl) filterKelasEl.addEventListener('change', renderUserTable);

    const filterJurusanEl = document.getElementById('user-filter-jurusan');
    if (filterJurusanEl) filterJurusanEl.addEventListener('change', renderUserTable);

    const filterStatusEl = document.getElementById('user-filter-status');
    if (filterStatusEl) filterStatusEl.addEventListener('change', renderUserTable);

    const resetBtn = document.getElementById('user-filter-reset');
    if (resetBtn) resetBtn.addEventListener('click', resetUserFilters);

    const form = document.getElementById('user-form');
    if (form) form.addEventListener('submit', handleUserFormSubmit);

    // Role change -> tampilkan/sembunyikan field akademik & mapel
    const roleSelect = document.getElementById('user-form-role');
    if (roleSelect) roleSelect.addEventListener('change', toggleAcademicFields);
}

// Isi dropdown mata pelajaran form Guru dari data lokal (mupa_subjects).
function populateSubjectOptions() {
    const select = document.getElementById('user-form-subjects-select');
    if (!select) return;
    const subjects = (typeof AttendanceStore !== 'undefined') ? AttendanceStore.getSubjects() : [];
    select.innerHTML = subjects.map(function (s) {
        return '<option value="' + s.id + '">' + s.nama + '</option>';
    }).join('');
}

// Tandai option yang dipilih pada select mata pelajaran (multi)
function setSubjectSelection(ids) {
    const select = document.getElementById('user-form-subjects-select');
    if (!select) return;
    const set = {};
    (ids || []).forEach(function (id) { set[String(id)] = true; });
    Array.prototype.forEach.call(select.options, function (opt) {
        opt.selected = !!set[opt.value];
    });
}

// Ambil daftar pengguna sesuai search & filter
function getFilteredUsers() {
    const users = getDisplayedUsers();
    const searchEl = document.getElementById('user-search');
    const filterEl = document.getElementById('user-filter-role');
    const filterKelasEl = document.getElementById('user-filter-kelas');
    const filterJurusanEl = document.getElementById('user-filter-jurusan');
    const filterStatusEl = document.getElementById('user-filter-status');
    const q = (searchEl ? searchEl.value : '').trim().toLowerCase();
    const role = filterEl ? filterEl.value : '';
    const fKelas = filterKelasEl ? filterKelasEl.value : '';
    const fJurusan = filterJurusanEl ? filterJurusanEl.value : '';
    const fStatus = filterStatusEl ? filterStatusEl.value : '';

    return users.filter(function (u) {
        var namaLow = String(u.nama || '').toLowerCase();
        var nisLow = String(u.nis || '').toLowerCase();
        var kelasLow = String(u.kelas || '').toLowerCase();
        var jurusanLow = String(u.jurusan || '').toLowerCase();
        var matchQ = !q || namaLow.indexOf(q) !== -1 || nisLow.indexOf(q) !== -1 ||
            kelasLow.indexOf(q) !== -1 || jurusanLow.indexOf(q) !== -1;
        var matchRole = !role || u.role === role;
        var matchKelas = !fKelas || String(u.kelas || '') === fKelas;
        var matchJurusan = !fJurusan || String(u.jurusan || '') === fJurusan;
        var matchStatus = !fStatus || String(u.status || 'aktif') === fStatus;
        return matchQ && matchRole && matchKelas && matchJurusan && matchStatus;
    });
}

// Reset search + semua filter (Kelas, Jurusan, Status, Role) ke nilai awal
function resetUserFilters() {
    const searchEl = document.getElementById('user-search');
    if (searchEl) searchEl.value = '';
    ['user-filter-role', 'user-filter-kelas', 'user-filter-jurusan', 'user-filter-status'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    renderUserTable();
}

// Render tabel & statistik pengguna
function renderUserTable() {
    const users = getDisplayedUsers();
    const filtered = getFilteredUsers();

    const elTotal = document.getElementById('mng-total');
    const elSiswa = document.getElementById('mng-siswa');
    const elGuru = document.getElementById('mng-guru');
    if (elTotal) elTotal.textContent = users.length;
    if (elSiswa) elSiswa.textContent = users.filter(function (u) { return u.role === 'siswa'; }).length;
    if (elGuru) elGuru.textContent = users.filter(function (u) { return u.role === 'guru'; }).length;

    const tbody = document.getElementById('user-table-body');
    if (!tbody) return;

    const roleBadge = function (role) {
        return role === 'guru'
            ? '<span class="px-2 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">Guru</span>'
            : '<span class="px-2 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">Siswa</span>';
    };

    const statusBadge = function (status) {
        return status === 'aktif'
            ? '<span class="px-2 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">Aktif</span>'
            : '<span class="px-2 py-1 rounded-full text-xs font-semibold bg-slate-200 text-slate-600">Nonaktif</span>';
    };

    // Nama mata pelajaran yang diajar seorang guru
    const getSubjectNames = function (u) {
        if (u.role !== 'guru') return [];
        return UserStore.getSubjectNamesOf(u);
    };

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-gray-500">Tidak ada pengguna ditemukan</td></tr>';
        return;
    }

    const rows = filtered.map(function (u, index) {
        return '<tr class="table-row border-b border-gray-100">' +
            '<td class="py-3 px-4 text-gray-800">' + (index + 1) + '</td>' +
            '<td class="py-3 px-4"><div class="flex items-center gap-3">' +
                '<div class="w-9 h-9 rounded-full bg-navy-100 flex items-center justify-center">' +
                    '<span class="text-sm font-bold text-navy-700">' + (u.nama || '?').charAt(0).toUpperCase() + '</span>' +
                '</div>' +
                '<div><p class="text-gray-800 font-semibold">' + u.nama + '</p>' +
                '<p class="text-xs text-gray-500">' + u.id + '</p></div>' +
            '</div></td>' +
            '<td class="py-3 px-4 text-gray-800 font-mono">' + (u.nis || '-') + '</td>' +
            '<td class="py-3 px-4 text-gray-800">' + (u.role === 'siswa' ? (u.kelas || '-') : '-') + '</td>' +
            '<td class="py-3 px-4 text-gray-800">' + (u.role === 'siswa' ? (u.jurusan || '-') : '-') + '</td>' +
            '<td class="py-3 px-4 text-gray-800">' + (u.role === 'guru' ? ((getSubjectNames(u).join(', ') || '-')) : '-') + '</td>' +
            '<td class="py-3 px-4">' + roleBadge(u.role) + '</td>' +
            '<td class="py-3 px-4">' + statusBadge(u.status) + '</td>' +
            '<td class="py-3 px-4"><div class="flex items-center justify-center gap-2">' +
                '<button onclick="openUserDetail(\'' + u.id + '\')" title="Detail" class="p-2 rounded-lg text-gray-500 hover:text-blue-600 hover:bg-blue-50 transition">Lihat</button>' +
                '<button onclick="openUserModal(\'' + u.id + '\')" title="Edit" class="p-2 rounded-lg text-navy-600 hover:bg-navy-50 transition">Edit</button>' +
                '<button onclick="deleteUser(\'' + u.id + '\')" title="Hapus" class="p-2 rounded-lg text-red-500 hover:bg-red-50 transition">Hapus</button>' +
            '</div></td>' +
        '</tr>';
    });

    tbody.innerHTML = rows.join('');
}
// Buka modal tambah (tanpa id) atau edit (dengan id)
function openUserModal(id) {
    const form = document.getElementById('user-form');
    const title = document.getElementById('user-modal-title');
    const btnSubmit = document.getElementById('user-form-submit');
    const modal = document.getElementById('user-modal');
    if (!form || !modal) return;

    form.reset();
    editingUserId = null;

    if (id) {
        const user = findDisplayedUserById(id);
        if (!user) {
            showToast('Pengguna tidak ditemukan.', 'error');
            return;
        }
        editingUserId = id;
        title.textContent = 'Edit Pengguna';
        btnSubmit.textContent = 'Simpan Perubahan';
        document.getElementById('user-form-role').value = user.role;
        document.getElementById('user-form-nama').value = user.nama;
        document.getElementById('user-form-nis').value = user.nis;
        document.getElementById('user-form-status').value = user.status || 'aktif';
        document.getElementById('user-form-kelas').value = user.kelas || '';
        document.getElementById('user-form-jurusan').value = user.jurusan || '';
        // Set pilihan mapel guru
        setSubjectSelection(user.role === 'guru' ? (user.subjectIds || []) : []);
    } else {
        title.textContent = 'Tambah Pengguna';
        btnSubmit.textContent = 'Simpan Pengguna';
        document.getElementById('user-form-role').value = 'siswa';
        document.getElementById('user-form-status').value = 'aktif';
        document.getElementById('user-form-kelas').value = '';
        document.getElementById('user-form-jurusan').value = '';
        setSubjectSelection([]);
    }

    // Sinkronkan visibilitas field akademik dengan role yang dipilih
    toggleAcademicFields();

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

// Tampilkan kolom Kelas/Jurusan (siswa) vs Mata Pelajaran (guru) sesuai role
function toggleAcademicFields() {
    const roleSelect = document.getElementById('user-form-role');
    if (!roleSelect) return;
    const isSiswa = roleSelect.value === 'siswa';

    const academicWrap = document.getElementById('user-form-academic');
    if (academicWrap) academicWrap.style.display = isSiswa ? 'grid' : 'none';

    const subjectsWrap = document.getElementById('user-form-subjects');
    if (subjectsWrap) subjectsWrap.style.display = isSiswa ? 'none' : 'block';
}

// Tutup modal tambah/edit
function closeUserModal() {
    const modal = document.getElementById('user-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    editingUserId = null;
}

// Tampilkan detail pengguna
function openUserDetail(id) {
    const user = findDisplayedUserById(id);
    if (!user) {
        showToast('Pengguna tidak ditemukan.', 'error');
        return;
    }
    const body = document.getElementById('user-detail-body');
    if (!body) return;

    const roleLabel = user.role === 'guru' ? 'Guru' : 'Siswa';
    const statusLabel = user.status === 'aktif' ? 'Aktif' : 'Nonaktif';
    const created = user.createdAt ? new Date(user.createdAt).toLocaleString('id-ID') : '-';

    body.innerHTML =
        '<div class="flex justify-between py-1 border-b border-gray-100">' +
            '<span class="text-gray-500">ID</span>' +
            '<span class="font-semibold text-gray-800 font-mono">' + user.id + '</span>' +
        '</div>' +
        '<div class="flex justify-between py-1 border-b border-gray-100">' +
            '<span class="text-gray-500">Nama</span>' +
            '<span class="font-semibold text-gray-800">' + user.nama + '</span>' +
        '</div>' +
        '<div class="flex justify-between py-1 border-b border-gray-100">' +
            '<span class="text-gray-500">NIS/NIP</span>' +
            '<span class="font-semibold text-gray-800 font-mono">' + (user.nis || '-') + '</span>' +
        '</div>' +
        '<div class="flex justify-between py-1 border-b border-gray-100">' +
            '<span class="text-gray-500">Kelas</span>' +
            '<span class="font-semibold text-gray-800">' + (user.role === 'siswa' ? (user.kelas || '-') : '-') + '</span>' +
        '</div>' +
        '<div class="flex justify-between py-1 border-b border-gray-100">' +
            '<span class="text-gray-500">Jurusan</span>' +
            '<span class="font-semibold text-gray-800">' + (user.role === 'siswa' ? (user.jurusan || '-') : '-') + '</span>' +
        '</div>' +
        '<div class="flex justify-between py-1 border-b border-gray-100">' +
            '<span class="text-gray-500">Mata Pelajaran</span>' +
            '<span class="font-semibold text-gray-800">' + (user.role === 'guru' ? (UserStore.getSubjectNamesOf(user).join(', ') || '-') : '-') + '</span>' +
        '</div>' +
        '<div class="flex justify-between py-1 border-b border-gray-100">' +
            '<span class="text-gray-500">Role</span>' +
            '<span class="font-semibold text-gray-800">' + roleLabel + '</span>' +
        '</div>' +
        '<div class="flex justify-between py-1 border-b border-gray-100">' +
            '<span class="text-gray-500">Status</span>' +
            '<span class="font-semibold text-gray-800">' + statusLabel + '</span>' +
        '</div>' +
        '<div class="flex justify-between py-1">' +
            '<span class="text-gray-500">Dibuat</span>' +
            '<span class="font-semibold text-gray-800">' + created + '</span>' +
        '</div>';

    const modal = document.getElementById('user-detail-modal');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

// Tutup modal detail
function closeUserDetail() {
    const modal = document.getElementById('user-detail-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

// Submit form tambah/edit
async function handleUserFormSubmit(e) {
    e.preventDefault();

    const role = document.getElementById('user-form-role').value;
    const nama = document.getElementById('user-form-nama').value.trim();
    const nis = document.getElementById('user-form-nis').value.trim();
    const status = document.getElementById('user-form-status').value;
    const kelas = document.getElementById('user-form-kelas').value.trim();
    const jurusan = document.getElementById('user-form-jurusan').value.trim();

    // Ambil subjectIds yang dipilih (khusus guru)
    const subjectSelect = document.getElementById('user-form-subjects-select');
    const subjectIds = subjectSelect ? Array.prototype.slice.call(subjectSelect.selectedOptions).map(function (o) { return o.value; }) : [];

    if (!role) { showToast('Role wajib dipilih.', 'warning'); return; }
    if (!nama) { showToast('Nama lengkap wajib diisi.', 'warning'); return; }
    if (!nis) { showToast('NIS/NIP wajib diisi.', 'warning'); return; }
    if (role === 'siswa' && !kelas) { showToast('Kelas wajib dipilih.', 'warning'); return; }
    if (role === 'siswa' && !jurusan) { showToast('Jurusan wajib dipilih.', 'warning'); return; }
    if (role === 'guru' && subjectIds.length === 0) { showToast('Pilih minimal satu mata pelajaran yang diajar.', 'warning'); return; }

    // Simpan ke storage lokal (UserStore / mupa_users).
    let result;
    if (editingUserId) {
        result = UserStore.updateUser(editingUserId, { role: role, nama: nama, nis: nis, status: status, kelas: kelas, jurusan: jurusan, subjectIds: subjectIds });
    } else {
        result = UserStore.addUser({ role: role, nama: nama, nis: nis, status: status, kelas: kelas, jurusan: jurusan, subjectIds: subjectIds });
    }

    if (!result.success) {
        showToast(result.error, 'error');
        return;
    }

    if (typeof ActivityLog !== 'undefined') { ActivityLog.log('user_' + (editingUserId ? 'update' : 'tambah'), nama + ' (' + role + ')', adminUser ? adminUser.nama : 'Admin'); }
    showToast(editingUserId ? 'Pengguna berhasil diperbarui.' : 'Pengguna berhasil ditambahkan.', 'success');
    closeUserModal();
    renderUserTable();
}
// ============================================================
// Hapus pengguna dengan konfirmasi (data lokal / mupa_users).
// ============================================================
function deleteUser(id) {
    const user = findDisplayedUserById(id);
    if (!user) {
        showToast('Pengguna tidak ditemukan.', 'error');
        return;
    }
    if (confirm('Apakah Anda yakin ingin menghapus akun ' + user.nama + '?')) {
        const result = UserStore.deleteUser(id);
        if (!result.success) {
            showToast(result.error, 'error');
            return;
        }
        if (typeof ActivityLog !== 'undefined') { ActivityLog.log('user_hapus', user.nama + ' (' + user.role + ')', adminUser ? adminUser.nama : 'Admin'); }
        showToast('Akun ' + user.nama + ' berhasil dihapus.', 'success');
        renderUserTable();
    }
}

// ===== PRESENSI HARI INI / GRAFIK / AKTIVITAS / PENGATURAN / EXPORT =====
function adminDateKey(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function renderAdminPresensiHariIni() {
    if (typeof AttendanceStore === 'undefined') return;
    const records = AttendanceStore.getRecords();
    const today = adminDateKey(new Date());
    const norm = function (s) { return String(s || 'hadir').toLowerCase(); };
    const todayRecs = records.filter(function (r) { const d = new Date(r.waktuScan); return !isNaN(d) && adminDateKey(d) === today; });
    const set = function (id, v) { const el = document.getElementById(id); if (el) el.textContent = v; };
    set('adm-presensi-hari', todayRecs.length);
    set('adm-hadir', todayRecs.filter(function (r) { return norm(r.status) === 'hadir'; }).length);
    set('adm-izin', todayRecs.filter(function (r) { return norm(r.status) === 'izin'; }).length);
    set('adm-sakit', todayRecs.filter(function (r) { return norm(r.status) === 'sakit'; }).length);
    set('adm-alpa', todayRecs.filter(function (r) { const s = norm(r.status); return s === 'alpa' || s === 'tidak hadir'; }).length);
}

function renderAdminGrafik() {
    const el = document.getElementById('adm-grafik');
    if (!el || typeof AttendanceStore === 'undefined') return;
    const records = AttendanceStore.getRecords();
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        days.push({ key: adminDateKey(d), label: d.toLocaleDateString('id-ID', { weekday: 'short' }), count: 0 });
    }
    records.forEach(function (r) {
        const d = new Date(r.waktuScan);
        if (isNaN(d)) return;
        const k = adminDateKey(d);
        const day = days.find(function (x) { return x.key === k; });
        if (day) day.count++;
    });
    const max = Math.max.apply(null, days.map(function (d) { return d.count; }).concat([1]));
    el.innerHTML = days.map(function (d) {
        const h = Math.round((d.count / max) * 100);
        return '<div class="flex-1 flex flex-col items-center justify-end h-full">' +
            '<span class="text-xs text-slate-500 mb-1">' + d.count + '</span>' +
            '<div class="w-full max-w-[40px] bg-blue-500 rounded-t-md" style="height:' + Math.max(4, h) + '%"></div>' +
            '<span class="text-[10px] text-slate-400 mt-1">' + d.label + '</span></div>';
    }).join('');
}

function renderAktivitas() {
    const body = document.getElementById('aktivitas-body');
    if (!body || typeof ActivityLog === 'undefined') return;
    const list = ActivityLog.get(10);
    if (list.length === 0) {
        body.innerHTML = '<div class="text-center py-8"><p class="text-sm font-medium text-slate-600">Belum ada aktivitas tercatat</p><p class="text-xs text-slate-400 mt-1">Aktivitas admin, guru, dan siswa akan muncul di sini.</p></div>';
        return;
    }
    body.innerHTML = list.map(function (a) {
        const d = new Date(a.time);
        const waktu = isNaN(d) ? '-' : d.toLocaleString('id-ID');
        return '<div class="flex items-start justify-between gap-3 py-2 border-b border-[#E2E8F0] last:border-0">' +
            '<div><p class="text-sm font-medium text-slate-800">' + (a.action || '-') + '</p>' +
            (a.detail ? '<p class="text-xs text-slate-500">' + a.detail + '</p>' : '') + '</div>' +
            '<div class="text-right shrink-0"><p class="text-xs text-slate-500">' + (a.actor || '-') + '</p>' +
            '<p class="text-[10px] text-slate-400">' + waktu + '</p></div></div>';
    }).join('');
}

function initPengaturan() {
    if (typeof SchoolSettings === 'undefined') return;
    const s = SchoolSettings.get();
    const setv = function (id, v) { const el = document.getElementById(id); if (el) el.value = v; };
    setv('settings-nama', s.schoolName);
    setv('settings-jam', s.jamMasuk);
    setv('settings-lat', s.schoolLat);
    setv('settings-lng', s.schoolLng);
    setv('settings-radius', s.parkingRadiusM);
    setv('settings-durasi', s.qrDurationDefault);
    const form = document.getElementById('settings-form');
    if (form) form.addEventListener('submit', function (e) {
        e.preventDefault();
        const g = function (id) { const el = document.getElementById(id); return el ? el.value : ''; };
        const lat = parseFloat(g('settings-lat'));
        const lng = parseFloat(g('settings-lng'));
        const ok = SchoolSettings.save({
            schoolName: g('settings-nama') || 'SMKS Muhammadiyah Pakem',
            jamMasuk: g('settings-jam') || '07:00',
            schoolLat: isNaN(lat) ? '' : lat,
            schoolLng: isNaN(lng) ? '' : lng,
            parkingRadiusM: parseInt(g('settings-radius'), 10) || 100,
            qrDurationDefault: parseInt(g('settings-durasi'), 10) || 10
        });
        if (ok) {
            showToast('Pengaturan sekolah tersimpan.', 'success');
            if (typeof ActivityLog !== 'undefined') ActivityLog.log('pengaturan', 'Konfigurasi sekolah diperbarui', adminUser ? adminUser.nama : 'Admin');
        } else {
            showToast('Gagal menyimpan pengaturan.', 'error');
        }
    });
}

function exportRekapDetailCsv() {
    const tbody = document.getElementById('rekap-detail-body');
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr');
    if (rows.length === 0 || rows[0].querySelectorAll('td').length <= 1) {
        showToast('Belum ada data detail untuk diexport.', 'warning');
        return;
    }
    const heads = Array.prototype.map.call(document.querySelectorAll('#section-rekap-detail thead th'), function (th) { return th.textContent.trim(); });
    const out = [heads];
    rows.forEach(function (tr) {
        out.push(Array.prototype.map.call(tr.querySelectorAll('td'), function (td) { return td.textContent.trim(); }));
    });
    const csv = out.map(function (r) { return r.map(function (v) { return '"' + String(v).replace(/'"'/g, '""') + '"'; }).join(';'); }).join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'rekap-presensi-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
// ============================================================
// EXPORT PDF (jsPDF + AutoTable) - laporan sekolah profesional
// Data DIAMBIL dari data existing aplikasi (localStorage).
// ============================================================
let pdfCurrentDoc = null;

function pdfLibrariesReady() {
    if (typeof jspdf === 'undefined') return false;
    if (typeof jspdfAutoTable !== 'undefined') return true;
    // jspdf-autotable UMD v3 auto-apply plugin ke jsPDF → tersedia sebagai doc.autoTable
    try { return typeof jspdf.jsPDF.API.autoTable === 'function'; } catch (e) { return false; }
}

// Render tabel AutoTable dengan dukungan dua bentuk API:
// v3 UMD (doc.autoTable) dan UMD lama (jspdfAutoTable.default)
function pdfRenderTable(doc, opts) {
    if (typeof doc !== 'undefined' && typeof doc.autoTable === 'function') {
        doc.autoTable(opts);
    } else if (typeof jspdfAutoTable !== 'undefined' && jspdfAutoTable.default) {
        jspdfAutoTable.default(doc, opts);
    } else {
        throw new Error('Plugin AutoTable belum termuat');
    }
}

function pdfLibrariesFail() {
    showToast('Library PDF belum termuat. Periksa koneksi internet lalu muat ulang halaman.', 'error');
}

function pdfDateToday() {
    try {
        return new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) {
        return new Date().toISOString().slice(0, 10);
    }
}

function pdfFileDate() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Header laporan (dipanggil di tiap halaman baru)
function pdfDrawReportHeader(doc, title, filtersText) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
    doc.setTextColor(23, 47, 77);
    doc.text(12, 12, 'SMK Muhammadiyah Pakem');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.setTextColor(65, 111, 148);
    doc.text(12, 17, 'Sistem Presensi Digital MUPA');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.text(12, 23, title);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(12, 28, 'Tanggal Cetak: ' + pdfDateToday());
    if (filtersText) { doc.text(80, 28, 'Filter: ' + filtersText); }
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(12, 30, 198, 30);
}
function pdfDrawFooter(doc, pageNo, total) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    const txt = 'Pagina ' + pageNo + ' / ' + total;
    doc.text(198 - doc.getTextWidth(txt), 290, txt);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
    doc.text(12, 290, 'Sistem Presensi Digital MUPA - SMK Muhammadiyah Pakem');
}

function pdfBuild(doc, title, filtersTxt, head, body) {
    pdfCurrentDoc = doc;
    pdfDrawReportHeader(doc, title, filtersTxt);
    try {
        pdfRenderTable(doc, {
            head: head,
            body: body,
            startY: 34,
            margin: { top: 34, right: 10, bottom: 18, left: 12 },
            theme: 'striped',
            headStyles: { fillColor: [23, 47, 77], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
            styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.5 },
            alternateRowStyles: { fillColor: [242, 245, 249] },
            didDrawPage: function (data) {
                const page = Number(data.page) || 1;
                if (page > 1) pdfDrawReportHeader(doc, title, filtersTxt);
                let total = 1;
                try { total = doc.getNumberOfPages(); } catch (e) {}
                pdfDrawFooter(doc, page, total);
            }
        });
    } finally {
        pdfCurrentDoc = null;
    }
}

function pdfFinalize(doc, fileName) {
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
        doc.setPage(i);
        pdfDrawFooter(doc, i, total);
    }
    doc.save(fileName);
}

function withPdfState(btnId, work) {
    const btn = document.getElementById(btnId);
    const orig = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span class="inline-flex items-center gap-1.5"><svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path></svg>Menyiapkan PDF...</span>';
        btn.classList.add('opacity-60', 'cursor-not-allowed');
    }
    try {
        work();
        showToast('PDF berhasil dibuat & diunduh.', 'info');
    } catch (err) {
        console.error('PDF error:', err);
        showToast('Gagal membuat PDF. Silakan coba lagi.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = orig;
            btn.classList.remove('opacity-60', 'cursor-not-allowed');
        }
    }
}

// ===== BIND TOMBOL EXPORT PDF (addEventListener, tanpa inline onclick) =====
function setupPdfExports() {
    const bind = function (id, fn) {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', function () { withPdfState(id, fn); });
    };
    bind('export-students-pdf-btn', function () { exportUsersPdf('siswa'); });
    bind('export-teachers-pdf-btn', function () { exportUsersPdf('guru'); });
    bind('export-attendance-pdf-btn', exportRekapDetailPdf);
    bind('export-rekap-mapel-pdf-btn', exportRekapMapelPdf);
    bind('export-master-pdf-btn', exportMasterDataPdf);
}

function describeUserFilters() {
    const parts = [];
    const g = function (id) { const el = document.getElementById(id); return el ? el.value : ''; };
    const sEl = document.getElementById('user-search');
    const s = sEl ? sEl.value : '';
    if (String(s).trim()) parts.push('Cari: ' + String(s).trim());
    if (g('user-filter-kelas')) parts.push('Kelas: ' + g('user-filter-kelas'));
    if (g('user-filter-jurusan')) parts.push('Jurusan: ' + g('user-filter-jurusan'));
    if (g('user-filter-status')) parts.push('Status: ' + g('user-filter-status'));
    return parts.length ? parts.join(' | ') : 'Semua';
}

function describeRekapDetailFilters() {
    const parts = [];
    const g = function (id) { const el = document.getElementById(id); return el ? el.value : ''; };
    if (g('filter-tanggal')) parts.push('Tanggal: ' + g('filter-tanggal'));
    if (g('filter-mapel')) parts.push('Mapel: ' + g('filter-mapel'));
    if (g('filter-kelas')) parts.push('Kelas: ' + g('filter-kelas'));
    if (g('filter-jurusan')) parts.push('Jurusan: ' + g('filter-jurusan'));
    if (g('filter-guru')) parts.push('Guru: ' + g('filter-guru'));
    if (g('filter-status')) parts.push('Status: ' + g('filter-status'));
    return parts.length ? parts.join(' | ') : 'Semua';
}
function exportUsersPdf(role) {
    if (!pdfLibrariesReady()) { pdfLibrariesFail(); return; }
    const rows = getFilteredUsers().filter(function (u) { return u.role === role; });
    const label = role === 'siswa' ? 'DATA SISWA' : 'DATA GURU';
    if (!rows.length) { showToast('Tidak ada data untuk diunduh.', 'warning'); return; }
    const body = rows.map(function (u, i) {
        return [
            String(i + 1),
            u.nis || '-',
            u.nama || '-',
            u.role === 'siswa' ? (u.kelas || '-') : '-',
            u.role === 'siswa' ? (u.jurusan || '-') : '-',
            u.role === 'guru' ? (UserStore.getSubjectNamesOf(u).join(', ') || '-') : '-',
            u.status === 'aktif' ? 'Aktif' : 'Nonaktif'
        ];
    });
    const head = [["No", "NIS/NIP", "Nama", "Kelas", "Jurusan", "Mata Pelajaran", "Status"]];
    const doc = new jspdf.jsPDF({ orientation: 'landscape' });
    pdfBuild(doc, label, describeUserFilters(), head, body);
    const base = role === 'siswa' ? 'data-siswa' : 'data-guru';
    pdfFinalize(doc, base + '-mupa-' + pdfFileDate() + '.pdf');
}

function exportRekapMapelPdf() {
    if (!pdfLibrariesReady()) { pdfLibrariesFail(); return; }
    const data = window.__rekapMapelData || [];
    if (!data.length) { showToast('Tidak ada data untuk diunduh.', 'warning'); return; }
    const g = function (id) { const el = document.getElementById(id); return el ? el.value : ''; };
    let filters = [];
    if (g('filter-tahun')) filters.push('Tahun: ' + g('filter-tahun'));
    if (g('filter-bulan')) filters.push('Bulan: ' + g('filter-bulan'));
    const body = data.map(function (item, i) {
        return [String(i + 1), item.mapelNama || '-', item.guruNama || '-', String(item.sesiCount || 0), String(item.totalKehadiran || 0), String(item.siswaUnik || 0)];
    });
    const head = [["No", "Mata Pelajaran", "Guru", "Jumlah Sesi", "Total Kehadiran", "Siswa Unik"]];
    const doc = new jspdf.jsPDF();
    pdfBuild(doc, 'REKAP PRESENSI PER MAPEL', filters.length ? filters.join(' | ') : 'Semua', head, body);
    pdfFinalize(doc, 'rekap-presensi-mupa-' + pdfFileDate() + '.pdf');
}

function exportRekapDetailPdf() {
    if (!pdfLibrariesReady()) { pdfLibrariesFail(); return; }
    const data = window.__rekapDetailData || [];
    if (!data.length) { showToast('Tidak ada data untuk diunduh.', 'warning'); return; }
    const body = data.map(function (item, i) {
        const d = item.waktuScan ? new Date(item.waktuScan) : null;
        const tgl = d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '-';
        const jam = d && !isNaN(d.getTime()) ? d.toTimeString().slice(0, 5) : '-';
        return [String(i + 1), item.nis || '-', item.studentNama || '-', item.mataPelajaran || '-', item.kelas || '-', item.jurusan || '-', item.guruNama || '-', tgl, jam, item.status || 'hadir'];
    });
    const head = [["No", "NIS", "Nama Siswa", "Mapel", "Kelas", "Jurusan", "Guru", "Tanggal", "Jam", "Status"]];
    const doc = new jspdf.jsPDF({ orientation: 'landscape' });
    pdfBuild(doc, 'REKAP PRESENSI DETAIL', describeRekapDetailFilters(), head, body);
    pdfFinalize(doc, 'riwayat-presensi-mupa-' + pdfFileDate() + '.pdf');
}
function exportMasterDataPdf() {
    if (!pdfLibrariesReady()) { pdfLibrariesFail(); return; }
    const subjects = (typeof AttendanceStore !== 'undefined') ? AttendanceStore.getSubjects() : [];
    const kelas = (typeof AttendanceStore !== 'undefined') ? AttendanceStore.KELAS_LIST : [];
    const jurusan = (typeof AttendanceStore !== 'undefined') ? AttendanceStore.JURUSAN_LIST : [];
    if (!subjects.length && !kelas.length && !jurusan.length) { showToast('Tidak ada data untuk diunduh.', 'warning'); return; }
    const doc = new jspdf.jsPDF();
    let y = 30;
    const section = function (title, head, body) {
        if (!body.length) return;
        if (y > 200) { doc.addPage(); y = 34; }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
        doc.setTextColor(30, 41, 59);
        doc.text(12, y, title);
        pdfRenderTable(doc, {
            head: head,
            body: body,
            startY: y + 4,
            margin: { top: 34, right: 10, bottom: 18, left: 12 },
            theme: 'striped',
            headStyles: { fillColor: [23, 47, 77], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
            styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.5 },
            alternateRowStyles: { fillColor: [242, 245, 249] }
        });
        try { y = doc.getY() + 10; } catch (e) { y += 10; }
    };
    section('Mata Pelajaran', [["No", "Kode", "Nama"]], subjects.map(function (s, i) { return [String(i + 1), s.kode || s.id, s.nama]; }));
    section('Kelas', [["No", "Kelas"]], kelas.map(function (k, i) { return [String(i + 1), k]; }));
    section('Jurusan', [["No", "Jurusan"]], jurusan.map(function (j, i) { return [String(i + 1), j]; }));
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
        doc.setPage(i);
        pdfDrawFooter(doc, i, total);
    }
    pdfFinalize(doc, 'data-master-mupa-' + pdfFileDate() + '.pdf');
}
