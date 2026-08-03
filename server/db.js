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

// Seed data awal jika database kosong
async function seedData() {
  const usersCount = db.get('users').size().value();
  
  if (usersCount === 0) {
    const hashPassword = (password) => bcrypt.hashSync(password, 10);
    
    // Data Kelas
    const kelasData = [
      { id: 'KLS-001', nama: 'X RPL 1', tingkat: 'X', jurusan: 'RPL' },
      { id: 'KLS-002', nama: 'X RPL 2', tingkat: 'X', jurusan: 'RPL' },
      { id: 'KLS-003', nama: 'XI RPL 1', tingkat: 'XI', jurusan: 'RPL' },
      { id: 'KLS-004', nama: 'XI RPL 2', tingkat: 'XI', jurusan: 'RPL' },
      { id: 'KLS-005', nama: 'XII RPL 1', tingkat: 'XII', jurusan: 'RPL' },
      { id: 'KLS-006', nama: 'XII RPL 2', tingkat: 'XII', jurusan: 'RPL' }
    ];
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

    // Data Siswa (contoh 12 siswa)
    const siswaData = [
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
      { id: 'SIS-012', nis: '2024012', nama: 'Laila Fitriani', kelasId: 'KLS-006', email: 'laila@student.smkmuhpakem.sch.id', jurusan: 'RPL' }
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
      },
      {
        id: 'USR-005',
        username: 'andi',
        password: hashPassword('siswa123'),
        role: 'siswa',
        nama: 'Andi Pratama',
        refId: 'SIS-001'
      },
      {
        id: 'USR-006',
        username: 'bella',
        password: hashPassword('siswa123'),
        role: 'siswa',
        nama: 'Bella Safitri',
        refId: 'SIS-002'
      },
      {
        id: 'USR-007',
        username: 'citra',
        password: hashPassword('siswa123'),
        role: 'siswa',
        nama: 'Citra Dewi',
        refId: 'SIS-003'
      },
      {
        id: 'USR-008',
        username: 'dedi',
        password: hashPassword('siswa123'),
        role: 'siswa',
        nama: 'Dedi Kurniawan',
        refId: 'SIS-004'
      },
      {
        id: 'USR-009',
        username: 'eka',
        password: hashPassword('siswa123'),
        role: 'siswa',
        nama: 'Eka Putri',
        refId: 'SIS-005'
      },
      {
        id: 'USR-010',
        username: 'fajar',
        password: hashPassword('siswa123'),
        role: 'siswa',
        nama: 'Fajar Nugroho',
        refId: 'SIS-006'
      },
      {
        id: 'USR-011',
        username: 'galih',
        password: hashPassword('siswa123'),
        role: 'siswa',
        nama: 'Galih Pratomo',
        refId: 'SIS-007'
      },
      {
        id: 'USR-012',
        username: 'hana',
        password: hashPassword('siswa123'),
        role: 'siswa',
        nama: 'Hana Maulida',
        refId: 'SIS-008'
      },
      {
        id: 'USR-013',
        username: 'iqbal',
        password: hashPassword('siswa123'),
        role: 'siswa',
        nama: 'Iqbal Ramadhan',
        refId: 'SIS-009'
      },
      {
        id: 'USR-014',
        username: 'jihan',
        password: hashPassword('siswa123'),
        role: 'siswa',
        nama: 'Jihan Anindya',
        refId: 'SIS-010'
      },
      {
        id: 'USR-015',
        username: 'krisna',
        password: hashPassword('siswa123'),
        role: 'siswa',
        nama: 'Krisna Wijaya',
        refId: 'SIS-011'
      },
      {
        id: 'USR-016',
        username: 'laila',
        password: hashPassword('siswa123'),
        role: 'siswa',
        nama: 'Laila Fitriani',
        refId: 'SIS-012'
      }
    ];
    db.get('users').push(...usersData).write();

    console.log('✅ Database berhasil di-seed dengan data awal (v2)');
  }
}

module.exports = { db, seedData };