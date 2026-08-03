const express = require('express');
const { db } = require('../db');
const { authenticateToken, authorizeAdminGuru, authorizeAdmin } = require('../middleware/auth');

const router = express.Router();

// Helper untuk generate ID
function generateId(prefix) {
  const count = db.get('kelas').size().value() + 1;
  return `${prefix}-${String(count).padStart(3, '0')}`;
}

// GET /api/kelas - Mendapatkan semua data kelas
router.get('/', authenticateToken, authorizeAdminGuru, (req, res) => {
  try {
    const kelasList = db.get('kelas').value();
    
    // Tambahkan jumlah siswa per kelas
    const result = kelasList.map(kelas => {
      const jumlahSiswa = db.get('siswa').filter({ kelasId: kelas.id }).size().value();
      return { ...kelas, jumlahSiswa };
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get kelas error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// GET /api/kelas/:id - Mendapatkan data kelas berdasarkan ID
router.get('/:id', authenticateToken, authorizeAdminGuru, (req, res) => {
  try {
    const kelas = db.get('kelas').find({ id: req.params.id }).value();

    if (!kelas) {
      return res.status(404).json({ success: false, message: 'Kelas tidak ditemukan.' });
    }

    const siswaList = db.get('siswa').filter({ kelasId: kelas.id }).value();
    res.json({
      success: true,
      data: { ...kelas, siswa: siswaList }
    });
  } catch (error) {
    console.error('Get kelas by id error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// POST /api/kelas - Menambah data kelas baru
router.post('/', authenticateToken, authorizeAdmin, (req, res) => {
  try {
    const { nama, tingkat, jurusan } = req.body;

    // Validasi input
    if (!nama || !tingkat || !jurusan) {
      return res.status(400).json({
        success: false,
        message: 'Nama, Tingkat, dan Jurusan wajib diisi.'
      });
    }

    // Cek nama kelas duplikat
    const existingKelas = db.get('kelas').find({ nama }).value();
    if (existingKelas) {
      return res.status(400).json({
        success: false,
        message: 'Nama kelas sudah terdaftar.'
      });
    }

    const newKelas = {
      id: generateId('KLS'),
      nama,
      tingkat,
      jurusan
    };

    db.get('kelas').push(newKelas).write();

    res.status(201).json({
      success: true,
      message: 'Data kelas berhasil ditambahkan.',
      data: newKelas
    });
  } catch (error) {
    console.error('Create kelas error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// PUT /api/kelas/:id - Mengupdate data kelas
router.put('/:id', authenticateToken, authorizeAdmin, (req, res) => {
  try {
    const { nama, tingkat, jurusan } = req.body;
    const kelas = db.get('kelas').find({ id: req.params.id }).value();

    if (!kelas) {
      return res.status(404).json({ success: false, message: 'Kelas tidak ditemukan.' });
    }

    // Cek nama kelas duplikat (jika diubah)
    if (nama && nama !== kelas.nama) {
      const existingKelas = db.get('kelas').find({ nama }).value();
      if (existingKelas) {
        return res.status(400).json({ success: false, message: 'Nama kelas sudah terdaftar.' });
      }
    }

    db.get('kelas')
      .find({ id: req.params.id })
      .assign({
        nama: nama || kelas.nama,
        tingkat: tingkat || kelas.tingkat,
        jurusan: jurusan || kelas.jurusan
      })
      .write();

    const updatedKelas = db.get('kelas').find({ id: req.params.id }).value();
    res.json({
      success: true,
      message: 'Data kelas berhasil diupdate.',
      data: updatedKelas
    });
  } catch (error) {
    console.error('Update kelas error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// DELETE /api/kelas/:id - Menghapus data kelas
router.delete('/:id', authenticateToken, authorizeAdmin, (req, res) => {
  try {
    const kelas = db.get('kelas').find({ id: req.params.id }).value();

    if (!kelas) {
      return res.status(404).json({ success: false, message: 'Kelas tidak ditemukan.' });
    }

    // Cek apakah ada siswa di kelas ini
    const jumlahSiswa = db.get('siswa').filter({ kelasId: req.params.id }).size().value();
    if (jumlahSiswa > 0) {
      return res.status(400).json({
        success: false,
        message: `Tidak dapat menghapus kelas karena masih ada ${jumlahSiswa} siswa di kelas ini.`
      });
    }

    db.get('kelas').remove({ id: req.params.id }).write();

    res.json({
      success: true,
      message: 'Data kelas berhasil dihapus.'
    });
  } catch (error) {
    console.error('Delete kelas error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

module.exports = router;