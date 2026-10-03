// ============================================================
// migrate-local-to-firestore.js
// -----------------------------
// ALAT MIGRASI MANUAL: data localStorage -> Firebase Firestore.
//
// ATURAN EMAS:
//   - Script ini HANYA berjalan saat migrate-firestore.html dibuka
//     dan tombol "MIGRATE TO FIRESTORE" ditekan. TIDAK ada migrasi
//     otomatis saat login / buka dashboard / refresh / startup.
//   - Menggunakan koneksi YANG SUDAH ADA (project dataabsen-aa6db):
//     window.FirebaseDB (js/firebase.js) + window.FirestoreRepo
//     (js/firestore-repo.js). TANPA inisialisasi Firebase baru,
//     TANPA SDK kedua, TANPA Firebase Auth, TANPA menyentuh Supabase.
//   - localStorage TIDAK PERNAH dihapus/dimodifikasi alat ini
//     (tanpa removeItem / clear / setItem): tetap jadi backup.
//   - ID lama DIPERTAHANKAN (USR-001 -> users/USR-001); idempoten
//     (dokumen identik dilewati, aman dijalankan berulang).
//   - Field terlarang (password/token/session/dll) TIDAK dikirim;
//     key session aplikasi tidak ada dalam daftar migrasi.
//   - data/db.json dan server/ TIDAK disentuh.
// ============================================================

