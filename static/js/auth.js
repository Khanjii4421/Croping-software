// Supabase Configuration - REPLACE THESE
const SUPABASE_URL = 'https://lvlgejcyzabglacuqjok.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2bGdlamN5emFiZ2xhY3Vxam9rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4NTk4MDUsImV4cCI6MjA4ODQzNTgwNX0.qGJ7OVE3NcHW3_vrKtkcsdbvpYJcdeq7lm1WcCfJMb0';

let supabaseClient = null;

// Initialize Supabase client safely
try {
    if (window.supabase && SUPABASE_URL && SUPABASE_URL.startsWith('http')) {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    } else if (!window.supabase) {
        console.error("Supabase SDK not loaded! Check your script tags.");
    }
} catch (e) {
    console.error("Supabase initialization failed:", e);
}

// Global Logout Utility
async function logout() {
    console.log("Logout triggered");
    try {
        if (supabaseClient) {
            await supabaseClient.auth.signOut();
        }
    } catch (err) {
        console.error("Sign out error:", err);
    }
    // Clear any local state if needed
    localStorage.clear();
    sessionStorage.clear();
    // Redirect to login
    window.location.href = '/login';
}

// Attach to window for HTML onclick access
window.logout = logout;

// Check if user is already logged in (on login page)
async function checkUser() {
    if (!supabaseClient) return;
    try {
        const { data: { user } } = await supabaseClient.auth.getUser();
        if (user && window.location.pathname.includes('/login')) {
            window.location.href = '/';
        }
    } catch (e) { }
}

// Redirect if not logged in (on main page)
async function protectRoute() {
    if (!supabaseClient) {
        console.warn("Supabase not configured. Skipping auth check.");
        return;
    }
    try {
        // Checking session first is faster and prevents sudden logouts on refresh if network is slow
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session && (window.location.pathname === '/' || window.location.pathname === '/index.html' || window.location.pathname === '')) {
            window.location.href = '/login';
        }
    } catch (e) {
        console.error("Auth check failed:", e);
    }
}

// Helper to toggle loader
function setLoader(type, state) {
    const btn = document.getElementById(`${type}Btn`);
    const text = document.getElementById(`${type}Text`);
    const loader = document.getElementById(`${type}Loader`);

    if (state) {
        if (btn) btn.disabled = true;
        if (text) text.style.display = 'none';
        if (loader) loader.style.display = 'block';
    } else {
        if (btn) btn.disabled = false;
        if (text) text.style.display = 'inline';
        if (loader) loader.style.display = 'none';
    }
}

// LOGIN Handler
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    if (!supabaseClient) {
        Swal.fire({
            title: 'Project Info Needed',
            text: 'Please set your Supabase URL and Anon Key in static/js/auth.js',
            icon: 'info'
        });
        return;
    }

    setLoader('login', true);

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: email,
            password: password,
        });

        if (error) throw error;

        Swal.fire({
            icon: 'success',
            title: 'Login Successful',
            text: 'Redirecting to your workspace...',
            timer: 1500,
            showConfirmButton: false
        }).then(() => {
            window.location.href = '/';
        });

    } catch (error) {
        Swal.fire({
            icon: 'error',
            title: 'Login Failed',
            text: error.message
        });
    } finally {
        setLoader('login', false);
    }
});

// SIGNUP Handler
document.getElementById('signupForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const confirm = document.getElementById('signupConfirm').value;

    if (password !== confirm) {
        Swal.fire({
            icon: 'warning',
            title: 'Passwords mismatch',
            text: 'Please make sure your passwords match.'
        });
        return;
    }

    if (!supabaseClient) {
        Swal.fire('Error', 'Supabase not configured.', 'error');
        return;
    }

    setLoader('signup', true);

    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email: email,
            password: password,
        });

        if (error) throw error;

        Swal.fire({
            icon: 'success',
            title: 'Account Created!',
            text: 'Please check your email for verification (if enabled) or login now.',
            footer: 'If email verification is off, you can login directly.'
        });

        if (typeof toggleForm === 'function') toggleForm('login');

    } catch (error) {
        Swal.fire({
            icon: 'error',
            title: 'Signup Failed',
            text: error.message
        });
    } finally {
        setLoader('signup', false);
    }
});

// Forgot Password Handler
window.handleForgotPassword = async function () {
    if (!supabaseClient) {
        Swal.fire('Error', 'Supabase not configured.', 'error');
        return;
    }
    const { value: email } = await Swal.fire({
        title: 'Reset Password',
        input: 'email',
        inputLabel: 'Enter your email address',
        inputPlaceholder: 'email@example.com',
        showCancelButton: true,
        confirmButtonColor: '#d81b60',
        cancelButtonColor: '#718096',
    });

    if (email) {
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + '/reset-password',
        });

        if (error) {
            Swal.fire('Error', error.message, 'error');
        } else {
            Swal.fire('Sent!', 'Verification email sent to your address.', 'success');
        }
    }
};

// Social Login
window.handleSocial = async function (provider) {
    if (!supabaseClient) {
        Swal.fire('Error', 'Supabase not configured.', 'error');
        return;
    }
    const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: provider,
        options: {
            redirectTo: window.location.origin
        }
    });

    if (error) {
        Swal.fire('Error', error.message, 'error');
    }
};

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
    // Direct event listener for Logout button (Backup)
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    }

    if (window.location.pathname.includes('login')) {
        checkUser();
    } else {
        protectRoute();
    }
});
