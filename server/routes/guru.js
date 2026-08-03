const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db');
const { authenticateToken, authorizeAdminGuru, authorizeAdmin } = require('../middleware/auth');

const router = express.Router();

// Helper untuk generate ID
function generateId(prefix) {
  const count = db.get('guru').size().value() + 1;
  return `${prefix}-${String(count).padStart(3, '0')}`;
}

// GET /api/guru - Mendapatkan semua data guru
router.get('/', authenticateToken, authorizeAdminGuru, (req, res) => {
  try {
    const guruList = db.get('guru').value();
    
    // Tambahkan info kelas
    const result = guruList.map(guru => {
      const kelasList = (guru.kelasId || []).map(kelasId => {
        const kelas = db.get('kelas').find({ id: kelasId }).value();
        return kelas ? kelas.nama : null;
      }).filter(Boolean);
      return { ...guru, kelasList };
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('Get guru error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// GET /api/guru/:id - Mendapatkan data guru berdasarkan ID
router.get('/:id', authenticateToken, authorizeAdminGuru, (req, res) => {
  try {
    const guru = db.get('guru').find({ id: req.params.id }).value();

    if (!guru) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan.' });
    }

    const kelasList = (guru.kelasId || []).map(kelasId => {
      const kelas = db.get('kelas').find({ id: kelasId }).value();
      return kelas ? kelas.nama : null;
    }).filter(Boolean);

    res.json({
      success: true,
      data: { ...guru, kelasList }
    });
  } catch (error) {
    console.error('Get guru by id error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// POST /api/guru - Menambah data guru baru
router.post('/', authenticateToken, authorizeAdmin, (req, res) => {
  try {
    const { nip, nama, email, mapel, kelasId } = req.body;

    // Validasi input
    if (!nip || !nama || !mapel) {
      return res.status(400).json({
        success: false,
        message: 'NIP, Nama, dan Mata Pelajaran wajib diisi.'
      });
    }

    // Cek NIP duplikat
    const existingNip = db.get('guru').find({ nip }).value();
    if (existingNip) {
      return res.status(400).json({
        success: false,
        message: 'NIP sudah terdaftar.'
      });
    }

    const newGuru = {
      id: generateId('GRU'),
      nip,
      nama,
      email: email || `${nama.toLowerCase().split(' ')[0]}@smkmuhpakem.sch.id`,
      mapel,
      kelasId: kelasId || []
    };

    db.get('guru').push(newGuru).write();

    // Buat user login untuk guru
    const username = nama.toLowerCase().split(' ')[0];
    const newUser = {
      id: `USR-${String(db.get('users').size().value() + 1).padStart(3, '0')}`,
      username,
      password: bcrypt.hashSync('guru123', 10),
      role: 'guru',
      nama,
      refId: newGuru.id
    };
    db.get('users').push(newUser).write();

    res.status(201).json({
      success: true,
      message: 'Data guru berhasil ditambahkan.',
      data: newGuru,
      user: { username, password: 'guru123' }
    });
  } catch (error) {
    console.error('Create guru error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// PUT /api/guru/:id - Mengupdate data guru
router.put('/:id', authenticateToken, authorizeAdmin, (req, res) => {
  try {
    const { nip, nama, email, mapel, kelasId } = req.body;
    const guru = db.get('guru').find({ id: req.params.id }).value();

    if (!guru) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan.' });
    }

    // Cek NIP duplikat (jika diubah)
    if (nip && nip !== guru.nip) {
      const existingNip = db.get('guru').find({ nip }).value();
      if (existingNip) {
        return res.status(400).json({ success: false, message: 'NIP sudah terdaftar.' });
      }
    }

    db.get('guru')
      .find({ id: req.params.id })
      .assign({
        nip: nip || guru.nip,
        nama: nama || guru.nama,
        email: email || guru.email,
        mapel: mapel || guru.mapel,
        kelasId: kelasId || guru.kelasId
      })
      .write();

    const updatedGuru = db.get('guru').find({ id: req.params.id }).value();
    res.json({
      success: true,
      message: 'Data guru berhasil diupdate.',
      data: updatedGuru
    });
  } catch (error) {
    console.error('Update guru error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

// DELETE /api/guru/:id - Menghapus data guru
router.delete('/:id', authenticateToken, authorizeAdmin, (req, res) => {
  try {
    const guru = db.get('guru').find({ id: req.params.id }).value();

    if (!guru) {
      return res.status(404).json({ success: false, message: 'Guru tidak ditemukan.' });
    }

    // Hapus user terkait
    db.get('users').remove({ refId: req.params.id, role: 'guru' }).write();
    
    // Hapus data guru
    db.get('guru').remove({ id: req.params.id }).write();

    res.json({
      success: true,
      message: 'Data guru berhasil dihapus.'
    });
  } catch (error) {
    console.error('Delete guru error:', error);
    res.status(500).json({ success: false, message: 'Terjadi kesalahan server.' });
  }
});

module.exports = router;