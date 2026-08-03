const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../db');
const { JWT_SECRET, authenticateToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: 'Username dan password wajib diisi.'
      });
    }

    // Cari user berdasarkan username
    const user = db.get('users')
      .find({ username })
      .value();

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Username tidak ditemukan.'
      });
    }

    // Verifikasi password
    const isPasswordValid = bcrypt.compareSync(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Password salah.'
      });
    }

    // Buat token JWT
    const token = jwt.sign(
      { 
        id: user.id, 
        username: user.username, 
        role: user.role,
        nama: user.nama,
        refId: user.refId
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    // Ambil data tambahan berdasarkan role
    let additionalData = {};
    if (user.role === 'siswa' && user.refId) {
      const siswa = db.get('siswa').find({ id: user.refId }).value();
      if (siswa) {
        const kelas = db.get('kelas').find({ id: siswa.kelasId }).value();
        additionalData = { siswa, kelas };
      }
    } else if (user.role === 'guru' && user.refId) {
      const guru = db.get('guru').find({ id: user.refId }).value();
      if (guru) {
        additionalData = { guru };
      }
    }

    res.json({
      success: true,
      message: 'Login berhasil.',
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        nama: user.nama,
        refId: user.refId,
        ...additionalData
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server.'
    });
  }
});

// GET /api/auth/me - Mendapatkan data user yang sedang login
router.get('/me', authenticateToken, (req, res) => {
  try {
    const user = db.get('users')
      .find({ id: req.user.id })
      .value();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan.'
      });
    }

    let additionalData = {};
    if (user.role === 'siswa' && user.refId) {
      const siswa = db.get('siswa').find({ id: user.refId }).value();
      if (siswa) {
        const kelas = db.get('kelas').find({ id: siswa.kelasId }).value();
        additionalData = { siswa, kelas };
      }
    } else if (user.role === 'guru' && user.refId) {
      const guru = db.get('guru').find({ id: user.refId }).value();
      if (guru) {
        additionalData = { guru };
      }
    }

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        nama: user.nama,
        refId: user.refId,
        ...additionalData
      }
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({
      success: false,
      message: 'Terjadi kesalahan server.'
    });
  }
});

module.exports = router;