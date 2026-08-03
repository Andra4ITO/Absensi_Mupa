const express = require('express');
const { db } = require('../db');
const { authenticateToken, authorizeAdminGuru, authorizeRole } = require('../middleware/auth');

const router = express.Router();

// Helper untuk format tanggal
function formatTanggal(date) {
  return date.toISOString().split('T')[0];
}

// GET /api/presensi/riwayat - Riwayat kehadiran siswa yang login
router.get('/riwayat', authenticateToken, (req, res) => {
  try {
    if (req.user.role !== 'siswa') {
      return res.status(403).json({
        success: false,
        message: 'Endpoint ini khusus untuk siswa.'
      });
    }

    const siswaId = req.user.refId;
    const { bulan, tahun } = req.query;
    
    let presensiList = db.get('logKehadiran')
      .filter({ siswaId })
      .orderBy('timestamp', 'desc')
      .value();

    // Filter berdasarkan bulan dan tahun jika diberikan
    if (bulan && tahun) {
      const bulanStr = String(bulan).padStart(2, '0');
      presensiList = presensiList.filter(p => {
        const [t, b] = p.tanggal.split('-');
        return t === String(tahun) && b === bulanStr;
      });
    }

    // Tambahkan info sesi/mapel
    const result = presensiList.map(log => {
      const sesi = db.get('sesiPresensi').find({ id: log.sesiId }).value();
      return {
        ...log,
        guruNama: sesi ? sesi.guruNama : null,
        mapelKode: sesi ? sesi.mapelKode : null
      };
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get riwayat presensi error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// GET /api/presensi/rekap - Rekap kehadiran (admin/guru) berdasarkan mapel
router.get('/rekap', authenticateToken, authorizeAdminGuru, (req, res) => {
  try {
    const { tanggal, bulan, tahun, mapelId, kelasId } = req.query;
    let logList = db.get('logKehadiran').value();

    // Filter berdasarkan tanggal
    if (tanggal) {
      logList = logList.filter(p => p.tanggal === tanggal);
    }

    // Filter berdasarkan bulan dan tahun
    if (bulan && tahun) {
      const bulanStr = String(bulan).padStart(2, '0');
      logList = logList.filter(p => {
        const [t, b] = p.tanggal.split('-');
        return t === String(tahun) && b === bulanStr;
      });
    }

    // Filter berdasarkan mapel
    if (mapelId) {
      logList = logList.filter(p => p.mapelId === mapelId);
    }

    // Filter berdasarkan kelas
    if (kelasId) {
      logList = logList.filter(p => p.kelasId === kelasId);
    }

    // Tambahkan info siswa
    const result = logList.map(log => {
      const siswa = db.get('siswa').find({ id: log.siswaId }).value();
      return {
        ...log,
        siswa: siswa ? { id: siswa.id, nis: siswa.nis, nama: siswa.nama, jurusan: siswa.jurusan } : null
      };
    });

    // Hitung statistik
    const total = result.length;
    const siswaHadir = new Set(result.map(r => r.siswaId)).size;

    res.json({
      success: true,
      data: result,
      statistik: { total, siswaHadir }
    });
  } catch (error) {
    console.error('Get rekap presensi error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// GET /api/presensi/rekap/mapel - Rekap kehadiran per mapel (agregat untuk dashboard admin)
router.get('/rekap/mapel', authenticateToken, authorizeAdminGuru, (req, res) => {
  try {
    const { bulan, tahun } = req.query;
    let logList = db.get('logKehadiran').value();

    // Filter bulan dan tahun
    if (bulan && tahun) {
      const bulanStr = String(bulan).padStart(2, '0');
      logList = logList.filter(p => {
        const [t, b] = p.tanggal.split('-');
        return t === String(tahun) && b === bulanStr;
      });
    }

    // Kelompokkan berdasarkan mapel
    const mapelMap = {};
    logList.forEach(log => {
      if (!mapelMap[log.mapelId]) {
        const mapel = db.get('mapel').find({ id: log.mapelId }).value();
        mapelMap[log.mapelId] = {
          mapelId: log.mapelId,
          mapelNama: log.mapelNama,
          mapelKode: mapel ? mapel.kode : '',
          guruNama: log.guruNama || '-',
          sesiCount: 0,
          totalKehadiran: 0,
          siswaHadir: new Set()
        };
      }
      mapelMap[log.mapelId].totalKehadiran++;
      mapelMap[log.mapelId].siswaHadir.add(log.siswaId);
    });

    // Tambahkan sesi count per mapel
    const sesiList = db.get('sesiPresensi').value();
    Object.keys(mapelMap).forEach(mapelId => {
      const sesiMapel = sesiList.filter(s => s.mapelId === mapelId && s.status !== 'aktif');
      if (bulan && tahun) {
        const bulanStr = String(bulan).padStart(2, '0');
        mapelMap[mapelId].sesiCount = sesiMapel.filter(s => {
          const [t, b] = s.dibukaPada.split('T')[0].split('-');
          return t === String(tahun) && b === bulanStr;
        }).length;
      } else {
        mapelMap[mapelId].sesiCount = sesiMapel.length;
      }
      mapelMap[mapelId].siswaUnik = mapelMap[mapelId].siswaHadir.size;
      delete mapelMap[mapelId].siswaHadir;
    });

    const result = Object.values(mapelMap);

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get rekap per mapel error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// GET /api/presensi/dashboard - Data untuk dashboard admin/guru
router.get('/dashboard', authenticateToken, authorizeAdminGuru, (req, res) => {
  try {
    const today = formatTanggal(new Date());
    const now = new Date();
    const bulanIni = now.getMonth() + 1;
    const tahunIni = now.getFullYear();
    const bulanStr = String(bulanIni).padStart(2, '0');

    // Statistik sesi hari ini
    const sesiHariIni = db.get('sesiPresensi').filter(s => {
      return s.dibukaPada.split('T')[0] === today;
    }).value();
    
    const sesiAktif = db.get('sesiPresensi').filter({ status: 'aktif' }).value();
    const totalSiswa = db.get('siswa').size().value();
    const totalGuru = db.get('guru').size().value();
    const totalMapel = db.get('mapel').size().value();

    // Kehadiran hari ini
    const hadirHariIni = db.get('logKehadiran').filter({ tanggal: today }).value();
    const siswaHadirHariIni = new Set(hadirHariIni.map(h => h.siswaId)).size;

    // Kehadiran bulan ini
    const logBulanIni = db.get('logKehadiran').filter(p => {
      const [t, b] = p.tanggal.split('-');
      return t === String(tahunIni) && b === bulanStr;
    }).value();

    // Sesi terbaru (5)
    const sesiTerbaru = db.get('sesiPresensi')
      .orderBy('dibukaPada', 'desc')
      .take(5)
      .value()
      .map(sesi => {
        const totalHadir = db.get('logKehadiran').filter({ sesiId: sesi.id }).size().value();
        return { ...sesi, jumlahHadir: totalHadir };
      });

    res.json({
      success: true,
      data: {
        statistik: {
          totalSiswa,
          totalGuru,
          totalMapel,
          sesiHariIni: sesiHariIni.length,
          sesiAktif: sesiAktif.length,
          hadirHariIni: siswaHadirHariIni,
          totalKehadiranBulanIni: logBulanIni.length
        },
        sesiTerbaru
      }
    });
  } catch (error) {
    console.error('Get dashboard error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

module.exports = router;