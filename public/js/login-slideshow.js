// ===== HALAMAN LOGIN - SLIDESHOW FOTO SEKOLAH (PANEL KIRI / SPLIT SCREEN) =====
// 3 foto asli sekolah: assets/school-1.jpeg, assets/school-2.jpeg, assets/school-3.jpeg
//   - desktop: panel kiri setinggi layar (sticky), mobile: banner ringkas (lihat css/login.css)
//   - ganti foto otomatis setiap 4000ms
//   - transisi crossfade 800ms (lihat css/login.css)
//   - indicator 3 titik (bisa diklik) + tombol sebelumnya/berikutnya
//
// Prinsip:
//   - HANYA SATU interval aktif: selalu clearInterval sebelum setInterval
//   - event listener hanya dipasang sekali saat init (tanpa duplikasi)
//   - tidak menyentuh logika autentikasi (js/login.js, js/auth.js, js/supabase.js)
(function () {
    'use strict';

    var INTERVAL_MS = 4000; // ganti foto tiap 4 detik
    var FADE_MS = 800;      // durasi transisi fade (sinkron dengan CSS)

    function initSlideshow() {
        var root = document.querySelector('[data-slideshow]');
        if (!root) return;

        var slides = Array.prototype.slice.call(root.querySelectorAll('[data-slide]'));
        if (slides.length < 2) return;

        var dots = Array.prototype.slice.call(root.querySelectorAll('[data-slide-dot]'));
        var prevBtn = root.querySelector('[data-slide-prev]');
        var nextBtn = root.querySelector('[data-slide-next]');

        var order = [];          // daftar indeks slide yang bisa dipakai
        var cursor = 0;          // posisi aktif di dalam order
        var timerId = null;      // satu-satunya interval slideshow
        var prevFadeTimer = null;
        var paused = false;      // jeda karena tab tidak aktif / kursor di atas foto

        // ---------- deteksi foto gagal dimuat (termasuk 404 dari cache) ----------
        function isUsable(index) {
            var slide = slides[index];
            if (!slide || slide.classList.contains('is-broken')) return false;
            var img = slide.querySelector('img');
            if (!img) return false;
            // foto yang belum dimuat (data-src) dianggap siap
            if (!img.getAttribute('src')) return true;
            return !(img.complete && img.naturalWidth === 0);
        }

        function buildOrder() {
            order = [];
            for (var i = 0; i < slides.length; i++) {
                if (isUsable(i)) order.push(i);
            }
        }

        function updateDots() {
            var activeIndex = order.length ? order[cursor] : -1;
            for (var i = 0; i < dots.length; i++) {
                var dotIndex = parseInt(dots[i].getAttribute('data-slide-dot'), 10);
                var isActive = dotIndex === activeIndex;
                dots[i].classList.toggle('is-active', isActive);
                if (isActive) dots[i].setAttribute('aria-current', 'true');
                else dots[i].removeAttribute('aria-current');
                dots[i].hidden = !isUsable(dotIndex); // indicator foto rusak disembunyikan
            }
        }

        // terapkan state ke DOM sesuai order + cursor
        function applyState() {
            if (!order.length) {
                root.classList.add('is-empty');
                updateDots();
                return;
            }
            var activeIndex = order[cursor];
            for (var i = 0; i < slides.length; i++) {
                var keep = i === activeIndex;
                slides[i].classList.toggle('is-active', keep);
                if (!keep) slides[i].classList.remove('is-prev');
                slides[i].setAttribute('aria-hidden', keep ? 'false' : 'true');
            }
            updateDots();
        }

        // posisi aman (wrap) di dalam order
        function normalize(position) {
            if (position < 0) return order.length - 1;
            if (position > order.length - 1) return 0;
            return position;
        }

        // tampilkan slide pada posisi tertentu (crossfade 800ms)
        function show(position) {
            if (!order.length) {
                root.classList.add('is-empty');
                return;
            }
            var next = normalize(position);
            var prevSlide = slides[order[cursor]] || null;
            var nextSlide = slides[order[next]];

            if (prevSlide === nextSlide) {
                updateDots();
                return;
            }

            // slide lama tetap terlihat di bawah slide baru selama crossfade
            if (prevSlide) {
                prevSlide.classList.remove('is-active');
                prevSlide.classList.add('is-prev');
                prevSlide.setAttribute('aria-hidden', 'true');
            }

            nextSlide.classList.add('is-active');
            nextSlide.classList.remove('is-prev');
            nextSlide.setAttribute('aria-hidden', 'false');

            cursor = next;
            updateDots();

            if (prevSlide) {
                if (prevFadeTimer) clearTimeout(prevFadeTimer);
                prevFadeTimer = setTimeout(function () {
                    prevSlide.classList.remove('is-prev');
                    prevFadeTimer = null;
                }, FADE_MS);
            }
        }

        // ---------- satu interval: selalu dibersihkan sebelum dibuat ulang ----------
        function stopAuto() {
            if (timerId !== null) {
                clearInterval(timerId);
                timerId = null;
            }
        }

        function startAuto() {
            stopAuto();
            if (paused || order.length < 2) return;
            timerId = setInterval(function () {
                show(cursor + 1);
            }, INTERVAL_MS);
        }

        // navigasi manual: pindah foto + reset timer (tidak menumpuk interval)
        function goTo(position) {
            show(position);
            startAuto();
        }
        function goNext() { goTo(cursor + 1); }
        function goPrev() { goTo(cursor - 1); }

        // ---------- keadaan awal (slide pertama sudah .is-active di HTML) ----------
        buildOrder();

        var initialActive = -1;
        for (var k = 0; k < slides.length; k++) {
            if (slides[k].classList.contains('is-active')) {
                initialActive = k;
                break;
            }
        }
        var initialCursor = initialActive >= 0 ? order.indexOf(initialActive) : -1;
        cursor = initialCursor >= 0 ? initialCursor : 0;
        applyState();

        // ---------- foto gagal dimuat -> slide dilewati, halaman tetap aman ----------
        slides.forEach(function (slide) {
            var img = slide.querySelector('img');
            if (!img) return;
            img.addEventListener('error', function () {
                console.warn('[LoginSlideshow] Foto gagal dimuat, slide dilewati:', img.getAttribute('src'));
                var activeIndexBefore = order.length ? order[cursor] : -1;
                slide.classList.add('is-broken');
                slide.classList.remove('is-active', 'is-prev');
                buildOrder();
                if (!order.length) {
                    stopAuto();
                    root.classList.add('is-empty');
                    updateDots();
                    return;
                }
                var position = order.indexOf(activeIndexBefore);
                cursor = position >= 0 ? position : 0;
                applyState();
            });
        });

        // ---------- event listener (dipasang sekali) ----------
        if (nextBtn) nextBtn.addEventListener('click', goNext);
        if (prevBtn) prevBtn.addEventListener('click', goPrev);

        dots.forEach(function (dot) {
            dot.addEventListener('click', function () {
                var dotIndex = parseInt(dot.getAttribute('data-slide-dot'), 10);
                var position = order.indexOf(dotIndex);
                if (position < 0) return; // foto gagal dimuat
                goTo(position);
            });
        });

        // keyboard: saat fokus pada tombol/indicator, panah kiri/kanan berpindah foto
        root.addEventListener('keydown', function (event) {
            if (event.key === 'ArrowRight') {
                goNext();
                event.preventDefault();
            } else if (event.key === 'ArrowLeft') {
                goPrev();
                event.preventDefault();
            }
        });

        // Catatan: jeda saat kursor berada di atas foto SENGAJA tidak dipakai.
        // Panel foto kini menempati separuh layar desktop, sehingga slideshow harus
        // tetap berganti otomatis setiap 4 detik (loop terus menerus).

        // jeda saat tab tidak aktif -> hemat resource
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                paused = true;
                stopAuto();
            } else {
                paused = false;
                startAuto();
            }
        });

        // ---------- muat foto ke-2 & ke-3 setelah halaman siap (login tetap ringan) ----------
        function loadDeferred() {
            slides.forEach(function (slide) {
                var img = slide.querySelector('img');
                if (!img) return;
                var src = img.getAttribute('data-src');
                if (!src) return;
                img.removeAttribute('data-src');
                img.setAttribute('src', src);
            });
        }
        window.addEventListener('load', function () {
            setTimeout(loadDeferred, 250);
        });

        startAuto();
    }

    // jalankan setelah DOM siap (script dimuat di akhir body)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSlideshow);
    } else {
        initSlideshow();
    }
})();
