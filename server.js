const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const { Server } = require('socket.io');
const { seedData } = require('./server/db');
const { prosesScanQR } = require('./server/routes/sesi');

// Import routes
const authRoutes = require('./server/routes/auth');
const siswaRoutes = require('./server/routes/siswa');
const guruRoutes = require('./server/routes/guru');
const kelasRoutes = require('./server/routes/kelas');
const mapelRoutes = require('./server/routes/mapel');
const sesiRoutes = require('./server/routes/sesi');
const presensiRoutes = require('./server/routes/presensi');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files dari folder public
app.use(express.static(path.join(__dirname, 'public')));

// Serve modul ESM dari folder src (untuk Firebase Database layer)
app.use('/src', express.static(path.join(__dirname, 'src')));

// Serve node_modules untuk import maps Firebase modular SDK
app.use('/vendor', express.static(path.join(__dirname, 'node_modules')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/siswa', siswaRoutes);
app.use('/api/guru', guruRoutes);
app.use('/api/kelas', kelasRoutes);
app.use('/api/mapel', mapelRoutes);
app.use('/api/sesi', sesiRoutes.router);
app.use('/api/presensi', presensiRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Sistem Presensi Digital SMKS Muhammadiyah Pakem - API is running',
    timestamp: new Date().toISOString()
  });
});

// Route utama - serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 handler untuk API
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint tidak ditemukan.'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    message: 'Terjadi kesalahan server.'
  });
});

// ===== SOCKET.IO REALTIME =====
// Map untuk melacak koneksi socket per role/user
const socketUserMap = new Map(); // socketId -> { userId, role, refId }

io.on('connection', (socket) => {
  console.log('🔌 Client terhubung:', socket.id);

  // Client mengirim informasi user yang terautentikasi
  socket.on('authenticate', (data) => {
    try {
      const { userId, role, refId, nama } = data;
      socketUserMap.set(socket.id, { userId, role, refId, nama });
      
      console.log(`✅ ${role} terhubung: ${nama} (${socket.id})`);
      
      // Gabung ke room berdasarkan role
      socket.join(`role:${role}`);
      
      // Gabung ke room personal untuk guru
      if (role === 'guru' && refId) {
        socket.join(`guru:${refId}`);
      }
      
      // Gabung ke room personal untuk siswa
      if (role === 'siswa' && refId) {
        socket.join(`siswa:${refId}`);
      }
    } catch (error) {
      console.error('Socket authenticate error:', error);
    }
  });

  // Siswa melakukan scan QR dan mengirim hasil ke server
  socket.on('scan-qr', async (data) => {
    try {
      const { sesiId, token, siswaId } = data;
      const userInfo = socketUserMap.get(socket.id);
      
      if (!userInfo) {
        socket.emit('scan-result', {
          success: false,
          message: 'Silakan login terlebih dahulu.'
        });
        return;
      }

      // Validasi role siswa
      if (userInfo.role !== 'siswa') {
        socket.emit('scan-result', {
          success: false,
          message: 'Hanya siswa yang dapat melakukan presensi.'
        });
        return;
      }

      // Panggil fungsi proses kehadiran
      const result = await prosesScanQR(sesiId, siswaId);

      // Kirim hasil ke siswa yang scan
      socket.emit('scan-result', result);

      // Jika berhasil, broadcast ke room guru
      if (result.success) {
        // Cari sesi untuk mendapatkan guruId
        const { db } = require('./server/db');
        const sesi = db.get('sesiPresensi').find({ id: sesiId }).value();
        
        if (sesi) {
          io.to(`guru:${sesi.guruId}`).emit('presensi-bar', result.data);
          io.to(`guru:${sesi.guruId}`).emit('sesi-update', {
            sesiId,
            jumlahHadir: result.data ? db.get('logKehadiran').filter({ sesiId }).size().value() : 0,
            lastStudent: result.data
          });
        }
        
        // Broadcast ke semua admin
        io.to('role:admin').emit('presensi-bar', result.data);
      }
    } catch (error) {
      console.error('Socket scan-qr error:', error);
      socket.emit('scan-result', {
        success: false,
        message: 'Terjadi kesalahan server saat memproses scan.'
      });
    }
  });

  // Guru menutup sesi - broadcast ke semua
  socket.on('sesi-ditutup', (data) => {
    const userInfo = socketUserMap.get(socket.id);
    if (userInfo && userInfo.role === 'guru') {
      io.to('role:siswa').emit('sesi-ditutup', data);
    }
  });

  // Client disconnect
  socket.on('disconnect', () => {
    const userInfo = socketUserMap.get(socket.id);
    if (userInfo) {
      console.log(`🔌 ${userInfo.role} terputus: ${userInfo.nama} (${socket.id})`);
    } else {
      console.log('🔌 Client terputus:', socket.id);
    }
    socketUserMap.delete(socket.id);
  });
});

// Start server
async function startServer() {
  try {
    // Seed data awal
    await seedData();
    
    server.listen(PORT, () => {
      console.log('==========================================');
      console.log('  SISTEM PRESENSI DIGITAL');
      console.log('  SMKS MUHAMMADIYAH PAKEM');
      console.log('==========================================');
      console.log(`  Server berjalan di: http://localhost:${PORT}`);
      console.log('  API Health Check: http://localhost:' + PORT + '/api/health');
      console.log('==========================================');
      console.log('  Akun Demo:');
      console.log('  - Admin: admin / admin123');
      console.log('  - Guru:  budi / guru123');
      console.log('  - Siswa: andi / siswa123');
      console.log('==========================================');
    });
  } catch (error) {
    console.error('Gagal memulai server:', error);
    process.exit(1);
  }
}

startServer();