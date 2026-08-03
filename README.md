# 📋 Sistem Presensi Digital SMKS Muhammadiyah Pakem

Sistem presensi digital berbasis web untuk SMKS Muhammadiyah Pakem dengan fitur **Sesi Presensi berbasis QR Code** dan **komunikasi real-time via WebSocket (Socket.io)**.

## 🚀 Teknologi

- **Backend:** Node.js + Express.js (RESTful API)
- **Real-time:** Socket.io (WebSocket) untuk komunikasi data real-time
- **QR Code:** Library `qrcode` (backend) + `html5-qrcode` (frontend)
- **Database:** Lowdb (JSON file-based database - tanpa setup database)
- **Autentikasi:** JWT (JSON Web Token) + bcryptjs
- **Frontend:** HTML5 + Tailwind CSS + Vanilla JavaScript
- **Fitur:** Dark/Light Mode, Toast Notifications, Responsive Design

## 📁 Struktur Proyek

```
absensi_sekolah/
├── server.js                 # Entry point utama (Express + Socket.io)
├── package.json              # Konfigurasi dependensi
├── README.md                 # Dokumentasi
├── data/
│   └── db.json              # Database (auto-generated)
├── server/
│   ├── db.js                # Setup database & seed data
│   ├── middleware/
│   │   └── auth.js          # Middleware autentikasi JWT
│   └── routes/
│       ├── auth.js          # Endpoint login & user info
│       ├── siswa.js         # CRUD data siswa
│       ├── guru.js          # CRUD data guru
│       ├── kelas.js         # CRUD data kelas
│       ├── mapel.js         # CRUD mata pelajaran
│       ├── sesi.js          # Sesi presensi + generate QR Code
│       └── presensi.js      # Log kehadiran & rekap
└── public/
    ├── index.html           # Halaman login
    ├── dashboard-admin.html # Dashboard admin (rekap per mapel)
    ├── dashboard-guru.html  # Dashboard guru (buka sesi + QR + real-time)
    ├── dashboard-siswa.html # Dashboard siswa (scan QR + riwayat)
    └── js/
        ├── api.js           # API helper + Socket.io + toast
        ├── login.js         # Logika login
        ├── dashboard-admin.js # Logika dashboard admin
        ├── dashboard-guru.js  # Logika dashboard guru
        └── dashboard-siswa.js # Logika dashboard siswa (QR scanner)
```

## 📦 Instalasi

