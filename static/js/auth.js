// Authentication removed - Direct access enabled
// No Supabase dependency needed

// Global Logout Utility (just clears local state and redirects)
function logout() {
    console.log("Session cleared");
    localStorage.clear();
    sessionStorage.clear();
    // Just reload the page since there's no login
    window.location.href = '/';
}

// Attach to window for HTML onclick access
window.logout = logout;

// No auth checks needed - direct access
function checkUser() {
    // No authentication - allow all access
    return;
}

function protectRoute() {
    // No authentication - allow all access
    return;
}

// Forgot Password Handler (disabled)
window.handleForgotPassword = function () {
    if (typeof Swal !== 'undefined') {
        Swal.fire('Info', 'Authentication has been disabled. No password needed.', 'info');
    }
};

// Social Login (disabled)
window.handleSocial = function (provider) {
    if (typeof Swal !== 'undefined') {
        Swal.fire('Info', 'Social login has been disabled.', 'info');
    }
};
