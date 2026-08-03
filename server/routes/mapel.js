const express = require('express');
const { db } = require('../db');
const { authenticateToken, authorizeAdminGuru, authorizeAdmin } = require('../middleware/auth');

const router = express.Router();

// Helper untuk generate ID
function generateId(prefix) {
  const count = db.get('mapel').size().value() + 1;
  return `${prefix}-${String(count).padStart(3, '0')}`;
}

// GET /api/mapel - Mendapatkan semua mata pelajaran
router.get('/', authenticateToken, authorizeAdminGuru, (req, res) => {
  try {
    const mapelList = db.get('mapel').value();
    
    // Tambahkan jumlah guru pengampu
    const result = mapelList.map(mapel => {
      const jumlahGuru = db.get('guruMapel').filter({ mapelId: mapel.id }).size().value();
      return { ...mapel, jumlahGuru };
    });

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get mapel error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// GET /api/mapel/guru/:guruId - Mendapatkan mapel yang diampu guru
router.get('/guru/:guruId', authenticateToken, authorizeAdminGuru, (req, res) => {
  try {
    const guruMapel = db.get('guruMapel').filter({ guruId: req.params.guruId }).value();
    
    const result = guruMapel.map(gm => {
      const mapel = db.get('mapel').find({ id: gm.mapelId }).value();
      return mapel ? { ...mapel } : null;
    }).filter(Boolean);

    res.json({ success: true, data: result });
  } catch (error) {
    console.error('Get mapel by guru error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// GET /api/mapel/:id - Mendapatkan mapel berdasarkan ID
router.get('/:id', authenticateToken, authorizeAdminGuru, (req, res) => {
  try {
    const mapel = db.get('mapel').find({ id: req.params.id }).value();

    if (!mapel) {
      return res.status(404).json({ success: false, message: 'Mata pelajaran tidak ditemukan.' });
    }

    res.json({ success: true, data: mapel });
  } catch (error) {
    console.error('Get mapel by id error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// POST /api/mapel - Menambah mata pelajaran baru
router.post('/', authenticateToken, authorizeAdmin, (req, res) => {
  try {
    const { kode, nama, jurusan } = req.body;

    // Validasi input
    if (!kode || !nama || !jurusan) {
      return res.status(400).json({
        success: false,
        message: 'Kode, Nama, dan Jurusan wajib diisi.'
      });
    }

    // Cek kode duplikat
    const existingKode = db.get('mapel').find({ kode }).value();
    if (existingKode) {
      return res.status(400).json({
        success: false,
        message: 'Kode mata pelajaran sudah terdaftar.'
      });
    }

    const newMapel = {
      id: generateId('MPL'),
      kode,
      nama,
      jurusan
    };

    db.get('mapel').push(newMapel).write();

    res.status(201).json({
      success: true,
      message: 'Mata pelajaran berhasil ditambahkan.',
      data: newMapel
    });
  } catch (error) {
    console.error('Create mapel error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// PUT /api/mapel/:id - Mengupdate mata pelajaran
router.put('/:id', authenticateToken, authorizeAdmin, (req, res) => {
  try {
    const { kode, nama, jurusan } = req.body;
    const mapel = db.get('mapel').find({ id: req.params.id }).value();

    if (!mapel) {
      return res.status(404).json({ success: false, message: 'Mata pelajaran tidak ditemukan.' });
    }

    // Cek kode duplikat (jika diubah)
    if (kode && kode !== mapel.kode) {
      const existingKode = db.get('mapel').find({ kode }).value();
      if (existingKode) {
        return res.status(400).json({ success: false, message: 'Kode mata pelajaran sudah terdaftar.' });
      }
    }

    db.get('mapel')
      .find({ id: req.params.id })
      .assign({
        kode: kode || mapel.kode,
        nama: nama || mapel.nama,
        jurusan: jurusan || mapel.jurusan
      })
      .write();

    const updatedMapel = db.get('mapel').find({ id: req.params.id }).value();
    res.json({
      success: true,
      message: 'Mata pelajaran berhasil diupdate.',
      data: updatedMapel
    });
  } catch (error) {
    console.error('Update mapel error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// DELETE /api/mapel/:id - Menghapus mata pelajaran
router.delete('/:id', authenticateToken, authorizeAdmin, (req, res) => {
  try {
    const mapel = db.get('mapel').find({ id: req.params.id }).value();

    if (!mapel) {
      return res.status(404).json({ success: false, message: 'Mata pelajaran tidak ditemukan.' });
    }

    // Hapus relasi guru-mapel
    db.get('guruMapel').remove({ mapelId: req.params.id }).write();
    
    // Hapus mapel
    db.get('mapel').remove({ id: req.params.id }).write();

    res.json({ success: true, message: 'Mata pelajaran berhasil dihapus.' });
  } catch (error) {
    console.error('Delete mapel error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

module.exports = router;