(function () {
    'use strict';

    // ===== Mapping (mengikuti SyncMapping.STORES; fallback bila belum ada) =====
    var FALLBACK_STORES = [
        { key: 'mupa_users', coll: 'users', label: 'Pengguna' },
        { key: 'mupa_subjects', coll: 'subjects', label: 'Mata Pelajaran' },
        { key: 'mupa_attendance_sessions', coll: 'attendance_sessions', label: 'Sesi Presensi' },
        { key: 'mupa_attendance_records', coll: 'attendance_records', label: 'Presensi QR' },
        { key: 'mupa_parking_tickets', coll: 'parking_tickets', label: 'Karcis Parkir' },
        { key: 'parking_absensi', coll: 'parking_attendance', label: 'Presensi Parkir (GPS)' },
        { key: 'mupa_settings', coll: 'settings', label: 'Pengaturan Sekolah' },
        { key: 'mupa_activity_log', coll: 'activity_log', label: 'Log Aktivitas' }
    ];

    // Key yang TIDAK BOLEH pernah dimigrasikan (sesuai spesifikasi).
    var FORBIDDEN_KEYS_TOP = ['mupa_current_user', 'mupa_session_active', 'token',
        'access_token', 'refresh_token', 'user', 'password', 'passwordHash',
        'session', 'darkMode', 'theme'];

    // Field di DALAM data yang tidak boleh dikirim ke Firestore.
    var FORBIDDEN_FIELDS = ['password', 'passwordHash', 'password_hash', 'token',
        'accessToken', 'access_token', 'refreshToken', 'refresh_token',
        'session', 'sessionToken'];

    function stores() {
        if (window.SyncMapping && Array.isArray(window.SyncMapping.STORES) &&
            window.SyncMapping.STORES.length) {
            return window.SyncMapping.STORES;
        }
        return FALLBACK_STORES;
    }

    function repo() {
        return (window.FirestoreRepo && typeof window.FirestoreRepo.set === 'function')
            ? window.FirestoreRepo : null;
    }

    function repoReady() {
        var r = repo();
        return !!(r && typeof r.isReady === 'function' && r.isReady());
    }

    // ===== Util =====
    function isPlainObject(v) {
        return !!v && typeof v === 'object' && !Array.isArray(v);
    }

    // Klon rekursif: buang field terlarang, undefined -> null, Date -> ISO.
    function sanitize(value) {
        if (value === undefined) return null;
        if (value === null) return null;
        if (value instanceof Date) return value.toISOString();
        if (Array.isArray(value)) return value.map(sanitize);
        if (typeof value === 'function') return null;
        if (typeof value !== 'object') return value;
        var out = {};
        Object.keys(value).forEach(function (k) {
            if (FORBIDDEN_FIELDS.indexOf(k) !== -1) return; // buang, jangan kirim
            out[k] = sanitize(value[k]);
        });
        return out;
    }

    // Bandingkan stabil (urut key) untuk deteksi "sudah sama".
    function stable(v) {
        if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
        if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
        var keys = Object.keys(v).sort();
        return '{' + keys.map(function (k) {
            return JSON.stringify(k) + ':' + stable(v[k]);
        }).join(',') + '}';
    }

    // ID deterministik bila item tidak punya id lama (TIDAK acak -> aman diulang).
    function derivedId(key, item, index) {
        var ts = item && (item.timestamp || item.time || item.createdAt);
        if (typeof ts === 'string' && ts) {
            return 'PA-' + ts.replace(/[^A-Za-z0-9_-]/g, '-');
        }
        return key + '-' + index;
    }

    function sanitizeId(id) {
        if (window.SyncMapping && typeof window.SyncMapping.sanitizeId === 'function') {
            return window.SyncMapping.sanitizeId(id);
        }
        var s = String(id == null ? '' : id).trim().replace(/[\/\\#]/g, '_');
        if (!s) s = 'doc-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
        return s;
    }

    function readStore(key) {
        try {
            var raw = localStorage.getItem(key);
            if (raw === null || raw === undefined || raw === '') return { ok: false, missing: true, value: null };
            var val = JSON.parse(raw);
            return { ok: true, missing: false, value: val };
        } catch (e) {
            return { ok: false, missing: false, error: String(e && e.message || e), value: null };
        }
    }

    function countForbidden(obj) {
        var n = 0;
        (function walk(v) {
            if (!v || typeof v !== 'object') return;
            Object.keys(v).forEach(function (k) {
                if (FORBIDDEN_FIELDS.indexOf(k) !== -1) { n++; return; }
                walk(v[k]);
            });
        })(obj);
        return n;
    }
    // ===== Log (ke halaman & console; tidak pernah menulis data) =====
    var _logSink = null;
    function setLogSink(fn) { _logSink = (typeof fn === 'function') ? fn : null; }
    function logLine(kind, text) {
        if (_logSink) { try { _logSink(kind, text); } catch (e) { /* abaikan */ } }
        if (kind === 'error') console.error('[Migrasi] ' + text);
        else if (kind === 'warn') console.warn('[Migrasi] ' + text);
        else console.log('[Migrasi] ' + text);
    }

    /**
     * PERIKSA DATA — SCAN READ-ONLY.
     * Hanya membaca localStorage + menyiapkan rencana. TIDAK menulis
     * apa pun (bukan ke localStorage, bukan ke Firestore).
     */
    function scan() {
        var report = [];
        stores().forEach(function (s) {
            var entry = {
                key: s.key, coll: s.coll, label: s.label || s.key,
                exists: false, parseOk: false, shape: '-', total: 0,
                withId: 0, withoutId: 0, forbidden: 0, error: null, migratable: 0
            };
            if (FORBIDDEN_KEYS_TOP.indexOf(s.key) !== -1) {
                entry.error = 'key diblokir spesifikasi — dilewati';
                report.push(entry);
                return;
            }
            var r = readStore(s.key);
            if (r.missing) {
                entry.exists = false;
                report.push(entry); // key tidak ada -> bukan kesalahan
                return;
            }
            entry.exists = true;
            if (!r.ok) {
                entry.error = 'JSON rusak: ' + r.error;
                report.push(entry);
                return;
            }
            entry.parseOk = true;
            if (Array.isArray(r.value)) {
                entry.shape = 'array';
                entry.total = r.value.length;
                r.value.forEach(function (item) {
                    if (isPlainObject(item) && item.id !== undefined && item.id !== null &&
                        String(item.id).trim() !== '') entry.withId++;
                    else entry.withoutId++;
                });
                entry.forbidden = countForbidden(r.value);
                entry.migratable = entry.total;
            } else if (isPlainObject(r.value)) {
                entry.shape = 'object';
                entry.total = 1;
                if (r.value.id !== undefined && r.value.id !== null) entry.withId = 1;
                else entry.withoutId = 1; // settings -> doc 'school'
                entry.forbidden = countForbidden(r.value);
                entry.migratable = 1;
            } else {
                entry.shape = typeof r.value;
                entry.error = 'bentuk tidak didukung (bukan array/objek)';
            }
            report.push(entry);
        });
        var totals = { items: 0, forbidden: 0, missing: 0, errors: 0 };
        report.forEach(function (e) {
            totals.items += e.migratable;
            totals.forbidden += e.forbidden;
            if (!e.exists) totals.missing++;
            if (e.error) totals.errors++;
        });
        logLine('info', 'Scan selesai (READ-ONLY): ' + totals.items + ' item siap dimigrasikan, ' +
            totals.forbidden + ' field terlarang akan dibuang, ' + totals.missing +
            ' key tidak ada di localStorage, ' + totals.errors + ' masalah parse.');
        return { stores: report, totals: totals };
    }

    // ===== Rencana per dokumen (tanpa menulis) =====
    // Mengembalikan daftar {coll, id, payload, sourceKey, label} —
    // dipakai oleh scan detail maupun run().
    function buildPlan() {
        var plan = [];
        var notes = [];
        stores().forEach(function (s) {
            if (FORBIDDEN_KEYS_TOP.indexOf(s.key) !== -1) return;
            var r = readStore(s.key);
            if (!r.ok) {
                if (r.missing) return;
                notes.push(s.key + ': ' + (r.error || 'gagal dibaca'));
                return;
            }
            var asArray = null;
            if (Array.isArray(r.value)) asArray = r.value;
            else if (isPlainObject(r.value)) asArray = [r.value];
            else { notes.push(s.key + ': bentuk tidak didukung'); return; }

            asArray.forEach(function (item, index) {
                if (!isPlainObject(item)) { notes.push(s.key + '[' + index + ']: bukan objek — dilewati'); return; }
                var payload = sanitize(item);
                var id;
                if (Array.isArray(r.value)) {
                    if (item.id !== undefined && item.id !== null && String(item.id).trim() !== '') {
                        id = String(item.id);
                    } else {
                        id = derivedId(s.key, item, index);
                        payload.id = id; // id turunan ikut ditulis agar doc dapat ditelusuri
                        notes.push(s.key + '[' + index + ']: tanpa id lama -> ' + id);
                    }
                } else {
                    // objek tunggal: mupa_settings SELALU ke settings/school (spesifikasi)
                    id = (window.FirestoreRepo && window.FirestoreRepo.SETTINGS_DOC_ID) || 'school';
                    if (payload && typeof payload === 'object') delete payload.id;
                }
                // users: tambah field pencarian (paritas dengan auth.js) tanpa menghapus apa pun
                if (s.coll === 'users' && repo() && typeof repo().userSearchFields === 'function') {
                    Object.assign(payload, repo().userSearchFields(payload));
                }
                plan.push({ coll: s.coll, id: sanitizeId(id), payload: payload, sourceKey: s.key, label: s.label || s.key });
            });
        });
        return { plan: plan, notes: notes };
    }
    /**
     * MIGRATE TO FIRESTORE — hanya dipanggil dari tombol (manual).
     * Idempoten: get -> bila sudah ada & identik -> LEWATI (tanpa tulis);
     * bila beda -> set (timpa dokumen sama, TIDAK membuat duplikat).
     * localStorage TIDAK disentuh sama sekali.
     */
    var _busy = false;
    async function run() {
        if (_busy) {
            logLine('warn', 'Migrasi sedang berjalan — tunggu selesai.');
            return { success: false, error: 'busy' };
        }
        if (!repo()) {
            logLine('error', 'FirestoreRepo belum termuat. Muat js/firestore-repo.js dulu.');
            return { success: false, error: 'repo-missing' };
        }
        if (!repoReady()) {
            logLine('error', 'Firestore belum siap (window.FirebaseDB kosong/SDK gagal). Migrasi dibatalkan — tidak ada data yang disentuh.');
            return { success: false, error: 'repo-not-ready' };
        }
        _busy = true;
        var summary = { baru: 0, diperbarui: 0, sama: 0, gagal: 0, perColl: {} };
        try {
            var built = buildPlan();
            built.notes.forEach(function (n) { logLine('warn', n); });
            logLine('info', 'Mulai migrasi ' + built.plan.length + ' dokumen (localStorage TIDAK diubah).');

            var r = repo();
            for (var i = 0; i < built.plan.length; i++) {
                var doc = built.plan[i];
                var st = summary.perColl[doc.coll] || (summary.perColl[doc.coll] = { baru: 0, diperbarui: 0, sama: 0, gagal: 0 });

                var existing = await r.get(doc.coll, doc.id);
                var status;
                var existsReal = existing !== null && typeof existing === 'object' && !Array.isArray(existing);
                if (existsReal) {
                    // Bandingkan dgn payload (buang `id` suntikan _fromDoc bila payload tanpa id)
                    var ex = Object.assign({}, existing);
                    if (doc.payload && doc.payload.id === undefined) delete ex.id;
                    if (stable(ex) === stable(doc.payload)) {
                        status = 'sama';
                    } else {
                        var resUpd = await r.set(doc.coll, doc.id, doc.payload);
                        status = (resUpd && resUpd.success) ? 'diperbarui' : 'gagal';
                        if (status === 'gagal') logLine('error', doc.coll + '/' + doc.id + ': ' + (resUpd && resUpd.error));
                    }
                } else {
                    var resAdd = await r.set(doc.coll, doc.id, doc.payload);
                    status = (resAdd && resAdd.success) ? 'baru' : 'gagal';
                    if (status === 'gagal') logLine('error', doc.coll + '/' + doc.id + ': ' + (resAdd && resAdd.error));
                }
                summary[status]++;
                st[status]++;
            }
            logLine('info', 'Selesai: baru ' + summary.baru + ' | diperbarui ' + summary.diperbarui +
                ' | sama (dilewati) ' + summary.sama + ' | gagal ' + summary.gagal +
                '. localStorage utuh — buka PERIKSA DATA untuk memastikan.');
            summary.success = summary.gagal === 0;
            return summary;
        } catch (e) {
            logLine('error', 'Migrasi terhenti: ' + (e && e.message || e));
            return { success: false, error: String(e && e.message || e) };
        } finally {
            _busy = false;
        }
    }
    // ===== Wiring halaman (HANYA bila elemen ada; TANPA membaca/menulis data) =====
    function initUi() {
        if (typeof document === 'undefined' || !document.addEventListener) return;
        document.addEventListener('DOMContentLoaded', function () {
            var elStatus = document.getElementById('mig-status');
            var elScan = document.getElementById('mig-scan');
            var elLog = document.getElementById('mig-log');
            var btnScan = document.getElementById('btn-scan');
            var btnRun = document.getElementById('btn-migrate');

            setLogSink(function (kind, text) {
                if (!elLog) return;
                var row = document.createElement('div');
                row.className = 'log-' + kind;
                row.textContent = text;
                elLog.appendChild(row);
                elLog.scrollTop = elLog.scrollHeight;
            });

            function renderScan(rep) {
                if (!elScan) return;
                elScan.innerHTML = '';
                var table = document.createElement('table');
                table.innerHTML = '<thead><tr><th>Key localStorage</th><th>Koleksi Firestore</th><th>Bentuk</th>' +
                    '<th>Item</th><th>Ber-ID</th><th>Tanpa ID</th><th>Field terlarang</th><th>Status</th></tr></thead>';
                var tb = document.createElement('tbody');
                rep.stores.forEach(function (e) {
                    var tr = document.createElement('tr');
                    var status = e.error ? ('PERHATIAN: ' + e.error) : (e.exists ? 'siap dimigrasikan' : 'tidak ada — dilewati');
                    tr.innerHTML = '<td>' + e.key + '</td><td>' + e.coll + '</td><td>' + e.shape + '</td>' +
                        '<td>' + e.total + '</td><td>' + e.withId + '</td><td>' + e.withoutId + '</td>' +
                        '<td>' + e.forbidden + '</td><td class="' + (e.error ? 'bad' : 'ok') + '">' + status + '</td>';
                    tb.appendChild(tr);
                });
                table.appendChild(tb);
                elScan.appendChild(table);
            }

            if (elStatus) {
                var ready = repoReady();
                elStatus.textContent = ready
                    ? 'Koneksi Firestore SIAP — project dataabsen-aa6db (memakai window.FirebaseDB yang sudah ada).'
                    : 'Koneksi Firestore BELUM SIAP — periksa internet / tag CDN firebase-app-compat & firebase-firestore-compat.';
                elStatus.className = ready ? 'ok' : 'bad';
            }
            if (btnScan) btnScan.addEventListener('click', function () { renderScan(scan()); });
            if (btnRun) btnRun.addEventListener('click', function () {
                var ok = window.confirm(
                    'Migrasi localStorage -> Firestore sekarang?\n\n' +
                    '- ID lama dipertahankan; dokumen identik dilewati (aman dijalankan berulang).\n' +
                    '- localStorage TIDAK akan dihapus/diubah.\n' +
                    '- Koleksi tujuan: users, subjects, attendance_sessions, attendance_records, ' +
                    'parking_tickets, parking_attendance, settings/school, activity_log.');
                if (ok) run();
            });
        });
    }
    initUi();

    // ===== Ekspor (untuk halaman & console; TIDAK menjalankan migrasi) =====
    window.MigrateLocalToFirestore = {
        stores: stores,
        scan: scan,
        buildPlan: buildPlan,
        run: run,
        isReady: repoReady,
        FORBIDDEN_FIELDS: FORBIDDEN_FIELDS,
        FORBIDDEN_KEYS_TOP: FORBIDDEN_KEYS_TOP
    };
})();
