const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// Setup database file
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'db.json');
const adapter = new FileSync(dbPath);
const db = low(adapter);

// Default data structure
db.defaults({
  users: [],
  siswa: [],
  guru: [],
  kelas: [],
  mapel: [],
  guruMapel: [],
  sesiPresensi: [],
  logKehadiran: [],
  settings: {
    namaSekolah: 'SMKS Muhammadiyah Pakem',
    jamMasuk: '07:00',
    jamPulang: '15:00',
    batasTerlambat: '07:15'
  }
}).write();

// Daftar jurusan resmi SMKS Muhammadiyah Pakem
const JURUSAN_LIST = ['RPL', 'TKR', 'TSM', 'PBS', 'DPIB'];
const TINGKAT_LIST = ['X', 'XI', 'XII'];

// Helper untuk generate ID kelas
function generateKelasId(tingkat, jurusan, rombel) {
  return `KLS-${tingkat}-${jurusan}-${rombel}`;
}

// Seed data awal jika database kosong
async function seedData() {
  const usersCount = db.get('users').size().value();
  
  if (usersCount === 0) {
    const hashPassword = (password) => bcrypt.hashSync(password, 10);
    
    // Data Kelas - Semua jurusan resmi (RPL, TKR, TSM, PBS, DPIB) x (X, XI, XII)
    const kelasData = [];
    let kelasCounter = 1;
    JURUSAN_LIST.forEach(jurusan => {
      TINGKAT_LIST.forEach(tingkat => {
        // Setiap jurusan & tingkat punya 2 rombel (1 dan 2)
        for (let rombel = 1; rombel <= 2; rombel++) {
          kelasData.push({
            id: `KLS-${String(kelasCounter).padStart(3, '0')}`,
            nama: `${tingkat} ${jurusan} ${rombel}`,
            tingkat,
            jurusan,
            rombel
          });
          kelasCounter++;
        }
      });
    });
    db.get('kelas').push(...kelasData).write();

    // Data Mata Pelajaran
    const mapelData = [
      { id: 'MPL-001', kode: 'RPL-101', nama: 'Pemrograman Web', jurusan: 'RPL' },
      { id: 'MPL-002', kode: 'RPL-102', nama: 'Basis Data', jurusan: 'RPL' },
      { id: 'MPL-003', kode: 'RPL-103', nama: 'Pemrograman Berorientasi Objek', jurusan: 'RPL' },
      { id: 'MPL-004', kode: 'MTK-101', nama: 'Matematika', jurusan: 'Umum' },
      { id: 'MPL-005', kode: 'BIN-101', nama: 'Bahasa Indonesia', jurusan: 'Umum' },
      { id: 'MPL-006', kode: 'BIG-101', nama: 'Bahasa Inggris', jurusan: 'Umum' }
    ];
    db.get('mapel').push(...mapelData).write();

    // Data Guru
    const guruData = [
      { id: 'GRU-001', nip: '197501012005011001', nama: 'Budi Santoso, S.Kom', email: 'budi@smkmuhpakem.sch.id', mapelIds: ['MPL-001', 'MPL-002'], kelasIds: ['KLS-001', 'KLS-002', 'KLS-003'] },
      { id: 'GRU-002', nip: '198002152008012002', nama: 'Siti Rahayu, S.Pd', email: 'siti@smkmuhpakem.sch.id', mapelIds: ['MPL-004'], kelasIds: ['KLS-003', 'KLS-004', 'KLS-005', 'KLS-006'] },
      { id: 'GRU-003', nip: '198503102010011003', nama: 'Ahmad Fauzi, M.Kom', email: 'ahmad@smkmuhpakem.sch.id', mapelIds: ['MPL-003'], kelasIds: ['KLS-001', 'KLS-002', 'KLS-005', 'KLS-006'] }
    ];
    db.get('guru').push(...guruData).write();

    // Relasi Guru-Mapel
    const guruMapelData = [];
    guruData.forEach(guru => {
      guru.mapelIds.forEach(mapelId => {
        guruMapelData.push({
          id: `GMP-${guruMapelData.length + 1}`.padStart(7, '0'),
          guruId: guru.id,
          mapelId: mapelId
        });
      });
    });
    db.get('guruMapel').push(...guruMapelData).write();

    // Data Siswa - mencakup semua jurusan (RPL, TKR, TSM, PBS, DPIB)
    const siswaData = [
      // RPL (KLS-001 s/d KLS-006)
      { id: 'SIS-001', nis: '2024001', nama: 'Andi Pratama', kelasId: 'KLS-001', email: 'andi@student.smkmuhpakem.sch.id', jurusan: 'RPL' },
      { id: 'SIS-002', nis: '2024002', nama: 'Bella Safitri', kelasId: 'KLS-001', email: 'bella@student.smkmuhpakem.sch.id', jurusan: 'RPL' },
      { id: 'SIS-003', nis: '2024003', nama: 'Citra Dewi', kelasId: 'KLS-002', email: 'citra@student.smkmuhpakem.sch.id', jurusan: 'RPL' },
      { id: 'SIS-004', nis: '2024004', nama: 'Dedi Kurniawan', kelasId: 'KLS-002', email: 'dedi@student.smkmuhpakem.sch.id', jurusan: 'RPL' },
      { id: 'SIS-005', nis: '2024005', nama: 'Eka Putri', kelasId: 'KLS-003', email: 'eka@student.smkmuhpakem.sch.id', jurusan: 'RPL' },
      { id: 'SIS-006', nis: '2024006', nama: 'Fajar Nugroho', kelasId: 'KLS-003', email: 'fajar@student.smkmuhpakem.sch.id', jurusan: 'RPL' },
      { id: 'SIS-007', nis: '2024007', nama: 'Galih Pratomo', kelasId: 'KLS-004', email: 'galih@student.smkmuhpakem.sch.id', jurusan: 'RPL' },
      { id: 'SIS-008', nis: '2024008', nama: 'Hana Maulida', kelasId: 'KLS-004', email: 'hana@student.smkmuhpakem.sch.id', jurusan: 'RPL' },
      { id: 'SIS-009', nis: '2024009', nama: 'Iqbal Ramadhan', kelasId: 'KLS-005', email: 'iqbal@student.smkmuhpakem.sch.id', jurusan: 'RPL' },
      { id: 'SIS-010', nis: '2024010', nama: 'Jihan Anindya', kelasId: 'KLS-005', email: 'jihan@student.smkmuhpakem.sch.id', jurusan: 'RPL' },
      { id: 'SIS-011', nis: '2024011', nama: 'Krisna Wijaya', kelasId: 'KLS-006', email: 'krisna@student.smkmuhpakem.sch.id', jurusan: 'RPL' },
      { id: 'SIS-012', nis: '2024012', nama: 'Laila Fitriani', kelasId: 'KLS-006', email: 'laila@student.smkmuhpakem.sch.id', jurusan: 'RPL' },
      // TKR (KLS-007 s/d KLS-012)
      { id: 'SIS-013', nis: '2024013', nama: 'Muhammad Rizki', kelasId: 'KLS-007', email: 'rizki@student.smkmuhpakem.sch.id', jurusan: 'TKR' },
      { id: 'SIS-014', nis: '2024014', nama: 'Nabila Putri', kelasId: 'KLS-007', email: 'nabila@student.smkmuhpakem.sch.id', jurusan: 'TKR' },
      { id: 'SIS-015', nis: '2024015', nama: 'Oki Setiawan', kelasId: 'KLS-008', email: 'oki@student.smkmuhpakem.sch.id', jurusan: 'TKR' },
      { id: 'SIS-016', nis: '2024016', nama: 'Putri Ayu', kelasId: 'KLS-008', email: 'putri@student.smkmuhpakem.sch.id', jurusan: 'TKR' },
      { id: 'SIS-017', nis: '2024017', nama: 'Rendra Pratama', kelasId: 'KLS-009', email: 'rendra@student.smkmuhpakem.sch.id', jurusan: 'TKR' },
      { id: 'SIS-018', nis: '2024018', nama: 'Salsabila', kelasId: 'KLS-009', email: 'salsabila@student.smkmuhpakem.sch.id', jurusan: 'TKR' },
      // TSM (KLS-013 s/d KLS-018)
      { id: 'SIS-019', nis: '2024019', nama: 'Taufik Hidayat', kelasId: 'KLS-013', email: 'taufik@student.smkmuhpakem.sch.id', jurusan: 'TSM' },
      { id: 'SIS-020', nis: '2024020', nama: 'Umar Faruq', kelasId: 'KLS-013', email: 'umar@student.smkmuhpakem.sch.id', jurusan: 'TSM' },
      { id: 'SIS-021', nis: '2024021', nama: 'Vina Rahma', kelasId: 'KLS-014', email: 'vina@student.smkmuhpakem.sch.id', jurusan: 'TSM' },
      { id: 'SIS-022', nis: '2024022', nama: 'Wahyu Nugroho', kelasId: 'KLS-014', email: 'wahyu@student.smkmuhpakem.sch.id', jurusan: 'TSM' },
      { id: 'SIS-023', nis: '2024023', nama: 'Yoga Pratama', kelasId: 'KLS-015', email: 'yoga@student.smkmuhpakem.sch.id', jurusan: 'TSM' },
      { id: 'SIS-024', nis: '2024024', nama: 'Zahra Aulia', kelasId: 'KLS-015', email: 'zahra@student.smkmuhpakem.sch.id', jurusan: 'TSM' },
      // PBS (KLS-019 s/d KLS-024)
      { id: 'SIS-025', nis: '2024025', nama: 'Aisyah Ramadhani', kelasId: 'KLS-019', email: 'aisyah@student.smkmuhpakem.sch.id', jurusan: 'PBS' },
      { id: 'SIS-026', nis: '2024026', nama: 'Bagas Prasetyo', kelasId: 'KLS-019', email: 'bagas@student.smkmuhpakem.sch.id', jurusan: 'PBS' },
      { id: 'SIS-027', nis: '2024027', nama: 'Cahya Ningrum', kelasId: 'KLS-020', email: 'cahya@student.smkmuhpakem.sch.id', jurusan: 'PBS' },
      { id: 'SIS-028', nis: '2024028', nama: 'Dimas Saputra', kelasId: 'KLS-020', email: 'dimas@student.smkmuhpakem.sch.id', jurusan: 'PBS' },
      { id: 'SIS-029', nis: '2024029', nama: 'Erika Puspita', kelasId: 'KLS-021', email: 'erika@student.smkmuhpakem.sch.id', jurusan: 'PBS' },
      { id: 'SIS-030', nis: '2024030', nama: 'Fikri Ramadhan', kelasId: 'KLS-021', email: 'fikri@student.smkmuhpakem.sch.id', jurusan: 'PBS' },
      // DPIB (KLS-025 s/d KLS-030)
      { id: 'SIS-031', nis: '2024031', nama: 'Gilang Ramadhan', kelasId: 'KLS-025', email: 'gilang@student.smkmuhpakem.sch.id', jurusan: 'DPIB' },
      { id: 'SIS-032', nis: '2024032', nama: 'Hesti Pramesti', kelasId: 'KLS-025', email: 'hesti@student.smkmuhpakem.sch.id', jurusan: 'DPIB' },
      { id: 'SIS-033', nis: '2024033', nama: 'Indra Lesmana', kelasId: 'KLS-026', email: 'indra@student.smkmuhpakem.sch.id', jurusan: 'DPIB' },
      { id: 'SIS-034', nis: '2024034', nama: 'Joko Susilo', kelasId: 'KLS-026', email: 'joko@student.smkmuhpakem.sch.id', jurusan: 'DPIB' },
      { id: 'SIS-035', nis: '2024035', nama: 'Kartika Sari', kelasId: 'KLS-027', email: 'kartika@student.smkmuhpakem.sch.id', jurusan: 'DPIB' },
      { id: 'SIS-036', nis: '2024036', nama: 'Lukman Hakim', kelasId: 'KLS-027', email: 'lukman@student.smkmuhpakem.sch.id', jurusan: 'DPIB' }
    ];
    db.get('siswa').push(...siswaData).write();

    // Data Users (Admin, Guru, Siswa)
    const usersData = [
      {
        id: 'USR-001',
        username: 'admin',
        password: hashPassword('admin123'),
        role: 'admin',
        nama: 'Administrator',
        refId: null
      },
      {
        id: 'USR-002',
        username: 'budi',
        password: hashPassword('guru123'),
        role: 'guru',
        nama: 'Budi Santoso, S.Kom',
        refId: 'GRU-001'
      },
      {
        id: 'USR-003',
        username: 'siti',
        password: hashPassword('guru123'),
        role: 'guru',
        nama: 'Siti Rahayu, S.Pd',
        refId: 'GRU-002'
      },
      {
        id: 'USR-004',
        username: 'ahmad',
        password: hashPassword('guru123'),
        role: 'guru',
        nama: 'Ahmad Fauzi, M.Kom',
        refId: 'GRU-003'
      }
    ];

    // Generate user untuk semua siswa secara otomatis
    const guruCount = usersData.length;
    siswaData.forEach((siswa, index) => {
      const firstName = siswa.nama.toLowerCase().split(' ')[0];
      usersData.push({
        id: `USR-${String(guruCount + index + 1).padStart(3, '0')}`,
        username: firstName,
        password: hashPassword('siswa123'),
        role: 'siswa',
        nama: siswa.nama,
        refId: siswa.id
      });
    });

    db.get('users').push(...usersData).write();

    console.log('✅ Database berhasil di-seed dengan data awal (v2)');
  }
}

module.exports = { db, seedData };