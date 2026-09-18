// ===== LOGIN LOGIC (SISTEM LOGIN UNIVERSAL) =====
// Satu form, satu fungsi login. Role ditentukan otomatis:
//   - admin → dashboard-admin.html
//   - guru  → dashboard-guru.html
//   - siswa → dashboard-siswa.html

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const loginBtn = document.getElementById('login-btn');
    const btnText = document.getElementById('btn-text');
    const btnLoading = document.getElementById('btn-loading');
    const togglePassword = document.getElementById('toggle-password');
    const passwordInput = document.getElementById('password');

    // Cek session saat halaman dimuat (Stage 4):
    //   1) Session Supabase Auth valid → langsung ke dashboard sesuai role
    //      (refresh tetap login, tidak kembali ke halaman login).
    //   2) Fallback: sesi lokal lama (migrasi bertahap).
    (async () => {
        try {
            if (window.SupabaseAuth) {
                const sess = await window.SupabaseAuth.getSessionUser();
                if (sess) {
                    const prof = await window.SupabaseAuth.fetchAppProfile(sess.id);
                    const role = prof.data ? prof.data.role : ((sess.user_metadata && sess.user_metadata.role) || null);
                    if (role) {
                        redirectToDashboard(role);
                        return;
                    }
                }
            }
        } catch (e) {
            console.error('[Login] Cek session Supabase error:', e);
        }
        const user = API.getUser();
        if (user && user.role) {
            redirectToDashboard(user.role);
            return;
        }
    })();

    // Toggle password visibility
    if (togglePassword && passwordInput) {
        togglePassword.addEventListener('click', () => {
            const type = passwordInput.type === 'password' ? 'text' : 'password';
            passwordInput.type = type;
            togglePassword.innerHTML = type === 'password'
                ? '<svg class="h-5 w-5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>'
                : '<svg class="h-5 w-5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"/></svg>';
        });
    }

    // Cegah double login: true saat proses berlangsung
    let isLoggingIn = false;

    // Reset tombol agar bisa diklik lagi (dipanggil saat gagal)
    function resetLoginButton() {
        isLoggingIn = false;
        loginBtn.disabled = false;
        btnText.classList.remove('hidden');
        btnLoading.classList.add('hidden');
    }

    // Handle form submit — Supabase Auth (utama) + fallback login lama
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Cegah double click / submit ganda
        if (isLoggingIn) return;
        isLoggingIn = true;
        loginBtn.disabled = true;

        // Feedback instan pada tombol
        btnText.classList.add('hidden');
        btnLoading.classList.remove('hidden');

        const credential1 = document.getElementById('username').value.trim();
        const credential2 = document.getElementById('password').value.trim();

        // Validasi input (langsung, tanpa loading)
        if (!credential1) {
            showToast('Username/Nama wajib diisi.', 'warning');
            resetLoginButton();
            return;
        }
        if (!credential2) {
            showToast('Password/NIS wajib diisi.', 'warning');
            resetLoginButton();
            return;
        }

        try {
            // 1) Jalur utama: Supabase Auth (identifier → email virtual).
            let result = null;
            if (window.SupabaseAuth) {
                result = await Auth.loginSupabase(credential1, credential2);
            }
            // 2) Fallback migrasi: identifier tidak dikenal Supabase
            //    (akun demo lama) → jalur demo/localStorage yang lama.
            if (!result) {
                result = Auth.loginUniversal(credential1, credential2);
            }
            redirectToDashboard(result.user.role);
        } catch (error) {
            showToast(error.message, 'error');
            resetLoginButton();
        }
    });

    // Redirect berdasarkan role (langsung, tanpa timeout)
    function redirectToDashboard(role) {
        switch (role) {
            case 'admin':
                window.location.href = '/dashboard-admin.html';
                break;
            case 'guru':
                window.location.href = '/dashboard-guru.html';
                break;
            case 'siswa':
                window.location.href = '/dashboard-siswa.html';
                break;
            default:
                window.location.href = '/';
        }
    }
});