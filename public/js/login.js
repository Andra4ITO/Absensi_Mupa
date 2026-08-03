// ===== LOGIN LOGIC =====
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const loginBtn = document.getElementById('login-btn');
    const btnText = document.getElementById('btn-text');
    const btnLoading = document.getElementById('btn-loading');
    const togglePassword = document.getElementById('toggle-password');
    const passwordInput = document.getElementById('password');

    // Cek jika sudah login, redirect ke dashboard
    const token = API.getToken();
    if (token) {
        const user = API.getUser();
        if (user) {
            redirectToDashboard(user.role);
        }
    }

    // Toggle password visibility
    togglePassword.addEventListener('click', () => {
        const type = passwordInput.type === 'password' ? 'text' : 'password';
        passwordInput.type = type;
        togglePassword.innerHTML = type === 'password' 
            ? '<svg class="h-5 w-5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>'
            : '<svg class="h-5 w-5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"/></svg>';
    });

    // Handle form submit
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        // Validasi input
        if (!username || !password) {
            showToast('Username dan password wajib diisi.', 'warning');
            return;
        }

        // Tampilkan loading
        loginBtn.disabled = true;
        btnText.classList.add('hidden');
        btnLoading.classList.remove('hidden');

        try {
            const result = await API.login(username, password);
            
            // Simpan token dan user
            API.setToken(result.token);
            API.setUser(result.user);
            
            showToast('Login berhasil! Selamat datang, ' + result.user.nama, 'success');
            
            // Redirect setelah delay singkat
            setTimeout(() => {
                redirectToDashboard(result.user.role);
            }, 1000);
            
        } catch (error) {
            showToast(error.message, 'error');
            
            // Reset loading
            loginBtn.disabled = false;
            btnText.classList.remove('hidden');
            btnLoading.classList.add('hidden');
        }
    });

    // Redirect berdasarkan role
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