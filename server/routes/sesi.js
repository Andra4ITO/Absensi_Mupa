const express = require('express');
const QRCode = require('qrcode');
const { db } = require('../db');
const { authenticateToken, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// Store sesi aktif di memory (untuk akses Cepat dari Socket.io)
const activeSessions = new Map();

// Helper untuk generate ID sesi
function generateSesiId() {
  const count = db.get('sesiPresensi').size().value() + 1;
  return `SES-${String(count).padStart(4, '0')}`;
}

// Helper untuk generate kode unik (token) sesi
function generateSesiToken() {
  return `QR-${Date.now()}-${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
}

// Helper format tanggal
function formatTanggal(date) {
  return date.toISOString().split('T')[0];
}

function formatWaktu(date) {
  const d = new Date(date);
  return d.toTimeString().split(' ')[0];
}

// Helper untuk cek/jika sesi sudah expired otomatis (misal > 3 jam)
function isSesiExpired(sesi) {
  const createdAt = new Date(sesi.dibuatPada).getTime();
  const now = Date.now();
  const maxDuration = 3 * 60 * 60 * 1000; // 3 jam
  return (now - createdAt) > maxDuration;
}

// POST /api/sesi/buka - Guru membuka sesi presensi
router.post('/buka', authenticateToken, authorizeRole('guru', 'admin'), async (req, res) => {
  try {
    const { mapelId, kelasId } = req.body;

    if (!mapelId || !kelasId) {
      return res.status(400).json({
        success: false,
        message: 'Mata pelajaran dan kelas wajib dipilih.'
      });
    }

    // Validasi mapel ada
    const mapel = db.get('mapel').find({ id: mapelId }).value();
    if (!mapel) {
      return res.status(404).json({ success: false, message: 'Mata pelajaran tidak ditemukan.' });
    }

    // Validasi kelas ada
    const kelas = db.get('kelas').find({ id: kelasId }).value();
    if (!kelas) {
      return res.status(404).json({ success: false, message: 'Kelas tidak ditemukan.' });
    }

    // Jika guru (bukan admin), validasi bahwa guru mengampu mapel ini
    if (req.user.role === 'guru' && req.user.refId) {
      const guruMapel = db.get('guruMapel')
        .find({ guruId: req.user.refId, mapelId })
        .value();
      
      if (!guruMapel) {
        return res.status(403).json({
          success: false,
          message: 'Anda tidak mengampu mata pelajaran ini.'
        });
      }
    }

    // Cek apakah guru masih punya sesi aktif
    const activeSesi = db.get('sesiPresensi')
      .filter({ guruId: req.user.refId, status: 'aktif' })
      .value();
    
    if (activeSesi.length > 0) {
      // Mark sesi lama sebagai expired jika terlalu lama
      const sesiLama = activeSesi[0];
      if (isSesiExpired(sesiLama)) {
        db.get('sesiPresensi')
          .find({ id: sesiLama.id })
          .assign({ status: 'expired', ditutupPada: new Date().toISOString() })
          .write();
        
        activeSessions.delete(sesiLama.id);
      } else {
        return res.status(400).json({
          success: false,
          message: 'Anda masih memiliki sesi presensi yang aktif. Silakan tutup sesi terlebih dahulu.'
        });
      }
    }

    // Buat sesi baru
    const sesiToken = generateSesiToken();
    const sesiData = {
      id: generateSesiId(),
      token: sesiToken,
      guruId: req.user.refId,
      guruNama: req.user.nama,
      mapelId,
      mapelNama: mapel.nama,
      mapelKode: mapel.kode,
      kelasId,
      kelasNama: kelas.nama,
      status: 'aktif',
      dibukaPada: new Date().toISOString(),
      ditutupPada: null,
      jumlahHadir: 0
    };

    db.get('sesiPresensi').push(sesiData).write();

    // Generate QR Code sebagai data URL
    const qrData = JSON.stringify({
      type: 'PRESENSI_SESI',
      sesiId: sesiData.id,
      token: sesiToken,
      mapel: mapel.nama,
      guru: req.user.nama,
      kelas: kelas.nama,
      timestamp: new Date().toISOString()
    });

    const qrCodeDataUrl = await QRCode.toDataURL(qrData, {
      width: 300,
      margin: 1,
      color: {
        dark: '#14532d',
        light: '#ffffff'
      }
    });

    // Simpan sesi aktif di memory
    activeSessions.set(sesiData.id, {
      ...sesiData,
      qrCodeDataUrl,
      studentsChecked: new Set()
    });

    res.status(201).json({
      success: true,
      message: 'Sesi presensi berhasil dibuka.',
      data: {
        ...sesiData,
        qrCodeDataUrl,
        qrData
      }
    });
  } catch (error) {
    console.error('Buka sesi error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// POST /api/sesi/tutup - Guru menutup sesi presensi
router.post('/tutup/:sesiId', authenticateToken, authorizeRole('guru', 'admin'), (req, res) => {
  try {
    const sesi = db.get('sesiPresensi').find({ id: req.params.sesiId }).value();

    if (!sesi) {
      return res.status(404).json({ success: false, message: 'Sesi presensi tidak ditemukan.' });
    }

    // Validasi guru yang sama atau admin
    if (req.user.role === 'guru' && sesi.guruId !== req.user.refId) {
      return res.status(403).json({
        success: false,
        message: 'Anda tidak memiliki izin untuk menutup sesi ini.'
      });
    }

    if (sesi.status !== 'aktif') {
      return res.status(400).json({ success: false, message: 'Sesi sudah tidak aktif.' });
    }

    // Hitung jumlah hadir
    const jumlahHadir = db.get('logKehadiran')
      .filter({ sesiId: sesi.id })
      .size()
      .value();

    db.get('sesiPresensi')
      .find({ id: sesi.id })
      .assign({
        status: 'ditutup',
        ditutupPada: new Date().toISOString(),
        jumlahHadir
      })
      .write();

    // Hapus dari active sessions
    activeSessions.delete(sesi.id);

    res.json({
      success: true,
      message: 'Sesi presensi berhasil ditutup.',
      data: { ...sesi, jumlahHadir, status: 'ditutup' }
    });
  } catch (error) {
    console.error('Tutup sesi error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// GET /api/sesi/aktif - Mendapatkan semua sesi aktif (admin melihat)
router.get('/aktif', authenticateToken, authorizeRole('admin'), (req, res) => {
  try {
    const sesiList = db.get('sesiPresensi').filter({ status: 'aktif' }).value();

    const result = sesiList.map(sesi => {
      const jumlahHadir = db.get('logKehadiran')
        .filter({ sesiId: sesi.id })
        .size()
        .value();
      return { ...sesi, jumlahHadir };
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get semua sesi aktif error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// GET /api/sesi/aktif/guru/:guruId - Mendapatkan sesi aktif untuk guru tertentu
router.get('/aktif/guru/:guruId', authenticateToken, authorizeRole('guru', 'admin'), (req, res) => {
  try {
    const sesiList = db.get('sesiPresensi')
      .filter({ guruId: req.params.guruId, status: 'aktif' })
      .value();

    // Tambahkan jumlah hadir dari log kehadiran
    const result = sesiList.map(sesi => {
      const jumlahHadir = db.get('logKehadiran')
        .filter({ sesiId: sesi.id })
        .size()
        .value();
      return { ...sesi, jumlahHadir };
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get sesi aktif error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// GET /api/sesi/riwayat/guru/:guruId - Riwayat sesi untuk guru
router.get('/riwayat/guru/:guruId', authenticateToken, authorizeRole('guru', 'admin'), (req, res) => {
  try {
    const sesiList = db.get('sesiPresensi')
      .filter({ guruId: req.params.guruId })
      .orderBy('dibukaPada', 'desc')
      .value();

    const result = sesiList.map(sesi => {
      const jumlahHadir = db.get('logKehadiran')
        .filter({ sesiId: sesi.id })
        .size()
        .value();
      return { ...sesi, jumlahHadir };
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get riwayat sesi error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// GET /api/sesi/:sesiId - Mendapatkan detail sesi + daftar hadir
router.get('/:sesiId', authenticateToken, authorizeRole('guru', 'admin'), (req, res) => {
  try {
    const sesi = db.get('sesiPresensi').find({ id: req.params.sesiId }).value();

    if (!sesi) {
      return res.status(404).json({ success: false, message: 'Sesi presensi tidak ditemukan.' });
    }

    // Ambil log kehadiran sesi ini
    const logs = db.get('logKehadiran').filter({ sesiId: sesi.id }).value();

    // Detail lengkap dengan info siswa
    const kehadiran = logs.map(log => {
      const siswa = db.get('siswa').find({ id: log.siswaId }).value();
      const kelas = siswa ? db.get('kelas').find({ id: siswa.kelasId }).value() : null;
      return {
        ...log,
        siswa: siswa ? {
          id: siswa.id,
          nis: siswa.nis,
          nama: siswa.nama,
          jurusan: siswa.jurusan
        } : null,
        kelas: kelas ? kelas.nama : null
      };
    });

    res.json({
      success: true,
      data: {
        ...sesi,
        kehadiran,
        jumlahHadir: kehadiran.length
      }
    });
  } catch (error) {
    console.error('Get sesi detail error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// Fungsi untuk memproses kehadiran dari Socket.io scan QR
async function prosesScanQR(sesiId, siswaId) {
  const sesi = db.get('sesiPresensi').find({ id: sesiId }).value();
  
  if (!sesi) {
    return { success: false, message: 'Sesi presensi tidak ditemukan.' };
  }

  if (sesi.status !== 'aktif') {
    return { success: false, message: 'Sesi presensi sudah tidak aktif.' };
  }

  if (isSesiExpired(sesi)) {
    db.get('sesiPresensi')
      .find({ id: sesiId })
      .assign({ status: 'expired' })
      .write();
    return { success: false, message: 'Sesi presensi sudah kadaluarsa.' };
  }

  const siswa = db.get('siswa').find({ id: siswaId }).value();
  if (!siswa) {
    return { success: false, message: 'Data siswa tidak ditemukan.' };
  }

  // Validasi siswa berada di kelas sesi
  if (siswa.kelasId !== sesi.kelasId) {
    return { 
      success: false, 
      message: `Siswa ${siswa.nama} bukan dari kelas ${sesi.kelasNama}.` 
    };
  }

  // Cek apakah sudah pernah absen di sesi ini
  const existingLog = db.get('logKehadiran')
    .find({ sesiId, siswaId })
    .value();

  if (existingLog) {
    return { 
      success: false, 
      message: `${siswa.nama} sudah tercatat hadir pada sesi ini.`,
      data: existingLog
    };
  }

  // Catat kehadiran
  const now = new Date();
  const logData = {
    id: `LOG-${Date.now()}`,
    sesiId,
    siswaId,
    siswaNama: siswa.nama,
    siswaNis: siswa.nis,
    kelasId: siswa.kelasId,
    kelasNama: sesi.kelasNama,
    mapelId: sesi.mapelId,
    mapelNama: sesi.mapelNama,
    timestamp: now.toISOString(),
    tanggal: formatTanggal(now),
    jam: formatWaktu(now)
  };

  db.get('logKehadiran').push(logData).write();

  // Update jumlah hadir di sesi
  const jumlahHadir = db.get('logKehadiran').filter({ sesiId }).size().value();
  db.get('sesiPresensi')
    .find({ id: sesiId })
    .assign({ jumlahHadir })
    .write();

  return { 
    success: true, 
    message: `${siswa.nama} berhasil tercatat hadir.`, 
    data: logData 
  };
}

module.exports = { router, activeSessions, prosesScanQR };