### 1. Install Node.js
Pastikan Node.js sudah terinstall di komputer Anda. Download di [nodejs.org](https://nodejs.org)

### 2. Install Dependensi
Buka terminal/CMD di folder proyek, lalu jalankan:

```bash
npm install
```

### 3. Jalankan Server

```bash
npm start
```

Atau untuk development:

```bash
npm run dev
```

Server akan berjalan di: **http://localhost:3000**

## 🔑 Akun Demo

| Role  | Username | Password  |
|-------|----------|-----------|
| Admin | `admin`  | `admin123`|
| Guru  | `budi`   | `guru123` |
| Guru  | `siti`   | `guru123` |
| Guru  | `ahmad`  | `guru123` |
| Siswa | `andi`   | `siswa123`|
| Siswa | `bella`  | `siswa123`|
| Siswa | `citra`  | `siswa123`|
| Siswa | `dedi`   | `siswa123`|
| Siswa | `eka`    | `siswa123`|
| Siswa | `fajar`  | `siswa123`|
| Siswa | `galih`  | `siswa123`|
| Siswa | `hana`   | `siswa123`|
| Siswa | `iqbal`  | `siswa123`|
| Siswa | `jihan`  | `siswa123`|
| Siswa | `krisna` | `siswa123`|
| Siswa | `laila`  | `siswa123`|

## 🎯 Alur Sistem

### Manajemen Sesi Guru (QR Code)
1. Guru login ke **Dashboard Guru**
2. Guru memilih **Mata Pelajaran** yang diampu dan **Kelas**
3. Guru klik **"Buka Sesi Presensi"** → Sistem menghasilkan **QR Code unik (dinamis)**
4. QR Code ditampilkan di layar guru (bisa dipindai siswa)
5. Guru memantau **daftar siswa yang hadir secara real-time** via WebSocket
6. Guru menutup sesi setelah selesai

### Pemindaian QR Siswa (Auto-Fill)
1. Siswa login ke **Dashboard Siswa**
2. Siswa mengarahkan **kamera/webcam** ke QR Code yang ditampilkan guru
3. Sistem **otomatis mencocokkan akun siswa** (Nama, NIS, Kelas) dengan sesi
4. Kehadiran tercatat **seketika** ke database tanpa input manual
5. Guru dan Admin menerima notifikasi real-time via WebSocket

### Validasi Otomatis
- ✅ Siswa harus dari kelas yang sesuai dengan sesi
- ✅ Sesi harus dalam status **Aktif**
- ✅ Sesi otomatis **expired** setelah 3 jam
- ✅ Tidak bisa presensi ganda di sesi yang sama
- ✅ Guru hanya bisa membuka sesi untuk mapel yang diampu

## 📡 API Endpoints

### Autentikasi
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/api/auth/login` | Login user |
| GET | `/api/auth/me` | Get data user yang login |

### Mata Pelajaran
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/mapel` | Get semua mapel (admin/guru) |
| GET | `/api/mapel/guru/:guruId` | Get mapel yang diampu guru |
| POST | `/api/mapel` | Tambah mapel (admin) |
| PUT | `/api/mapel/:id` | Update mapel (admin) |
| DELETE | `/api/mapel/:id` | Hapus mapel (admin) |

### Sesi Presensi (QR Code)
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| POST | `/api/sesi/buka` | Buka sesi presensi + generate QR (guru/admin) |
| POST | `/api/sesi/tutup/:sesiId` | Tutup sesi presensi (guru/admin) |
| GET | `/api/sesi/aktif` | Get semua sesi aktif (admin) |
| GET | `/api/sesi/aktif/guru/:guruId` | Get sesi aktif guru |
| GET | `/api/sesi/riwayat/guru/:guruId` | Riwayat sesi guru |
| GET | `/api/sesi/:sesiId` | Detail sesi + daftar hadir |

### Presensi / Rekap
| Method | Endpoint | Deskripsi |
|--------|----------|-----------|
| GET | `/api/presensi/riwayat` | Riwayat kehadiran siswa |
| GET | `/api/presensi/rekap` | Rekap kehadiran detail (admin/guru) |
| GET | `/api/presensi/rekap/mapel` | Rekap agregat per mapel (admin/guru) |
| GET | `/api/presensi/dashboard` | Statistik dashboard (admin/guru) |

### Data Master (Admin)
| Endpoint | Deskripsi |
|----------|-----------|
| `/api/siswa` | CRUD data siswa |
| `/api/guru` | CRUD data guru |
| `/api/kelas` | CRUD data kelas |

## 🔌 Socket.io Events (WebSocket)

### Client → Server
| Event | Deskripsi |
|-------|-----------|
| `authenticate` | Kirim info user (userId, role, refId) untuk join room |
| `scan-qr` | Siswa kirim hasil scan QR (sesiId, token, siswaId) |
| `sesi-ditutup` | Guru memberitahu siswa bahwa sesi ditutup |

### Server → Client
| Event | Deskripsi |
|-------|-----------|
| `scan-result` | Hasil proses scan ke siswa |
| `presensi-bar` | Data presensi baru (ke guru & admin real-time) |
| `sesi-update` | Update jumlah hadir (ke guru) |
| `sesi-ditutup` | Notifikasi sesi ditutup (ke siswa) |

## ⚙️ Konfigurasi

### Durasi Sesi (di `server/routes/sesi.js`)
```javascript
const maxDuration = 3 * 60 * 60 * 1000; // 3 jam
```

### Port Server
Ubah port di `server.js`:
```javascript
const PORT = process.env.PORT || 3000;
```

## 🛠️ Troubleshooting

### Error: `npm install` gagal
- Pastikan Node.js terinstall dengan benar: `node --version`
- Hapus `node_modules` dan `package-lock.json`, lalu install ulang

### Database tidak ter-seed
- Hapus file `data/db.json` lalu restart server
- Database akan otomatis ter-seed ulang

### Kamera tidak aktif di browser siswa
- Pastikan browser mengizinkan akses kamera
- Gunakan browser Chrome/Edge terbaru
- Akses harus via `http://localhost:3000` (bukan file://)

### Port 3000 sudah digunakan
- Ubah port di `server.js` atau set environment variable `PORT`

## 📝 Lisensi

© 2024 SMKS Muhammadiyah Pakem. All rights reserved.