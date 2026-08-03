const jwt = require('jsonwebtoken');
const { db } = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'smkmuhammadiyahpakem_secret_key_2024';

// Middleware untuk verifikasi token
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Token tidak ditemukan. Silakan login terlebih dahulu.' 
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ 
        success: false, 
        message: 'Token tidak valid atau sudah kadaluarsa.' 
      });
    }
    req.user = user;
    next();
  });
}

// Middleware untuk otorisasi role
function authorizeRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Unauthorized' 
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        message: 'Akses ditolak. Anda tidak memiliki izin untuk akses ini.' 
      });
    }
    next();
  };
}

// Middleware untuk admin dan guru
const authorizeAdminGuru = authorizeRole('admin', 'guru');

// Middleware untuk admin saja
const authorizeAdmin = authorizeRole('admin');

module.exports = { 
  authenticateToken, 
  authorizeRole, 
  authorizeAdminGuru, 
  authorizeAdmin,
  JWT_SECRET 
};