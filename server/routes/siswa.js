const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { authenticateToken, authorizeAdminGuru, authorizeAdmin } = require('../middleware/auth');

const router = express.Router();

// Helper untuk generate ID
function generateId(prefix) {
  const count = db.get('siswa').size().value() + 1;
  return `${prefix}-${String(count).padStart(3, '0')}`;
}

// GET /api/siswa - Mendapatkan semua data siswa
router.get('/', authenticateToken, authorizeAdminGuru, (req, res) => {
  try {
    const siswaList = db.get('siswa').value();
    
    // Tambahkan info kelas
    const result = siswaList.map(siswa => {
      const kelas = db.get('kelas').find({ id: siswa.kelasId }).value();
      return { ...siswa, kelas: kelas ? kelas.nama : 'Tidak ada kelas' };
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get siswa error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// GET /api/siswa/:id - Mendapatkan data siswa berdasarkan ID
router.get('/:id', authenticateToken, authorizeAdminGuru, (req, res) => {
  try {
    const siswa = db.get('siswa').find({ id: req.params.id }).value();

    if (!siswa) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan.' });
    }

    const kelas = db.get('kelas').find({ id: siswa.kelasId }).value();
    res.json({
      success: true,
      data: { ...siswa, kelas: kelas ? kelas.nama : 'Tidak ada kelas' }
    });
  } catch (error) {
    console.error('Get siswa by id error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// POST /api/siswa - Menambah data siswa baru
router.post('/', authenticateToken, authorizeAdmin, (req, res) => {
  try {
    const { nis, nama, kelasId, email } = req.body;

    // Validasi input
    if (!nis || !nama || !kelasId) {
      return res.status(400).json({
        success: false,
        message: 'NIS, Nama, dan Kelas wajib diisi.'
      });
    }

    // Cek NIS duplikat
    const existingNis = db.get('siswa').find({ nis }).value();
    if (existingNis) {
      return res.status(400).json({
        success: false,
        message: 'NIS sudah terdaftar.'
      });
    }

    // Cek kelas ada
    const kelas = db.get('kelas').find({ id: kelasId }).value();
    if (!kelas) {
      return res.status(400).json({
        success: false,
        message: 'Kelas tidak ditemukan.'
      });
    }

    const newSiswa = {
      id: generateId('SIS'),
      nis,
      nama,
      kelasId,
      email: email || `${nis}@student.smkmuhpakem.sch.id`
    };

    db.get('siswa').push(newSiswa).write();

    // Buat user login untuk siswa
    const username = nama.toLowerCase().split(' ')[0];
    const newUser = {
      id: `USR-${String(db.get('users').size().value() + 1).padStart(3, '0')}`,
      username,
      password: bcrypt.hashSync('siswa123', 10),
      role: 'siswa',
      nama,
      refId: newSiswa.id
    };
    db.get('users').push(newUser).write();

    res.status(201).json({
      success: true,
      message: 'Data siswa berhasil ditambahkan.',
      data: newSiswa,
      user: { username, password: 'siswa123' }
    });
  } catch (error) {
    console.error('Create siswa error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// PUT /api/siswa/:id - Mengupdate data siswa
router.put('/:id', authenticateToken, authorizeAdmin, (req, res) => {
  try {
    const { nis, nama, kelasId, email } = req.body;
    const siswa = db.get('siswa').find({ id: req.params.id }).value();

    if (!siswa) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan.' });
    }

    // Cek NIS duplikat (jika diubah)
    if (nis && nis !== siswa.nis) {
      const existingNis = db.get('siswa').find({ nis }).value();
      if (existingNis) {
        return res.status(400).json({ success: false, message: 'NIS sudah terdaftar.' });
      }
    }

    // Cek kelas ada (jika diubah)
    if (kelasId) {
      const kelas = db.get('kelas').find({ id: kelasId }).value();
      if (!kelas) {
        return res.status(400).json({ success: false, message: 'Kelas tidak ditemukan.' });
      }
    }

    db.get('siswa')
      .find({ id: req.params.id })
      .assign({
        nis: nis || siswa.nis,
        nama: nama || siswa.nama,
        kelasId: kelasId || siswa.kelasId,
        email: email || siswa.email
      })
      .write();

    const updatedSiswa = db.get('siswa').find({ id: req.params.id }).value();
    res.json({
      success: true,
      message: 'Data siswa berhasil diupdate.',
      data: updatedSiswa
    });
  } catch (error) {
    console.error('Update siswa error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// DELETE /api/siswa/:id - Menghapus data siswa
router.delete('/:id', authenticateToken, authorizeAdmin, (req, res) => {
  try {
    const siswa = db.get('siswa').find({ id: req.params.id }).value();

    if (!siswa) {
      return res.status(404).json({ success: false, message: 'Siswa tidak ditemukan.' });
    }

    // Hapus user terkait
    db.get('users').remove({ refId: req.params.id, role: 'siswa' }).write();
    
    // Hapus data siswa
    db.get('siswa').remove({ id: req.params.id }).write();

    res.json({
      success: true,
      message: 'Data siswa berhasil dihapus.'
    });
  } catch (error) {
    console.error('Delete siswa error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

module.exports = router;